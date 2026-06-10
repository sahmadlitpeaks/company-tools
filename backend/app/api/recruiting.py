"""Recruiting / ATS: jobs → candidate pipeline → interviews & scorecards →
offers → hire (creates the employee + optional onboarding journey)."""
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.department import Department
from app.models.people import OnboardingJourney, OnboardingTask, OnboardingTemplate
from app.models.people import DEFAULT_ONBOARDING
from app.models.recruiting import (
    CANDIDATE_STAGES,
    CANDIDATE_STATUSES,
    JOB_STATUSES,
    OFFER_STATUSES,
    RECOMMENDATIONS,
    Candidate,
    CandidateActivity,
    Interview,
    JobOpening,
    Offer,
)
from app.models.user import User
from app.schemas.recruiting import (
    ActivityOut,
    CandidateCreate,
    CandidateDetail,
    CandidateOut,
    CandidateUpdate,
    HireIn,
    InterviewCreate,
    InterviewOut,
    InterviewUpdate,
    JobCreate,
    JobOut,
    JobUpdate,
    NoteIn,
    OfferCreate,
    OfferOut,
    OfferUpdate,
)
from app.services.activity import record
from app.services.notify import notify_user
from app.services.people import user_names
from app.services.storage import absolute_path, save_upload

router = APIRouter(prefix="/recruiting", tags=["recruiting"])


# ---- Jobs ------------------------------------------------------------------
async def _job_out(db: AsyncSession, job: JobOpening, names: dict | None = None) -> JobOut:
    out = JobOut.model_validate(job)
    if job.department_id:
        dept = await db.get(Department, job.department_id)
        out.department_name = dept.name if dept else None
    if names is None:
        names = await user_names(db, {job.hiring_manager_id})
    out.hiring_manager_name = names.get(job.hiring_manager_id) if job.hiring_manager_id else None
    out.candidate_count = (
        await db.scalar(select(func.count(Candidate.id)).where(Candidate.job_id == job.id))
    ) or 0
    out.hired_count = (
        await db.scalar(
            select(func.count(Candidate.id)).where(
                Candidate.job_id == job.id, Candidate.status == "hired"
            )
        )
    ) or 0
    return out


@router.get("/jobs", response_model=list[JobOut])
async def list_jobs(
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    stmt = select(JobOpening).order_by(JobOpening.created_at.desc())
    if status:
        stmt = stmt.where(JobOpening.status == status)
    jobs = (await db.execute(stmt)).scalars().all()
    names = await user_names(db, {j.hiring_manager_id for j in jobs})
    return [await _job_out(db, j, names) for j in jobs]


@router.post("/jobs", response_model=JobOut, status_code=201)
async def create_job(
    payload: JobCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not payload.title.strip():
        raise HTTPException(status_code=422, detail="Title is required")
    if payload.status not in JOB_STATUSES:
        raise HTTPException(status_code=422, detail="Invalid status")
    job = JobOpening(**payload.model_dump(), created_by_id=user.id)
    db.add(job)
    record(db, user=user, action="created", entity_type="job", entity_id=job.id,
           summary=f"Opened position: {job.title}")
    await db.commit()
    await db.refresh(job)
    return await _job_out(db, job)


@router.get("/jobs/{job_id}", response_model=JobOut)
async def get_job(job_id: uuid.UUID, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    job = await db.get(JobOpening, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return await _job_out(db, job)


@router.patch("/jobs/{job_id}", response_model=JobOut)
async def update_job(
    job_id: uuid.UUID,
    payload: JobUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    job = await db.get(JobOpening, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    data = payload.model_dump(exclude_unset=True)
    if "status" in data and data["status"] not in JOB_STATUSES:
        raise HTTPException(status_code=422, detail="Invalid status")
    for f, v in data.items():
        setattr(job, f, v)
    await db.commit()
    await db.refresh(job)
    return await _job_out(db, job)


@router.delete("/jobs/{job_id}", status_code=204)
async def delete_job(job_id: uuid.UUID, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    job = await db.get(JobOpening, job_id)
    if job:
        await db.delete(job)
        await db.commit()


# ---- Candidates & pipeline --------------------------------------------------
@router.get("/jobs/{job_id}/pipeline", response_model=dict[str, list[CandidateOut]])
async def pipeline(job_id: uuid.UUID, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    cands = (
        await db.execute(
            select(Candidate).where(Candidate.job_id == job_id).order_by(Candidate.created_at)
        )
    ).scalars().all()
    out: dict[str, list[CandidateOut]] = {s: [] for s in CANDIDATE_STAGES}
    for c in cands:
        out.setdefault(c.stage, []).append(CandidateOut.model_validate(c))
    return out


@router.post("/jobs/{job_id}/candidates", response_model=CandidateOut, status_code=201)
async def add_candidate(
    job_id: uuid.UUID,
    payload: CandidateCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not await db.get(JobOpening, job_id):
        raise HTTPException(status_code=404, detail="Job not found")
    if not payload.name.strip():
        raise HTTPException(status_code=422, detail="Name is required")
    cand = Candidate(job_id=job_id, **payload.model_dump())
    db.add(cand)
    await db.flush()
    db.add(CandidateActivity(candidate_id=cand.id, kind="stage", body="Applied", author_id=user.id))
    await db.commit()
    await db.refresh(cand)
    return CandidateOut.model_validate(cand)


@router.get("/candidates/{cand_id}", response_model=CandidateDetail)
async def get_candidate(cand_id: uuid.UUID, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    cand = await db.get(Candidate, cand_id)
    if not cand:
        raise HTTPException(status_code=404, detail="Candidate not found")
    out = CandidateDetail.model_validate(cand)
    job = await db.get(JobOpening, cand.job_id)
    out.job_title = job.title if job else None
    acts = (
        await db.execute(
            select(CandidateActivity)
            .where(CandidateActivity.candidate_id == cand_id)
            .order_by(CandidateActivity.created_at.desc())
        )
    ).scalars().all()
    ivs = (
        await db.execute(
            select(Interview).where(Interview.candidate_id == cand_id).order_by(Interview.scheduled_at)
        )
    ).scalars().all()
    offers = (
        await db.execute(
            select(Offer).where(Offer.candidate_id == cand_id).order_by(Offer.created_at.desc())
        )
    ).scalars().all()
    names = await user_names(db, {a.author_id for a in acts} | {i.interviewer_id for i in ivs})
    out.activities = []
    for a in acts:
        item = ActivityOut.model_validate(a)
        item.author_name = names.get(a.author_id) if a.author_id else None
        out.activities.append(item)
    out.interviews = []
    for i in ivs:
        item = InterviewOut.model_validate(i)
        item.interviewer_name = names.get(i.interviewer_id) if i.interviewer_id else None
        out.interviews.append(item)
    out.offers = [OfferOut.model_validate(o) for o in offers]
    out.interview_count = len(ivs)
    return out


@router.patch("/candidates/{cand_id}", response_model=CandidateOut)
async def update_candidate(
    cand_id: uuid.UUID,
    payload: CandidateUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    cand = await db.get(Candidate, cand_id)
    if not cand:
        raise HTTPException(status_code=404, detail="Candidate not found")
    data = payload.model_dump(exclude_unset=True)
    if "stage" in data and data["stage"] not in CANDIDATE_STAGES:
        raise HTTPException(status_code=422, detail="Invalid stage")
    if "status" in data and data["status"] not in CANDIDATE_STATUSES:
        raise HTTPException(status_code=422, detail="Invalid status")
    if "rating" in data and data["rating"] is not None and not (1 <= data["rating"] <= 5):
        raise HTTPException(status_code=422, detail="Rating must be 1–5")
    old_stage = cand.stage
    for f, v in data.items():
        setattr(cand, f, v)
    if "stage" in data and data["stage"] != old_stage:
        db.add(CandidateActivity(
            candidate_id=cand.id, kind="stage",
            body=f"Moved {old_stage} → {data['stage']}", author_id=user.id,
        ))
        if data["stage"] == "rejected":
            cand.status = "rejected"
    await db.commit()
    await db.refresh(cand)
    return CandidateOut.model_validate(cand)


@router.delete("/candidates/{cand_id}", status_code=204)
async def delete_candidate(cand_id: uuid.UUID, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    cand = await db.get(Candidate, cand_id)
    if cand:
        await db.delete(cand)
        await db.commit()


@router.post("/candidates/{cand_id}/notes", response_model=ActivityOut, status_code=201)
async def add_note(
    cand_id: uuid.UUID,
    payload: NoteIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not await db.get(Candidate, cand_id):
        raise HTTPException(status_code=404, detail="Candidate not found")
    if not payload.body.strip():
        raise HTTPException(status_code=422, detail="Note is empty")
    act = CandidateActivity(candidate_id=cand_id, kind="note", body=payload.body.strip(), author_id=user.id)
    db.add(act)
    await db.commit()
    await db.refresh(act)
    out = ActivityOut.model_validate(act)
    out.author_name = user.display_name
    return out


@router.post("/candidates/{cand_id}/resume", response_model=CandidateOut)
async def upload_resume(
    cand_id: uuid.UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    cand = await db.get(Candidate, cand_id)
    if not cand:
        raise HTTPException(status_code=404, detail="Candidate not found")
    rel_path, _size = await save_upload(file, subdir="resumes")
    cand.resume_path = rel_path
    await db.commit()
    await db.refresh(cand)
    return CandidateOut.model_validate(cand)


@router.get("/candidates/{cand_id}/resume")
async def download_resume(cand_id: uuid.UUID, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    cand = await db.get(Candidate, cand_id)
    if not cand or not cand.resume_path:
        raise HTTPException(status_code=404, detail="No résumé on file")
    return FileResponse(absolute_path(cand.resume_path), filename=f"{cand.name} - resume")


# ---- Interviews --------------------------------------------------------------
@router.post("/candidates/{cand_id}/interviews", response_model=InterviewOut, status_code=201)
async def schedule_interview(
    cand_id: uuid.UUID,
    payload: InterviewCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    cand = await db.get(Candidate, cand_id)
    if not cand:
        raise HTTPException(status_code=404, detail="Candidate not found")
    iv = Interview(candidate_id=cand_id, **payload.model_dump())
    db.add(iv)
    if iv.interviewer_id:
        await notify_user(
            db, user_id=iv.interviewer_id,
            title="Interview scheduled",
            body=f"You're interviewing {cand.name} on {payload.scheduled_at:%Y-%m-%d %H:%M}.",
            link="/recruiting", category="info",
        )
    await db.commit()
    await db.refresh(iv)
    return InterviewOut.model_validate(iv)


@router.patch("/interviews/{iv_id}", response_model=InterviewOut)
async def update_interview(
    iv_id: uuid.UUID,
    payload: InterviewUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    iv = await db.get(Interview, iv_id)
    if not iv:
        raise HTTPException(status_code=404, detail="Interview not found")
    data = payload.model_dump(exclude_unset=True)
    if "rating" in data and data["rating"] is not None and not (1 <= data["rating"] <= 5):
        raise HTTPException(status_code=422, detail="Rating must be 1–5")
    if "recommendation" in data and data["recommendation"] is not None and data["recommendation"] not in RECOMMENDATIONS:
        raise HTTPException(status_code=422, detail="Invalid recommendation")
    for f, v in data.items():
        setattr(iv, f, v)
    await db.commit()
    await db.refresh(iv)
    return InterviewOut.model_validate(iv)


@router.delete("/interviews/{iv_id}", status_code=204)
async def delete_interview(iv_id: uuid.UUID, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    iv = await db.get(Interview, iv_id)
    if iv:
        await db.delete(iv)
        await db.commit()


# ---- Offers -------------------------------------------------------------------
@router.post("/candidates/{cand_id}/offers", response_model=OfferOut, status_code=201)
async def create_offer(
    cand_id: uuid.UUID,
    payload: OfferCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    cand = await db.get(Candidate, cand_id)
    if not cand:
        raise HTTPException(status_code=404, detail="Candidate not found")
    offer = Offer(candidate_id=cand_id, created_by_id=user.id, **payload.model_dump())
    db.add(offer)
    if cand.stage in ("applied", "screen", "interview"):
        cand.stage = "offer"
        db.add(CandidateActivity(candidate_id=cand.id, kind="stage", body="Offer extended", author_id=user.id))
    await db.commit()
    await db.refresh(offer)
    return OfferOut.model_validate(offer)


@router.patch("/offers/{offer_id}", response_model=OfferOut)
async def update_offer(
    offer_id: uuid.UUID,
    payload: OfferUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    offer = await db.get(Offer, offer_id)
    if not offer:
        raise HTTPException(status_code=404, detail="Offer not found")
    data = payload.model_dump(exclude_unset=True)
    if "status" in data and data["status"] not in OFFER_STATUSES:
        raise HTTPException(status_code=422, detail="Invalid status")
    for f, v in data.items():
        setattr(offer, f, v)
    await db.commit()
    await db.refresh(offer)
    return OfferOut.model_validate(offer)


# ---- Hire → employee ------------------------------------------------------------
@router.post("/candidates/{cand_id}/hire", response_model=CandidateOut)
async def hire(
    cand_id: uuid.UUID,
    payload: HireIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Convert a candidate into an employee, optionally starting onboarding."""
    cand = await db.get(Candidate, cand_id)
    if not cand:
        raise HTTPException(status_code=404, detail="Candidate not found")
    if cand.user_id:
        raise HTTPException(status_code=409, detail="Already hired")
    job = await db.get(JobOpening, cand.job_id)

    email = (payload.email or cand.email or "").strip().lower() or None
    if email:
        clash = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
        if clash:
            raise HTTPException(status_code=409, detail="An employee with that email already exists")

    parts = cand.name.split(" ", 1)
    accepted_offer = (
        await db.execute(
            select(Offer).where(Offer.candidate_id == cand_id, Offer.status == "accepted")
            .order_by(Offer.created_at.desc())
        )
    ).scalars().first()

    emp = User(
        email=email,
        personal_email=None if email == (cand.email or "").lower() else (cand.email or None),
        display_name=cand.name,
        given_name=parts[0],
        surname=parts[1] if len(parts) > 1 else None,
        job_title=job.title if job else None,
        mobile_phone=cand.phone,
        department_id=job.department_id if job else None,
        employment_type=job.employment_type if job else None,
        hire_date=accepted_offer.start_date if accepted_offer else None,
        role="member",
        status="pending",
    )
    db.add(emp)
    await db.flush()

    cand.user_id = emp.id
    cand.status = "hired"
    cand.stage = "hired"
    db.add(CandidateActivity(candidate_id=cand.id, kind="stage", body="Hired 🎉", author_id=user.id))
    if job and job.openings <= ((await db.scalar(
        select(func.count(Candidate.id)).where(Candidate.job_id == job.id, Candidate.status == "hired")
    )) or 0):
        job.status = "filled"

    if payload.start_onboarding:
        journey = OnboardingJourney(
            kind="onboarding", target_user_id=emp.id,
            company_id=job.company_id if job else None, created_by_id=user.id,
        )
        db.add(journey)
        await db.flush()
        tpl = None
        if payload.template_id:
            tpl = (
                await db.execute(
                    select(OnboardingTemplate)
                    .options(selectinload(OnboardingTemplate.items))
                    .where(OnboardingTemplate.id == payload.template_id)
                )
            ).scalar_one_or_none()
        if tpl and tpl.items:
            for i, it in enumerate(sorted(tpl.items, key=lambda x: x.sort)):
                db.add(OnboardingTask(journey_id=journey.id, title=it.title, category=it.category, sort=i))
        else:
            for i, (category, title) in enumerate(DEFAULT_ONBOARDING):
                db.add(OnboardingTask(journey_id=journey.id, title=title, category=category, sort=i))

    record(db, user=user, action="created", entity_type="user", entity_id=emp.id,
           summary=f"Hired {cand.name}" + (f" for {job.title}" if job else ""))
    await db.commit()
    await db.refresh(cand)
    return CandidateOut.model_validate(cand)

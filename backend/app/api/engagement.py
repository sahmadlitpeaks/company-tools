"""Engagement: HR-authored surveys (with eNPS scoring) and peer kudos.

Surveys: HR creates/opens/closes and views aggregate results; every employee
can list open surveys and submit a (optionally anonymous) response once.
Kudos: any employee can post a public shout-out about a colleague.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.core.permissions import is_hr
from app.models.engagement import (
    QUESTION_TYPES,
    SURVEY_KINDS,
    Kudos,
    Survey,
    SurveyAnswer,
    SurveyQuestion,
    SurveyResponse,
)
from app.models.user import User
from app.schemas.engagement import (
    KudosCreate,
    KudosOut,
    QuestionOut,
    QuestionResult,
    ResponseIn,
    SurveyCreate,
    SurveyOut,
    SurveyResults,
    SurveyUpdate,
)
from app.services.notify import notify_user
from app.services.people import user_names

router = APIRouter(prefix="/engagement", tags=["engagement"])


def _require_hr(user: User) -> None:
    if not is_hr(user):
        raise HTTPException(status_code=403, detail="HR access required")


async def _survey_out(db: AsyncSession, s: Survey, with_questions: bool = True) -> SurveyOut:
    count = await db.scalar(
        select(func.count(SurveyResponse.id)).where(SurveyResponse.survey_id == s.id)
    )
    out = SurveyOut(
        id=s.id, title=s.title, description=s.description, kind=s.kind,
        anonymous=s.anonymous, status=s.status, response_count=count or 0,
        created_at=s.created_at,
        questions=[QuestionOut.model_validate(q) for q in sorted(s.questions, key=lambda q: q.sort)]
        if with_questions else [],
    )
    return out


async def _load(db: AsyncSession, survey_id: uuid.UUID) -> Survey:
    s = (
        await db.execute(
            select(Survey).where(Survey.id == survey_id).options(selectinload(Survey.questions))
        )
    ).scalar_one_or_none()
    if not s:
        raise HTTPException(status_code=404, detail="Survey not found")
    return s


# ---- Surveys: management (HR) -------------------------------------------
@router.get("/surveys", response_model=list[SurveyOut])
async def list_surveys(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    """HR sees all surveys; everyone else sees only open ones."""
    stmt = select(Survey).options(selectinload(Survey.questions)).order_by(Survey.created_at.desc())
    if not is_hr(user):
        stmt = stmt.where(Survey.status == "open")
    rows = (await db.execute(stmt)).scalars().all()
    return [await _survey_out(db, s) for s in rows]


@router.post("/surveys", response_model=SurveyOut, status_code=201)
async def create_survey(
    body: SurveyCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_hr(user)
    if body.kind not in SURVEY_KINDS:
        raise HTTPException(status_code=422, detail="Invalid survey kind")
    s = Survey(
        title=body.title, description=body.description, kind=body.kind,
        anonymous=body.anonymous, created_by_id=user.id,
    )
    db.add(s)
    await db.flush()
    if body.kind == "enps" and not body.questions:
        # Seed the canonical eNPS question plus an open-text "why".
        db.add(SurveyQuestion(survey_id=s.id, text="How likely are you to recommend us as a place to work?", qtype="nps", sort=0))
        db.add(SurveyQuestion(survey_id=s.id, text="What's the main reason for your score?", qtype="text", sort=1))
    else:
        for i, q in enumerate(body.questions):
            if q.qtype not in QUESTION_TYPES:
                raise HTTPException(status_code=422, detail=f"Invalid question type: {q.qtype}")
            db.add(SurveyQuestion(survey_id=s.id, text=q.text, qtype=q.qtype, sort=q.sort or i))
    await db.commit()
    return await _survey_out(db, await _load(db, s.id))


@router.patch("/surveys/{survey_id}", response_model=SurveyOut)
async def update_survey(
    survey_id: uuid.UUID,
    body: SurveyUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_hr(user)
    s = await _load(db, survey_id)
    data = body.model_dump(exclude_unset=True)
    if "status" in data and data["status"] not in {"draft", "open", "closed"}:
        raise HTTPException(status_code=422, detail="Invalid status")
    for k, v in data.items():
        setattr(s, k, v)
    await db.commit()
    return await _survey_out(db, await _load(db, survey_id))


@router.delete("/surveys/{survey_id}", status_code=204)
async def delete_survey(
    survey_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_hr(user)
    s = await db.get(Survey, survey_id)
    if s:
        await db.delete(s)
        await db.commit()


# ---- Surveys: respond (everyone) ----------------------------------------
@router.post("/surveys/{survey_id}/respond", status_code=201)
async def respond(
    survey_id: uuid.UUID,
    body: ResponseIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    s = await _load(db, survey_id)
    if s.status != "open":
        raise HTTPException(status_code=409, detail="Survey is not open")
    # One response per identifiable user (anonymous surveys allow repeats off
    # the honour system since we don't store the user).
    if not s.anonymous:
        existing = await db.scalar(
            select(func.count(SurveyResponse.id)).where(
                SurveyResponse.survey_id == survey_id, SurveyResponse.user_id == user.id
            )
        )
        if existing:
            raise HTTPException(status_code=409, detail="You already responded")
    valid_q = {q.id for q in s.questions}
    resp = SurveyResponse(survey_id=survey_id, user_id=None if s.anonymous else user.id)
    db.add(resp)
    await db.flush()
    for a in body.answers:
        if a.question_id not in valid_q:
            raise HTTPException(status_code=422, detail="Unknown question")
        db.add(SurveyAnswer(
            response_id=resp.id, question_id=a.question_id,
            value_num=a.value_num, value_text=a.value_text,
        ))
    await db.commit()
    return {"ok": True}


@router.get("/surveys/{survey_id}/results", response_model=SurveyResults)
async def results(
    survey_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_hr(user)
    s = await _load(db, survey_id)
    resp_count = await db.scalar(
        select(func.count(SurveyResponse.id)).where(SurveyResponse.survey_id == survey_id)
    )
    q_results: list[QuestionResult] = []
    for q in sorted(s.questions, key=lambda q: q.sort):
        answers = (
            await db.execute(
                select(SurveyAnswer)
                .join(SurveyResponse, SurveyAnswer.response_id == SurveyResponse.id)
                .where(SurveyResponse.survey_id == survey_id, SurveyAnswer.question_id == q.id)
            )
        ).scalars().all()
        qr = QuestionResult(question_id=q.id, text=q.text, qtype=q.qtype, response_count=len(answers))
        nums = [a.value_num for a in answers if a.value_num is not None]
        if q.qtype in ("scale", "boolean") and nums:
            qr.average = round(sum(nums) / len(nums), 2)
        elif q.qtype == "nps" and nums:
            promoters = sum(1 for n in nums if n >= 9)
            detractors = sum(1 for n in nums if n <= 6)
            qr.enps = round((promoters - detractors) / len(nums) * 100, 1)
        elif q.qtype == "text":
            qr.text_answers = [a.value_text for a in answers if a.value_text]
        q_results.append(qr)
    return SurveyResults(
        survey_id=survey_id, title=s.title, response_count=resp_count or 0, questions=q_results
    )


# ---- Kudos (everyone) ----------------------------------------------------
@router.get("/kudos", response_model=list[KudosOut])
async def list_kudos(
    user_id: uuid.UUID | None = None,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    stmt = select(Kudos).order_by(Kudos.created_at.desc()).limit(min(limit, 200))
    if user_id:
        stmt = stmt.where(Kudos.to_user_id == user_id)
    rows = (await db.execute(stmt)).scalars().all()
    names = await user_names(db, {k.from_user_id for k in rows} | {k.to_user_id for k in rows})
    return [
        KudosOut(
            id=k.id, from_user_id=k.from_user_id, from_name=names.get(k.from_user_id),
            to_user_id=k.to_user_id, to_name=names.get(k.to_user_id),
            message=k.message, value_tag=k.value_tag, created_at=k.created_at,
        )
        for k in rows
    ]


@router.post("/kudos", response_model=KudosOut, status_code=201)
async def give_kudos(
    body: KudosCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if body.to_user_id == user.id:
        raise HTTPException(status_code=422, detail="You can't give kudos to yourself")
    target = await db.get(User, body.to_user_id)
    if not target:
        raise HTTPException(status_code=404, detail="Recipient not found")
    if not body.message.strip():
        raise HTTPException(status_code=422, detail="Message is required")
    k = Kudos(
        from_user_id=user.id, to_user_id=body.to_user_id,
        message=body.message.strip(), value_tag=body.value_tag,
    )
    db.add(k)
    await notify_user(
        db, user_id=body.to_user_id,
        title="You received kudos! 🎉",
        body=f"{user.display_name or user.email}: {body.message.strip()[:120]}",
        link="/kudos", category="kudos",
    )
    await db.commit()
    await db.refresh(k)
    names = await user_names(db, {user.id, body.to_user_id})
    return KudosOut(
        id=k.id, from_user_id=k.from_user_id, from_name=names.get(user.id),
        to_user_id=k.to_user_id, to_name=names.get(body.to_user_id),
        message=k.message, value_tag=k.value_tag, created_at=k.created_at,
    )

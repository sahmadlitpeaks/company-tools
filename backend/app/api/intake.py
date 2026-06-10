"""Inbound intake: a public endpoint websites post their forms to, plus a
triage inbox (list, assign, status) with conversion to CRM leads or tickets.
"""
import secrets
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.crm import CrmLead
from app.models.intake import (
    SUBMISSION_STATUSES,
    SUBMISSION_TYPES,
    IntakeSource,
    Submission,
)
from app.models.user import User
from app.models.workplace import Ticket
from app.schemas.intake import (
    IntakeSummary,
    SourceCreate,
    SourceOut,
    SourceUpdate,
    SubmissionOut,
    SubmissionUpdate,
)
from app.services.activity import record
from app.services.notify import notify_user
from app.services.people import user_labels

# Token-authenticated ingest (WordPress etc. post here with the source token).
public_router = APIRouter(prefix="/intake", tags=["intake-public"])
# Authenticated management (gated by the `crm` module in main.py).
router = APIRouter(prefix="/intake", tags=["intake"])

_KNOWN = {"type", "name", "email", "phone", "company", "subject", "message", "page_url"}


def _bearer_token(request: Request) -> str | None:
    """Extract the API token from Authorization: Bearer … or X-API-Key."""
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip() or None
    return request.headers.get("x-api-key") or None


@public_router.post("/ingest")
async def ingest(request: Request, db: AsyncSession = Depends(get_db)):
    """Accept a form submission from a connected system (e.g. WordPress).

    Authenticated by the source's API token in the `Authorization: Bearer <token>`
    or `X-API-Key` header. Common fields are mapped; the rest go to ``payload``.
    """
    token = _bearer_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Missing API token")
    source = (
        await db.execute(
            select(IntakeSource).where(IntakeSource.key == token, IntakeSource.active.is_(True))
        )
    ).scalar_one_or_none()
    if not source:
        raise HTTPException(status_code=401, detail="Invalid or inactive API token")
    try:
        body = await request.json()
    except Exception:
        form = await request.form()
        body = dict(form)
    if not isinstance(body, dict):
        raise HTTPException(status_code=422, detail="Expected a JSON object")

    sub_type = (str(body.get("type") or source.default_type)).lower()
    if sub_type not in SUBMISSION_TYPES:
        sub_type = source.default_type
    extra = {k: v for k, v in body.items() if k not in _KNOWN and k != "fields"}
    if isinstance(body.get("fields"), dict):
        extra.update(body["fields"])
    sub = Submission(
        source_id=source.id,
        type=sub_type,
        name=(body.get("name") or None),
        email=(body.get("email") or None),
        phone=(body.get("phone") or None),
        company=(body.get("company") or None),
        subject=(body.get("subject") or None),
        message=(body.get("message") or None),
        page_url=(body.get("page_url") or None),
        payload=extra or None,
        ip=request.client.host if request.client else None,
    )
    db.add(sub)
    await db.flush()
    # Notify the source owner, else everyone with CRM access.
    recipients = (
        [source.notify_user_id]
        if source.notify_user_id
        else (
            await db.execute(
                select(User.id).where(User.is_admin.is_(True), User.status == "active")
            )
        ).scalars().all()
    )
    for rid in recipients:
        if rid:
            await notify_user(
                db, user_id=rid,
                title=f"New {sub_type}: {sub.subject or sub.name or 'submission'}",
                body=f"From {sub.name or sub.email or 'website'} via {source.name}.",
                link="/inbox", category="info",
            )
    await db.commit()
    return {"ok": True, "id": str(sub.id)}


# ---- Sources -------------------------------------------------------------
async def _source_out(db: AsyncSession, s: IntakeSource) -> SourceOut:
    out = SourceOut.model_validate(s)
    out.submission_count = (
        await db.scalar(select(func.count(Submission.id)).where(Submission.source_id == s.id))
    ) or 0
    return out


@router.get("/sources", response_model=list[SourceOut])
async def list_sources(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    rows = (await db.execute(select(IntakeSource).order_by(IntakeSource.name))).scalars().all()
    return [await _source_out(db, s) for s in rows]


@router.post("/sources", response_model=SourceOut, status_code=201)
async def create_source(
    payload: SourceCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not payload.name.strip():
        raise HTTPException(status_code=422, detail="Name is required")
    if payload.default_type not in SUBMISSION_TYPES:
        raise HTTPException(status_code=422, detail="Invalid default type")
    s = IntakeSource(
        name=payload.name.strip(),
        key=secrets.token_urlsafe(18),
        default_type=payload.default_type,
        notify_user_id=payload.notify_user_id,
    )
    db.add(s)
    await db.commit()
    await db.refresh(s)
    return await _source_out(db, s)


@router.patch("/sources/{source_id}", response_model=SourceOut)
async def update_source(
    source_id: uuid.UUID,
    payload: SourceUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    s = await db.get(IntakeSource, source_id)
    if not s:
        raise HTTPException(status_code=404, detail="Source not found")
    for f, v in payload.model_dump(exclude_unset=True).items():
        setattr(s, f, v)
    await db.commit()
    await db.refresh(s)
    return await _source_out(db, s)


@router.post("/sources/{source_id}/rotate-key", response_model=SourceOut)
async def rotate_key(
    source_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    s = await db.get(IntakeSource, source_id)
    if not s:
        raise HTTPException(status_code=404, detail="Source not found")
    s.key = secrets.token_urlsafe(18)
    await db.commit()
    await db.refresh(s)
    return await _source_out(db, s)


@router.delete("/sources/{source_id}", status_code=204)
async def delete_source(
    source_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    s = await db.get(IntakeSource, source_id)
    if s:
        await db.delete(s)
        await db.commit()


# ---- Submissions ---------------------------------------------------------
async def _serialize(db: AsyncSession, subs: list[Submission]) -> list[SubmissionOut]:
    src_ids = {s.source_id for s in subs if s.source_id}
    sources = {}
    if src_ids:
        rows = (await db.execute(select(IntakeSource.id, IntakeSource.name).where(IntakeSource.id.in_(src_ids)))).all()
        sources = {r[0]: r[1] for r in rows}
    names = await user_labels(db, {s.assignee_id for s in subs if s.assignee_id})
    out = []
    for s in subs:
        item = SubmissionOut.model_validate(s)
        item.source_name = sources.get(s.source_id) if s.source_id else None
        item.assignee_name = (names.get(s.assignee_id) or {}).get("name") if s.assignee_id else None
        out.append(item)
    return out


@router.get("/submissions", response_model=list[SubmissionOut])
async def list_submissions(
    status: str | None = None,
    type: str | None = None,
    source_id: uuid.UUID | None = None,
    q: str | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    stmt = select(Submission).order_by(Submission.created_at.desc())
    if status:
        stmt = stmt.where(Submission.status == status)
    if type:
        stmt = stmt.where(Submission.type == type)
    if source_id:
        stmt = stmt.where(Submission.source_id == source_id)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            Submission.name.ilike(like) | Submission.email.ilike(like)
            | Submission.subject.ilike(like) | Submission.message.ilike(like)
        )
    subs = (await db.execute(stmt.limit(500))).scalars().all()
    return await _serialize(db, subs)


@router.get("/summary", response_model=IntakeSummary)
async def summary(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    rows = (await db.execute(select(Submission.status, func.count()).group_by(Submission.status))).all()
    by_status = {r[0]: int(r[1]) for r in rows}
    trows = (await db.execute(select(Submission.type, func.count()).group_by(Submission.type))).all()
    return IntakeSummary(new=by_status.get("new", 0), by_status=by_status, by_type={r[0]: int(r[1]) for r in trows})


@router.get("/submissions/{sub_id}", response_model=SubmissionOut)
async def get_submission(
    sub_id: uuid.UUID, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    sub = await db.get(Submission, sub_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Not found")
    return (await _serialize(db, [sub]))[0]


@router.patch("/submissions/{sub_id}", response_model=SubmissionOut)
async def update_submission(
    sub_id: uuid.UUID,
    payload: SubmissionUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    sub = await db.get(Submission, sub_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Not found")
    data = payload.model_dump(exclude_unset=True)
    if "status" in data and data["status"] not in SUBMISSION_STATUSES:
        raise HTTPException(status_code=422, detail="Invalid status")
    if "type" in data and data["type"] not in SUBMISSION_TYPES:
        raise HTTPException(status_code=422, detail="Invalid type")
    for f, v in data.items():
        setattr(sub, f, v)
    await db.commit()
    return (await _serialize(db, [sub]))[0]


@router.delete("/submissions/{sub_id}", status_code=204)
async def delete_submission(
    sub_id: uuid.UUID, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    sub = await db.get(Submission, sub_id)
    if sub:
        await db.delete(sub)
        await db.commit()


@router.post("/submissions/{sub_id}/convert-lead", response_model=SubmissionOut)
async def convert_lead(
    sub_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    sub = await db.get(Submission, sub_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Not found")
    if sub.converted_lead_id:
        raise HTTPException(status_code=409, detail="Already converted to a lead")
    src = await db.get(IntakeSource, sub.source_id) if sub.source_id else None
    lead = CrmLead(
        name=sub.name, email=sub.email, phone=sub.phone, company=sub.company,
        source="web", source_detail=src.name if src else None,
        notes="\n".join(filter(None, [sub.subject, sub.message])) or None,
        origin_type="submission", origin_id=str(sub.id), status="new",
    )
    db.add(lead)
    await db.flush()
    sub.converted_lead_id = lead.id
    if sub.status == "new":
        sub.status = "in_progress"
    record(db, user=user, action="created", entity_type="crm_lead", entity_id=lead.id,
           summary="Converted submission to CRM lead")
    await db.commit()
    return (await _serialize(db, [sub]))[0]


@router.post("/submissions/{sub_id}/convert-ticket", response_model=SubmissionOut)
async def convert_ticket(
    sub_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    sub = await db.get(Submission, sub_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Not found")
    if sub.converted_ticket_id:
        raise HTTPException(status_code=409, detail="Already converted to a ticket")
    next_no = ((await db.scalar(select(func.max(Ticket.number)))) or 0) + 1
    ticket = Ticket(
        number=next_no,
        subject=sub.subject or f"{sub.type.title()} from {sub.name or sub.email or 'website'}",
        description="\n".join(filter(None, [sub.message, f"(from {sub.email or ''})"])) or None,
        category="other",
        status="open",
        assignee_id=sub.assignee_id,
    )
    db.add(ticket)
    await db.flush()
    sub.converted_ticket_id = ticket.id
    if sub.status == "new":
        sub.status = "in_progress"
    record(db, user=user, action="created", entity_type="ticket", entity_id=ticket.id,
           summary="Converted submission to ticket")
    await db.commit()
    return (await _serialize(db, [sub]))[0]

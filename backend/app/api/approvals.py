import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.hr import LeaveType
from app.models.user import User
from app.models.workplace import ApprovalRequest
from app.schemas.workplace import ApprovalCreate, ApprovalDecision, ApprovalOut
from app.services import approval_engine as engine
from app.services.activity import record
from app.services.notify import notify_user
from app.services.people import user_names

router = APIRouter(prefix="/approvals", tags=["approvals"])

TYPES = {"leave", "expense", "purchase", "document", "access", "general"}


def _can_decide(user: User, req: ApprovalRequest) -> bool:
    """Admins and managers can decide; or the explicitly named approver."""
    if user.is_admin or user.role == "manager":
        return True
    return req.approver_id == user.id


def _serialize(req: ApprovalRequest, names: dict, types: dict | None = None) -> ApprovalOut:
    out = ApprovalOut.model_validate(req)
    out.requester_name = names.get(req.requester_id) if req.requester_id else None
    out.approver_name = names.get(req.approver_id) if req.approver_id else None
    out.decided_by_name = names.get(req.decided_by_id) if req.decided_by_id else None
    if req.leave_type_id and types:
        out.leave_type_name = types.get(req.leave_type_id)
    return out


async def _leave_type_names(db: AsyncSession, ids: set) -> dict:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    rows = (
        await db.execute(select(LeaveType.id, LeaveType.name).where(LeaveType.id.in_(ids)))
    ).all()
    return {r[0]: r[1] for r in rows}


@router.get("", response_model=list[ApprovalOut])
async def list_approvals(
    status: str | None = None,
    scope: str = Query("all", description="all | mine | to_review"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = select(ApprovalRequest).order_by(ApprovalRequest.created_at.desc())
    if status:
        stmt = stmt.where(ApprovalRequest.status == status)
    if scope == "mine":
        stmt = stmt.where(ApprovalRequest.requester_id == user.id)
    elif scope == "to_review":
        # Things this user is responsible for deciding.
        if user.is_admin or user.role == "manager":
            stmt = stmt.where(
                or_(
                    ApprovalRequest.approver_id == user.id,
                    ApprovalRequest.approver_id.is_(None),
                )
            )
        else:
            stmt = stmt.where(ApprovalRequest.approver_id == user.id)
    reqs = (await db.execute(stmt)).scalars().all()
    names = await user_names(
        db,
        {r.requester_id for r in reqs}
        | {r.approver_id for r in reqs}
        | {r.decided_by_id for r in reqs},
    )
    types = await _leave_type_names(db, {r.leave_type_id for r in reqs})
    return [_serialize(r, names, types) for r in reqs]


@router.post("", response_model=ApprovalOut, status_code=201)
async def create_approval(
    payload: ApprovalCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if payload.type not in TYPES:
        raise HTTPException(status_code=422, detail="Invalid type")
    if payload.leave_type_id and not await db.get(LeaveType, payload.leave_type_id):
        raise HTTPException(status_code=404, detail="Leave type not found")
    req = ApprovalRequest(**payload.model_dump(), requester_id=user.id)
    db.add(req)
    await db.flush()
    # If a multi-step workflow is configured for this type, instantiate it
    # (this may override approver_id or auto-approve when all steps are skipped).
    await engine.instantiate(db, req, user)
    if req.approver_id and req.status == "pending":
        await notify_user(
            db,
            user_id=req.approver_id,
            title="An approval needs your review",
            body=f"{user.display_name or user.email}: {req.title}",
            link="/approvals",
            category="approval",
        )
    record(
        db,
        user=user,
        action="created",
        entity_type="approval",
        entity_id=req.id,
        summary=f"Requested approval '{req.title}' ({req.type})",
    )
    await db.commit()
    await db.refresh(req)
    names = await user_names(db, {req.requester_id, req.approver_id})
    return _serialize(req, names)


@router.post("/{req_id}/decision", response_model=ApprovalOut)
async def decide_approval(
    req_id: uuid.UUID,
    payload: ApprovalDecision,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    req = await db.get(ApprovalRequest, req_id)
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    if req.status != "pending":
        raise HTTPException(status_code=409, detail="Already decided")
    if payload.status not in {"approved", "rejected"}:
        raise HTTPException(status_code=422, detail="Invalid decision")

    steps = await engine.steps_for(db, req.id)
    next_approver_id: uuid.UUID | None = None
    if steps:
        # Multi-step workflow: only the current step's approver may decide.
        step = engine.current_step(steps)
        if not step:
            raise HTTPException(status_code=409, detail="No pending step")
        if not engine.can_decide_step(user, step):
            raise HTTPException(status_code=403, detail="You can't decide this step")
        next_approver_id = await engine.advance(db, req, steps, step, user, payload.status, payload.note)
    else:
        # Classic single-approver flow.
        if not _can_decide(user, req):
            raise HTTPException(status_code=403, detail="You can't decide this request")
        req.status = payload.status
        req.decision_note = payload.note
        req.decided_by_id = user.id
        req.decided_at = datetime.now(timezone.utc)

    # Notify the next approver if the workflow advanced; else the requester.
    if next_approver_id and req.status == "pending":
        await notify_user(
            db, user_id=next_approver_id,
            title="An approval needs your review",
            body=req.title, link="/approvals", category="approval",
        )
    elif req.requester_id:
        await notify_user(
            db,
            user_id=req.requester_id,
            title=f"Your request was {req.status}" if req.status != "pending" else "Your request advanced",
            body=req.title,
            link="/approvals",
            category="approval",
        )
    record(
        db,
        user=user,
        action="updated",
        entity_type="approval",
        entity_id=req.id,
        summary=f"{payload.status.title()} '{req.title}'",
    )
    await db.commit()
    await db.refresh(req)
    names = await user_names(db, {req.requester_id, req.approver_id, req.decided_by_id})
    return _serialize(req, names)


@router.post("/{req_id}/cancel", response_model=ApprovalOut)
async def cancel_approval(
    req_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    req = await db.get(ApprovalRequest, req_id)
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    if req.requester_id != user.id and not user.is_admin:
        raise HTTPException(status_code=403, detail="Only the requester can cancel")
    if req.status != "pending":
        raise HTTPException(status_code=409, detail="Already decided")
    req.status = "cancelled"
    await db.commit()
    await db.refresh(req)
    names = await user_names(db, {req.requester_id, req.approver_id})
    return _serialize(req, names)

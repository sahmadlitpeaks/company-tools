"""Multi-step approval workflow engine.

Layered on top of the existing single-approver ``ApprovalRequest`` flow: when an
active ``ApprovalWorkflow`` exists for a request's type, the request is driven
through ordered ``ApprovalStep`` rows. When no workflow exists, callers keep the
classic single-approver behaviour.
"""
import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import is_hr
from app.models.approval_workflow import ApprovalStep, ApprovalWorkflow
from app.models.user import User
from app.models.workplace import ApprovalRequest


async def active_workflow(db: AsyncSession, type_: str) -> ApprovalWorkflow | None:
    return (
        await db.execute(
            select(ApprovalWorkflow)
            .where(ApprovalWorkflow.type == type_, ApprovalWorkflow.active.is_(True))
            .order_by(ApprovalWorkflow.created_at.desc())
        )
    ).scalars().first()


async def _resolve_approver(db: AsyncSession, kind: str, cfg: dict, requester: User | None):
    if kind == "manager":
        return requester.manager_id if requester else None
    if kind == "user":
        uid = cfg.get("user_id")
        return uuid.UUID(uid) if isinstance(uid, str) else uid
    return None  # hr / admin are pools, no concrete approver


def _applies(cfg: dict, amount) -> bool:
    """Whether a step applies given the request amount (min_amount gate)."""
    min_amount = cfg.get("min_amount")
    if min_amount is None:
        return True
    try:
        return Decimal(str(amount or 0)) >= Decimal(str(min_amount))
    except Exception:
        return True


async def instantiate(db: AsyncSession, req: ApprovalRequest, requester: User | None) -> bool:
    """Build steps for ``req`` from its type's workflow. Returns True if a
    workflow applied (steps were created or the request was auto-approved)."""
    wf = await active_workflow(db, req.type)
    if not wf or not wf.steps:
        return False

    seq = 0
    first_pending: ApprovalStep | None = None
    for cfg in wf.steps:
        kind = cfg.get("approver", "manager")
        applies = _applies(cfg, req.amount)
        approver_id = await _resolve_approver(db, kind, cfg, requester) if applies else None
        # A manager step with no manager to resolve is skipped.
        skip = (not applies) or (kind == "manager" and approver_id is None)
        step = ApprovalStep(
            request_id=req.id, seq=seq, approver_kind=kind,
            approver_id=approver_id, status="skipped" if skip else "pending",
        )
        db.add(step)
        if not skip and first_pending is None:
            first_pending = step
        seq += 1

    if first_pending is None:
        # Every step skipped → nothing to approve, auto-approve.
        req.status = "approved"
        req.decided_at = datetime.now(timezone.utc)
        req.approver_id = None
    else:
        req.status = "pending"
        req.approver_id = first_pending.approver_id
    return True


async def steps_for(db: AsyncSession, req_id: uuid.UUID) -> list[ApprovalStep]:
    return list(
        (
            await db.execute(
                select(ApprovalStep).where(ApprovalStep.request_id == req_id).order_by(ApprovalStep.seq)
            )
        ).scalars().all()
    )


def current_step(steps: list[ApprovalStep]) -> ApprovalStep | None:
    return next((s for s in steps if s.status == "pending"), None)


def can_decide_step(user: User, step: ApprovalStep) -> bool:
    if user.is_admin:
        return True
    if step.approver_kind == "hr":
        return is_hr(user)
    if step.approver_kind == "admin":
        return user.is_admin
    # manager / user → the concrete resolved approver.
    return step.approver_id == user.id


async def advance(
    db: AsyncSession,
    req: ApprovalRequest,
    steps: list[ApprovalStep],
    step: ApprovalStep,
    user: User,
    decision: str,
    note: str | None,
) -> uuid.UUID | None:
    """Apply ``decision`` to the current step. Returns the next approver_id to
    notify (or None). Sets the request's overall status when terminal."""
    step.status = "approved" if decision == "approved" else "rejected"
    step.decided_by_id = user.id
    step.decided_at = datetime.now(timezone.utc)
    step.note = note

    if decision == "rejected":
        req.status = "rejected"
        req.decided_by_id = user.id
        req.decided_at = datetime.now(timezone.utc)
        req.decision_note = note
        return None

    nxt = next((s for s in steps if s.status == "pending" and s.seq > step.seq), None)
    if nxt:
        req.approver_id = nxt.approver_id
        return nxt.approver_id
    # No more steps → fully approved.
    req.status = "approved"
    req.decided_by_id = user.id
    req.decided_at = datetime.now(timezone.utc)
    req.decision_note = note
    return None

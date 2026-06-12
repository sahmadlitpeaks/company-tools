"""Admin CRUD for configurable approval workflows, plus reading the step
timeline of an individual request."""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_admin, get_current_user
from app.core.database import get_db
from app.models.approval_workflow import APPROVER_KINDS, ApprovalWorkflow
from app.models.user import User
from app.schemas.workplace import (
    ApprovalStepOut,
    WorkflowCreate,
    WorkflowOut,
    WorkflowUpdate,
)
from app.services import approval_engine as engine
from app.services.people import user_names

router = APIRouter(prefix="/approval-workflows", tags=["approvals"])

_TYPES = {"leave", "expense", "purchase", "document", "access", "general"}


def _validate_steps(steps) -> None:
    for s in steps or []:
        kind = s.approver if hasattr(s, "approver") else s.get("approver")
        if kind not in APPROVER_KINDS:
            raise HTTPException(status_code=422, detail=f"Invalid approver kind: {kind}")


@router.get("", response_model=list[WorkflowOut])
async def list_workflows(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_admin)
):
    rows = (await db.execute(select(ApprovalWorkflow).order_by(ApprovalWorkflow.type))).scalars().all()
    return [WorkflowOut(id=w.id, type=w.type, name=w.name, active=w.active, steps=w.steps or [], created_at=w.created_at) for w in rows]


@router.post("", response_model=WorkflowOut, status_code=201)
async def create_workflow(
    body: WorkflowCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    if body.type not in _TYPES:
        raise HTTPException(status_code=422, detail="Invalid approval type")
    _validate_steps(body.steps)
    w = ApprovalWorkflow(
        type=body.type, name=body.name, active=body.active,
        steps=[s.model_dump(mode="json") for s in body.steps],
    )
    db.add(w)
    await db.commit()
    await db.refresh(w)
    return WorkflowOut(id=w.id, type=w.type, name=w.name, active=w.active, steps=w.steps or [], created_at=w.created_at)


@router.patch("/{workflow_id}", response_model=WorkflowOut)
async def update_workflow(
    workflow_id: uuid.UUID,
    body: WorkflowUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    w = await db.get(ApprovalWorkflow, workflow_id)
    if not w:
        raise HTTPException(status_code=404, detail="Workflow not found")
    data = body.model_dump(exclude_unset=True)
    if body.steps is not None:
        _validate_steps(body.steps)
        w.steps = [s.model_dump(mode="json") for s in body.steps]
    if "name" in data:
        w.name = data["name"]
    if "active" in data:
        w.active = data["active"]
    await db.commit()
    await db.refresh(w)
    return WorkflowOut(id=w.id, type=w.type, name=w.name, active=w.active, steps=w.steps or [], created_at=w.created_at)


@router.delete("/{workflow_id}", status_code=204)
async def delete_workflow(
    workflow_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    w = await db.get(ApprovalWorkflow, workflow_id)
    if w:
        await db.delete(w)
        await db.commit()


# Reading the step timeline of a request (any authenticated user involved).
steps_router = APIRouter(prefix="/approvals", tags=["approvals"])


@steps_router.get("/{req_id}/steps", response_model=list[ApprovalStepOut])
async def request_steps(
    req_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    steps = await engine.steps_for(db, req_id)
    names = await user_names(
        db, {s.approver_id for s in steps} | {s.decided_by_id for s in steps}
    )
    out = []
    for s in steps:
        item = ApprovalStepOut.model_validate(s)
        item.approver_name = names.get(s.approver_id) if s.approver_id else None
        item.decided_by_name = names.get(s.decided_by_id) if s.decided_by_id else None
        out.append(item)
    return out

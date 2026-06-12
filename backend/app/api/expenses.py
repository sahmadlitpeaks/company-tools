"""Expense claims with reimbursement tracking.

Employees create/submit claims and upload receipts; submitting raises an
``expense`` approval request so the claim flows through any configured approval
workflow. HR/managers review (via the approvals UI) and mark approved claims
reimbursed. A claim's status mirrors its linked approval request.
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.core.permissions import is_hr
from app.models.expense import EXPENSE_CATEGORIES, ExpenseClaim
from app.models.user import User
from app.models.workplace import ApprovalRequest
from app.schemas.expense import ExpenseCreate, ExpenseOut, ExpenseUpdate
from app.services import approval_engine as engine
from app.services.activity import record
from app.services.notify import notify_user
from app.services.people import user_names
from app.services.storage import absolute_path, save_upload

router = APIRouter(prefix="/expenses", tags=["expenses"])


def _can_view(viewer: User, claim: ExpenseClaim) -> bool:
    return viewer.id == claim.user_id or is_hr(viewer) or viewer.role == "manager"


async def _sync_status(db: AsyncSession, claim: ExpenseClaim) -> None:
    """Reflect the linked approval's status onto the claim (unless terminal)."""
    if claim.status in ("draft", "reimbursed") or not claim.approval_request_id:
        return
    req = await db.get(ApprovalRequest, claim.approval_request_id)
    if not req:
        return
    mapping = {"pending": "submitted", "approved": "approved", "rejected": "rejected", "cancelled": "draft"}
    new = mapping.get(req.status)
    if new and new != claim.status:
        claim.status = new


async def _out(db: AsyncSession, claim: ExpenseClaim, names: dict | None = None) -> ExpenseOut:
    if names is None:
        names = await user_names(db, {claim.user_id})
    out = ExpenseOut.model_validate(claim)
    out.user_name = names.get(claim.user_id)
    out.has_receipt = bool(claim.receipt_path)
    return out


@router.get("/my", response_model=list[ExpenseOut])
async def my_expenses(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    rows = (
        await db.execute(
            select(ExpenseClaim).where(ExpenseClaim.user_id == user.id).order_by(ExpenseClaim.created_at.desc())
        )
    ).scalars().all()
    for c in rows:
        await _sync_status(db, c)
    await db.commit()
    names = {user.id: user.display_name or user.email}
    return [await _out(db, c, names) for c in rows]


@router.get("", response_model=list[ExpenseOut])
async def list_expenses(
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """HR/managers see all claims (e.g. to action reimbursements)."""
    if not (is_hr(user) or user.role == "manager"):
        raise HTTPException(status_code=403, detail="Managers/HR only")
    stmt = select(ExpenseClaim).order_by(ExpenseClaim.created_at.desc())
    rows = (await db.execute(stmt)).scalars().all()
    for c in rows:
        await _sync_status(db, c)
    await db.commit()
    if status:
        rows = [c for c in rows if c.status == status]
    names = await user_names(db, {c.user_id for c in rows})
    return [await _out(db, c, names) for c in rows]


@router.post("", response_model=ExpenseOut, status_code=201)
async def create_expense(
    body: ExpenseCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if body.category not in EXPENSE_CATEGORIES:
        raise HTTPException(status_code=422, detail="Invalid category")
    claim = ExpenseClaim(
        user_id=user.id, title=body.title, category=body.category, currency=body.currency,
        amount=body.amount, expense_date=body.expense_date, description=body.description,
    )
    db.add(claim)
    await db.commit()
    await db.refresh(claim)
    return await _out(db, claim)


@router.patch("/{claim_id}", response_model=ExpenseOut)
async def update_expense(
    claim_id: uuid.UUID,
    body: ExpenseUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    claim = await db.get(ExpenseClaim, claim_id)
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")
    if claim.user_id != user.id:
        raise HTTPException(status_code=403, detail="Only the owner can edit")
    if claim.status != "draft":
        raise HTTPException(status_code=409, detail="Only draft claims can be edited")
    data = body.model_dump(exclude_unset=True)
    if "category" in data and data["category"] not in EXPENSE_CATEGORIES:
        raise HTTPException(status_code=422, detail="Invalid category")
    for k, v in data.items():
        setattr(claim, k, v)
    await db.commit()
    await db.refresh(claim)
    return await _out(db, claim)


@router.post("/{claim_id}/submit", response_model=ExpenseOut)
async def submit_expense(
    claim_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    claim = await db.get(ExpenseClaim, claim_id)
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")
    if claim.user_id != user.id:
        raise HTTPException(status_code=403, detail="Only the owner can submit")
    if claim.status != "draft":
        raise HTTPException(status_code=409, detail="Already submitted")

    # Raise an approval request that flows through any configured workflow.
    req = ApprovalRequest(
        type="expense", title=f"Expense: {claim.title}", amount=claim.amount,
        details=claim.description, requester_id=user.id,
    )
    db.add(req)
    await db.flush()
    await engine.instantiate(db, req, user)
    claim.approval_request_id = req.id
    claim.status = "approved" if req.status == "approved" else "submitted"
    if req.approver_id and req.status == "pending":
        await notify_user(
            db, user_id=req.approver_id, title="Expense approval needed",
            body=f"{user.display_name or user.email}: {claim.title}", link="/approvals",
            category="approval",
        )
    record(db, user=user, action="created", entity_type="approval", entity_id=req.id,
           summary=f"Submitted expense '{claim.title}'")
    await db.commit()
    await db.refresh(claim)
    return await _out(db, claim)


@router.post("/{claim_id}/reimburse", response_model=ExpenseOut)
async def reimburse_expense(
    claim_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not is_hr(user):
        raise HTTPException(status_code=403, detail="HR access required")
    claim = await db.get(ExpenseClaim, claim_id)
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")
    await _sync_status(db, claim)
    if claim.status != "approved":
        raise HTTPException(status_code=409, detail="Only approved claims can be reimbursed")
    claim.status = "reimbursed"
    claim.reimbursed_at = datetime.now(timezone.utc)
    claim.reimbursed_by_id = user.id
    await notify_user(
        db, user_id=claim.user_id, title="Expense reimbursed",
        body=f"{claim.title} has been reimbursed.", link="/expenses", category="info",
    )
    await db.commit()
    await db.refresh(claim)
    return await _out(db, claim)


@router.delete("/{claim_id}", status_code=204)
async def delete_expense(
    claim_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    claim = await db.get(ExpenseClaim, claim_id)
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")
    if claim.user_id != user.id and not is_hr(user):
        raise HTTPException(status_code=403, detail="Not allowed")
    if claim.status not in ("draft", "rejected"):
        raise HTTPException(status_code=409, detail="Only draft or rejected claims can be deleted")
    await db.delete(claim)
    await db.commit()


@router.post("/{claim_id}/receipt", response_model=ExpenseOut)
async def upload_receipt(
    claim_id: uuid.UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    claim = await db.get(ExpenseClaim, claim_id)
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")
    if claim.user_id != user.id:
        raise HTTPException(status_code=403, detail="Only the owner can attach a receipt")
    rel_path, _ = await save_upload(file, subdir="expense-receipts")
    claim.receipt_path = rel_path
    await db.commit()
    await db.refresh(claim)
    return await _out(db, claim)


@router.get("/{claim_id}/receipt")
async def download_receipt(
    claim_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    claim = await db.get(ExpenseClaim, claim_id)
    if not claim or not claim.receipt_path:
        raise HTTPException(status_code=404, detail="No receipt")
    if not _can_view(user, claim):
        raise HTTPException(status_code=403, detail="Not allowed")
    return FileResponse(absolute_path(claim.receipt_path))

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class ExpenseCreate(BaseModel):
    title: str
    category: str = "other"
    currency: str = "USD"
    amount: Decimal
    expense_date: date | None = None
    description: str | None = None


class ExpenseUpdate(BaseModel):
    title: str | None = None
    category: str | None = None
    currency: str | None = None
    amount: Decimal | None = None
    expense_date: date | None = None
    description: str | None = None


class ExpenseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    user_name: str | None = None
    title: str
    category: str
    currency: str
    amount: Decimal
    expense_date: date | None = None
    description: str | None = None
    has_receipt: bool = False
    status: str
    approval_request_id: uuid.UUID | None = None
    reimbursed_at: datetime | None = None
    created_at: datetime

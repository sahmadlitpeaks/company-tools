import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class PayslipItem(BaseModel):
    label: str
    amount: Decimal
    kind: str = "earning"  # "earning" | "deduction"


class PayslipOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    run_id: uuid.UUID
    user_id: uuid.UUID
    employee_name: str | None = None
    period: str | None = None
    currency: str
    base_salary: Decimal
    items: list[PayslipItem] = []
    gross: Decimal
    deductions: Decimal
    net: Decimal


class PayslipUpdate(BaseModel):
    items: list[PayslipItem]


class RunCreate(BaseModel):
    period: str  # "YYYY-MM"
    note: str | None = None


class RunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    period: str
    status: str
    note: str | None = None
    created_at: datetime
    payslip_count: int = 0
    total_net: Decimal = Decimal("0")

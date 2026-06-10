from datetime import datetime
from typing import Any

from pydantic import BaseModel


class ReportColumn(BaseModel):
    key: str
    label: str


class CatalogItem(BaseModel):
    key: str
    title: str
    description: str
    group: str
    sensitive: bool = False


class ReportOut(BaseModel):
    key: str
    title: str
    columns: list[ReportColumn] = []
    rows: list[dict[str, Any]] = []
    generated_at: datetime


class EmployeeQuery(BaseModel):
    columns: list[str] = []
    department_id: str | None = None
    status: str | None = None
    employment_type: str | None = None

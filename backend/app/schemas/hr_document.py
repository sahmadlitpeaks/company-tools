import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class HrDocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    user_name: str | None = None
    title: str
    category: str
    content_type: str | None = None
    size_bytes: int = 0
    issue_date: date | None = None
    expiry_date: date | None = None
    notes: str | None = None
    uploaded_by_id: uuid.UUID | None = None
    created_at: datetime
    # Days until expiry (negative = already expired); None if no expiry.
    days_to_expiry: int | None = None

import uuid
from datetime import date

from pydantic import BaseModel


class Celebration(BaseModel):
    user_id: uuid.UUID
    name: str | None = None
    avatar_url: str | None = None
    # birthday | anniversary | new_hire
    kind: str
    label: str           # e.g. "Today", "in 3 days", "Mon 14 Jul"
    detail: str | None = None  # e.g. "3 years", job title
    days_until: int = 0


class WhosOutToday(BaseModel):
    user_id: uuid.UUID | None = None
    name: str | None = None
    avatar_url: str | None = None
    leave_type: str | None = None
    until: date | None = None


class HomeFeed(BaseModel):
    celebrations: list[Celebration] = []
    whos_out: list[WhosOutToday] = []

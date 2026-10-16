"""Strict decision write contracts; lifecycle changes have separate endpoints."""
import uuid
from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator

Category = Literal["business", "product", "technical", "operational", "security_compliance", "other"]
Status = Literal["draft", "pending_approval", "approved", "rejected", "superseded", "archived"]
IssueRelationship = Literal["relates_to", "implements", "affects", "depends_on"]


class StrictInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class EvidenceInput(StrictInput):
    type: Literal["teams", "document", "meeting", "other"] = "other"
    label: str = Field(min_length=1, max_length=255)
    url: HttpUrl

    @field_validator("url")
    @classmethod
    def no_url_credentials(cls, value):
        if value.username or value.password:
            raise ValueError("Evidence links cannot contain credentials")
        if len(str(value)) > 2048:
            raise ValueError("Evidence URL is too long")
        return value


class DecisionContent(StrictInput):
    title: str = Field(min_length=1, max_length=255)
    category: Category = "business"
    context: str = Field(min_length=1, max_length=20000)
    approach: str = Field(min_length=1, max_length=20000)
    rationale: str = Field(min_length=1, max_length=20000)
    alternatives: str = Field(default="", max_length=20000)
    owner_id: uuid.UUID
    approver_id: uuid.UUID | None = None
    effective_date: date | None = None
    issue_ids: list[uuid.UUID] = Field(default_factory=list, max_length=100)
    evidence: list[EvidenceInput] = Field(default_factory=list, max_length=30)


class DecisionUpdate(DecisionContent):
    version: int = Field(ge=1)


class VersionInput(StrictInput):
    version: int = Field(ge=1)


class SubmitInput(VersionInput):
    change_summary: str = Field(min_length=1, max_length=2000)


class IssueLinkInput(VersionInput):
    issue_id: uuid.UUID
    relationship: IssueRelationship = "relates_to"


class ApprovalInput(VersionInput):
    revision_number: int = Field(ge=1)
    outcome: Literal["approved", "rejected"]
    note: str = Field(default="", max_length=2000)


class ReasonInput(VersionInput):
    reason: str = Field(min_length=1, max_length=2000)


class SupersedeInput(ReasonInput):
    replacement_id: uuid.UUID

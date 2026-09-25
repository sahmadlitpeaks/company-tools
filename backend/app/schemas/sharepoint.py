import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Segment(StrictModel):
    id: str
    location: str
    text: str


class Evidence(StrictModel):
    segment_id: str
    quote: str = Field(min_length=1, max_length=1500)


class Finding(StrictModel):
    title: str = Field(max_length=1000)
    owner: str | None
    deadline: str | None
    status: Literal["unknown", "pending", "in_progress", "completed", "blocked"]
    priority: Literal["unknown", "low", "medium", "high"]
    evidence: list[Evidence] = Field(min_length=1, max_length=8)

    @field_validator("deadline")
    @classmethod
    def valid_deadline(cls, value):
        if value is not None:
            from datetime import date
            if date.fromisoformat(value).isoformat() != value:
                raise ValueError("Use an unambiguous ISO date")
        return value


class ExpiryFinding(StrictModel):
    title: str = Field(max_length=1000)
    date: str = Field(max_length=20)
    category: Literal["expiry", "renewal", "effective", "warranty", "milestone", "deadline", "other"] = "expiry"
    responsible: str | None = None
    evidence: list[Evidence] = Field(min_length=1, max_length=8)

    @field_validator("date")
    @classmethod
    def valid_date(cls, value):
        if value is not None:
            from datetime import date
            if date.fromisoformat(value).isoformat() != value:
                raise ValueError("Use an unambiguous ISO date")
        return value


class CommercialFinding(StrictModel):
    description: str = Field(max_length=1000)
    amount: float | None = None
    currency: str | None = Field(default=None, max_length=10)
    payment_terms: str | None = Field(default=None, max_length=500)
    billing_frequency: Literal["one_time", "monthly", "quarterly", "annual", "milestone", "unknown"] = "unknown"
    evidence: list[Evidence] = Field(min_length=1, max_length=8)


class TextFact(StrictModel):
    value: str = Field(min_length=1, max_length=500)
    evidence: list[Evidence] = Field(min_length=1, max_length=5)


class DateFact(TextFact):
    @field_validator("value")
    @classmethod
    def valid_date(cls, value):
        from datetime import date
        if date.fromisoformat(value).isoformat() != value:
            raise ValueError("Use an unambiguous ISO date")
        return value


class NoticeFact(StrictModel):
    days: int = Field(ge=1, le=730)
    evidence: list[Evidence] = Field(min_length=1, max_length=5)


class ComplianceExtraction(StrictModel):
    document_type: Literal["trade_license", "contract", "iso_cap_certificate", "insurance", "dpa", "regulatory_license", "vendor_agreement", "laboratory_accreditation", "it_software_agreement", "other", "unknown"]
    type_evidence: list[Evidence] = Field(default_factory=list, max_length=5)
    company: TextFact | None = None
    reference_number: TextFact | None = None
    issue_date: DateFact | None = None
    effective_date: DateFact | None = None
    expiry_date: DateFact | None = None
    renewal_date: DateFact | None = None
    termination_notice: NoticeFact | None = None
    parties: list[TextFact] = Field(default_factory=list, max_length=20)
    obligations: list[TextFact] = Field(default_factory=list, max_length=30)
    required_actions: list[Finding] = Field(default_factory=list, max_length=30)
    validation_issues: list[str] = Field(default_factory=list, max_length=30)


class DocumentAnalysis(StrictModel):
    summary: str = Field(max_length=6000)
    summary_evidence: list[Evidence] = Field(min_length=1, max_length=20)
    tasks: list[Finding] = Field(default_factory=list, max_length=100)
    deadlines: list[Finding] = Field(default_factory=list, max_length=100)
    risks: list[Finding] = Field(default_factory=list, max_length=100)
    blockers: list[Finding] = Field(default_factory=list, max_length=100)
    contacts: list[Finding] = Field(default_factory=list, max_length=100)
    expiries: list[ExpiryFinding] = Field(default_factory=list, max_length=100)
    commercials: list[CommercialFinding] = Field(default_factory=list, max_length=100)
    project_status: str | None = None
    requires_attention: bool = False
    compliance: ComplianceExtraction


class ConfidentialTerm(StrictModel):
    value: str = Field(min_length=2, max_length=300)
    kind: Literal["PERSON", "CLIENT", "PROJECT", "ORGANIZATION", "ADDRESS", "VALUE", "CONFIDENTIAL"]


class RulesIn(StrictModel):
    policy: Literal["auto", "review", "test", "skip"] = "auto"
    terms: list[ConfidentialTerm] = Field(default_factory=list, max_length=500)


class ApprovalIn(StrictModel):
    payload_hash: str = Field(pattern=r"^[a-f0-9]{64}$")


class SearchIn(StrictModel):
    q: str = Field(default="", max_length=200)
    cursor: str | None = Field(default=None, max_length=4096)


class ChatMessage(StrictModel):
    role: Literal["user", "assistant", "system"]
    content: str = Field(min_length=1, max_length=4000)


class ChatIn(StrictModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=50)


class ChatCitation(StrictModel):
    document_id: str
    document_name: str
    document_path: str | None = None
    document_url: str | None = None
    location: str | None = None
    quote: str | None = None


class CentralChatIn(StrictModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=50)
    document_ids: list[str] | None = Field(default=None, max_length=100)


class ReminderOut(StrictModel):
    id: str
    task_id: str | None = None
    document_id: str
    document_name: str | None = None
    document_path: str | None = None
    document_url: str | None = None
    title: str
    category: str
    target_date: str
    reminder_date: str
    lead_days: int
    responsible_name: str | None = None
    recipient_email: str | None = None
    amount: float | None = None
    currency: str | None = None
    status: str
    notes: str | None = None
    sent_at: str | None = None
    delivery_channels: list[str] | None = None
    last_error: str | None = None
    attempts: int = 0


class ReminderUpdateIn(StrictModel):
    status: Literal["pending", "completed", "dismissed"] | None = None
    target_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    responsible_name: str | None = None
    recipient_email: str | None = None
    notes: str | None = None


class OwnerRuleIn(StrictModel):
    company_id: uuid.UUID | None = None
    document_type: Literal["trade_license", "contract", "iso_cap_certificate", "insurance", "dpa", "regulatory_license", "vendor_agreement", "laboratory_accreditation", "it_software_agreement", "other"] | None = None
    folder_name: str | None = Field(default=None, max_length=128)
    owner_user_id: uuid.UUID | None = None
    owner_department_id: uuid.UUID | None = None
    reminder_leads: list[int] = Field(default_factory=lambda: [60, 30, 28, 21, 14, 7, 6, 5, 4, 3, 2, 1, 0, -1], max_length=100)
    priority: int = Field(default=100, ge=0, le=1000)

    @field_validator("folder_name")
    @classmethod
    def valid_folder_name(cls, value):
        if value is None:
            return None
        value = value.strip()
        if not value or value in {".", ".."} or "/" in value or "\\" in value:
            raise ValueError("Enter one SharePoint folder name, without a path")
        return value

    @field_validator("reminder_leads")
    @classmethod
    def valid_leads(cls, value):
        if any(not -365 <= lead <= 730 for lead in value) or len(value) != len(set(value)):
            raise ValueError("Invalid reminder schedule")
        return value


class ComplianceReviewIn(StrictModel):
    company_id: uuid.UUID
    document_type: Literal["trade_license", "contract", "iso_cap_certificate", "insurance", "dpa", "regulatory_license", "vendor_agreement", "laboratory_accreditation", "it_software_agreement", "other"]
    reference_number: str | None = Field(default=None, max_length=255)
    expiry_date: str | None = None
    renewal_date: str | None = None
    termination_notice_days: int | None = Field(default=None, ge=1, le=730)
    owner_user_id: uuid.UUID | None = None
    owner_department_id: uuid.UUID | None = None
    review_note: str = Field(min_length=3, max_length=2000)

    @field_validator("expiry_date", "renewal_date")
    @classmethod
    def valid_optional_date(cls, value):
        if value is not None:
            from datetime import date
            if date.fromisoformat(value).isoformat() != value:
                raise ValueError("Use an unambiguous ISO date")
        return value


class ComplianceTaskUpdateIn(StrictModel):
    status: Literal["active", "completed"]
    note: str | None = Field(default=None, max_length=2000)


class ComplianceTaskAssignIn(StrictModel):
    owner_user_id: uuid.UUID | None = None
    owner_department_id: uuid.UUID | None = None
    note: str = Field(min_length=3, max_length=2000)

    @field_validator("note")
    @classmethod
    def valid_note(cls, value):
        value = value.strip()
        if len(value) < 3:
            raise ValueError("Explain why the task owner is changing")
        return value

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, field_validator

from app.models.intake import (
    BLOCK_ACTIONS,
    BLOCK_KINDS,
    DESTINATIONS,
    SUBMISSION_TYPES,
)
from app.services.intake_mapping import TARGETS, TRANSFORMS
from app.services.intake_routing import CONDITION_KINDS, CONDITION_OPS

# Bounds on an admin-supplied mapping document, so a saved mapping can never
# become an unbounded blob or a source of runtime surprises.
MAX_RULES = 100
MAX_SOURCES_PER_RULE = 5


class SourceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    key: str
    default_type: str
    active: bool
    auto_convert: bool = False
    notify_user_id: uuid.UUID | None = None
    rate_limit_per_min: int = 60
    dedup_window_min: int = 10
    spam_threshold: int | None = None
    clean_threshold: int | None = None
    has_signing_secret: bool = False
    site_url: str | None = None
    signature_ttl_sec: int = 300
    require_timestamp: bool = False
    auto_create_forms: bool = True
    captcha_mode: str = "off"
    created_at: datetime
    submission_count: int = 0
    form_count: int = 0


class SourceCreate(BaseModel):
    name: str
    default_type: str = "lead"
    auto_convert: bool = False
    notify_user_id: uuid.UUID | None = None
    rate_limit_per_min: int = 60
    dedup_window_min: int = 10
    spam_threshold: int | None = None
    clean_threshold: int | None = None
    site_url: str | None = None
    signature_ttl_sec: int = 300
    require_timestamp: bool = False
    auto_create_forms: bool = True
    captcha_mode: str = "off"


class SourceUpdate(BaseModel):
    name: str | None = None
    default_type: str | None = None
    active: bool | None = None
    auto_convert: bool | None = None
    notify_user_id: uuid.UUID | None = None
    rate_limit_per_min: int | None = None
    dedup_window_min: int | None = None
    spam_threshold: int | None = None
    clean_threshold: int | None = None
    site_url: str | None = None
    signature_ttl_sec: int | None = None
    require_timestamp: bool | None = None
    auto_create_forms: bool | None = None
    captcha_mode: str | None = None


# ---- Forms and mapping ---------------------------------------------------
class MappingRule(BaseModel):
    """One instruction: take these fields, and put them there."""

    sources: list[str]
    target: str
    combine: str = "first"
    join: str = " "
    transform: list[str] = []
    label: str | None = None

    @field_validator("sources")
    @classmethod
    def _check_sources(cls, v: list[str]) -> list[str]:
        cleaned = [s for s in v if s and s.strip()]
        if not cleaned:
            raise ValueError("A rule needs at least one source field")
        if len(cleaned) > MAX_SOURCES_PER_RULE:
            raise ValueError(f"At most {MAX_SOURCES_PER_RULE} source fields per rule")
        return cleaned

    @field_validator("target")
    @classmethod
    def _check_target(cls, v: str) -> str:
        if v not in TARGETS:
            raise ValueError(f"Unknown target '{v}'")
        return v

    @field_validator("combine")
    @classmethod
    def _check_combine(cls, v: str) -> str:
        if v not in ("first", "join"):
            raise ValueError("combine must be 'first' or 'join'")
        return v

    @field_validator("transform")
    @classmethod
    def _check_transform(cls, v: list[str]) -> list[str]:
        for op in v:
            if op not in TRANSFORMS:
                raise ValueError(f"Unknown transform '{op}'")
        return v


class MappingDoc(BaseModel):
    version: int = 1
    rules: list[MappingRule] = []
    extras: str = "keep"

    @field_validator("rules")
    @classmethod
    def _check_rules(cls, v: list[MappingRule]) -> list[MappingRule]:
        if len(v) > MAX_RULES:
            raise ValueError(f"At most {MAX_RULES} mapping rules")
        return v


class FormFieldOut(BaseModel):
    name: str
    label: str | None = None
    type: str | None = None
    options: list[Any] | None = None
    required: bool = False
    sample: str | None = None
    seen_count: int = 0
    origin: str | None = None


class FormOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    source_id: uuid.UUID
    source_name: str | None = None
    form_key: str
    name: str
    provider: str
    site_url: str | None = None
    mapping_status: str
    destination: str
    default_type: str | None = None
    auto_convert: bool | None = None
    notify_user_id: uuid.UUID | None = None
    job_id: uuid.UUID | None = None
    active: bool
    submission_count: int = 0
    last_submission_at: datetime | None = None
    field_count: int = 0
    created_at: datetime


class FormDetailOut(FormOut):
    fields: list[FormFieldOut] = []
    mapping: MappingDoc | None = None
    unmapped_targets: list[str] = []


class FormUpdate(BaseModel):
    name: str | None = None
    destination: str | None = None
    default_type: str | None = None
    auto_convert: bool | None = None
    notify_user_id: uuid.UUID | None = None
    job_id: uuid.UUID | None = None
    active: bool | None = None

    @field_validator("destination")
    @classmethod
    def _check_destination(cls, v: str | None) -> str | None:
        if v is not None and v not in DESTINATIONS:
            raise ValueError(f"Unknown destination '{v}'")
        return v

    @field_validator("default_type")
    @classmethod
    def _check_type(cls, v: str | None) -> str | None:
        if v is not None and v not in SUBMISSION_TYPES:
            raise ValueError(f"Unknown submission type '{v}'")
        return v


class MappingPreviewIn(BaseModel):
    """Try a candidate mapping against real submissions without saving it."""

    mapping: MappingDoc | None = None
    submission_id: uuid.UUID | None = None
    sample: dict[str, Any] | None = None
    limit: int = 3


class MappingPreviewItem(BaseModel):
    submission_id: uuid.UUID | None = None
    received_at: datetime | None = None
    core: dict[str, str | None] = {}
    extras: dict[str, Any] = {}
    labels: dict[str, str] = {}
    status: str = "none"
    notes: list[str] = []
    spam_score: int = 0
    spam_reasons: list[str] = []


class MappingPreviewOut(BaseModel):
    items: list[MappingPreviewItem] = []
    unmapped_targets: list[str] = []


class RemapIn(BaseModel):
    limit: int = 200
    only_unconverted: bool = True
    dry_run: bool = False
    resync_leads: bool = False


class RemapOut(BaseModel):
    examined: int = 0
    updated: int = 0
    skipped_no_raw: int = 0
    leads_updated: int = 0
    dry_run: bool = False


# ---- Routing rules -------------------------------------------------------
class RoutingCondition(BaseModel):
    kind: str
    op: str = "contains"
    value: str | None = None
    field: str | None = None

    @field_validator("kind")
    @classmethod
    def _check_kind(cls, v: str) -> str:
        if v not in CONDITION_KINDS:
            raise ValueError(f"Unknown condition kind '{v}'")
        return v

    @field_validator("op")
    @classmethod
    def _check_op(cls, v: str) -> str:
        if v not in CONDITION_OPS:
            raise ValueError(f"Unknown operator '{v}'")
        return v


class RoutingOutcome(BaseModel):
    type: str | None = None
    destination: str | None = None
    job_id: uuid.UUID | None = None
    job_from_field: str | None = None
    assignee_id: uuid.UUID | None = None
    auto_convert: bool | None = None
    tag: str | None = None

    @field_validator("type")
    @classmethod
    def _check_type(cls, v: str | None) -> str | None:
        if v is not None and v not in SUBMISSION_TYPES:
            raise ValueError(f"Unknown submission type '{v}'")
        return v

    @field_validator("destination")
    @classmethod
    def _check_destination(cls, v: str | None) -> str | None:
        if v is not None and v not in DESTINATIONS:
            raise ValueError(f"Unknown destination '{v}'")
        return v


class RoutingRuleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    source_id: uuid.UUID | None = None
    form_id: uuid.UUID | None = None
    priority: int
    active: bool
    conditions: list[RoutingCondition] = []
    outcome: RoutingOutcome | None = None
    match_count: int = 0
    created_at: datetime


class RoutingRuleCreate(BaseModel):
    name: str
    source_id: uuid.UUID | None = None
    form_id: uuid.UUID | None = None
    priority: int = 100
    active: bool = True
    conditions: list[RoutingCondition] = []
    outcome: RoutingOutcome = RoutingOutcome()


class RoutingRuleUpdate(BaseModel):
    name: str | None = None
    source_id: uuid.UUID | None = None
    form_id: uuid.UUID | None = None
    priority: int | None = None
    active: bool | None = None
    conditions: list[RoutingCondition] | None = None
    outcome: RoutingOutcome | None = None


class RoutingTestIn(BaseModel):
    submission_id: uuid.UUID


class RoutingTestOut(BaseModel):
    rule_id: uuid.UUID | None = None
    rule_name: str | None = None
    type: str | None = None
    destination: str | None = None
    job_id: uuid.UUID | None = None


# ---- Blocklist -----------------------------------------------------------
class BlocklistOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kind: str
    value: str
    action: str
    reason: str | None = None
    source_id: uuid.UUID | None = None
    hit_count: int = 0
    expires_at: datetime | None = None
    created_at: datetime


class BlocklistCreate(BaseModel):
    kind: str
    value: str
    action: str = "block"
    reason: str | None = None
    source_id: uuid.UUID | None = None
    expires_at: datetime | None = None

    @field_validator("kind")
    @classmethod
    def _check_kind(cls, v: str) -> str:
        if v not in BLOCK_KINDS:
            raise ValueError(f"Unknown blocklist kind '{v}'")
        return v

    @field_validator("action")
    @classmethod
    def _check_action(cls, v: str) -> str:
        if v not in BLOCK_ACTIONS:
            raise ValueError(f"Unknown blocklist action '{v}'")
        return v

    @field_validator("value")
    @classmethod
    def _check_value(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("A blocklist entry needs a value")
        return v.strip()


# ---- Submissions ---------------------------------------------------------
class SubmissionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    source_id: uuid.UUID | None = None
    source_name: str | None = None
    type: str
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    company: str | None = None
    subject: str | None = None
    message: str | None = None
    page_url: str | None = None
    payload: dict | None = None
    status: str
    spam_score: int = 0
    spam_reasons: list[str] | None = None
    assignee_id: uuid.UUID | None = None
    assignee_name: str | None = None
    converted_lead_id: uuid.UUID | None = None
    converted_ticket_id: uuid.UUID | None = None
    converted_candidate_id: uuid.UUID | None = None
    form_id: uuid.UUID | None = None
    form_name: str | None = None
    site_url: str | None = None
    mapping_status: str = "none"
    utm: dict | None = None
    referrer: str | None = None
    external_id: str | None = None
    # Human labels for the keys in `payload`, resolved from the form catalogue
    # at read time so relabelling a form fixes every past submission at once.
    field_labels: dict[str, str] | None = None
    raw_payload: dict | None = None
    created_at: datetime


class SubmissionUpdate(BaseModel):
    status: str | None = None
    type: str | None = None
    assignee_id: uuid.UUID | None = None


class IntakeSummary(BaseModel):
    new: int = 0
    by_status: dict[str, int] = {}
    by_type: dict[str, int] = {}


class MappingTargetsOut(BaseModel):
    """Catalogue driving the mapping editor's selects."""

    targets: list[str] = TARGETS
    transforms: list[str] = TRANSFORMS
    destinations: list[str] = sorted(DESTINATIONS)
    types: list[str] = sorted(SUBMISSION_TYPES)
    condition_kinds: list[str] = CONDITION_KINDS
    condition_ops: list[str] = CONDITION_OPS
    blocklist_kinds: list[str] = sorted(BLOCK_KINDS)
    blocklist_actions: list[str] = sorted(BLOCK_ACTIONS)


# Public payload is free-form; common fields are mapped, the rest kept in payload.
class IntakeIn(BaseModel):
    type: str | None = None
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    company: str | None = None
    subject: str | None = None
    message: str | None = None
    page_url: str | None = None
    fields: dict[str, Any] | None = None


class IngestSchemaIn(BaseModel):
    """A form's field definitions, pushed when the site owner saves the form.

    Lets an admin configure the mapping before a single real enquiry arrives.
    """

    form: dict[str, Any]
    site: dict[str, Any] | None = None

"""Validated project configuration and saved views."""
import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.pm import PmIssueUpdate


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class WorkflowState(Contract):
    key: str = Field(pattern=r"^[a-z][a-z0-9_]{0,63}$")
    name: str = Field(min_length=1, max_length=80)
    category: Literal["todo", "in_progress", "in_review", "done"]
    allowed_next: list[str] | None = Field(default=None, max_length=40)


def default_states():
    return [WorkflowState(key=key, name=name, category=key) for key, name in (
        ("todo", "To Do"), ("in_progress", "In Progress"),
        ("in_review", "In Review"), ("done", "Done"),
    )]


class CustomField(Contract):
    key: str = Field(pattern=r"^[a-z][a-z0-9_]{0,63}$")
    name: str = Field(min_length=1, max_length=80)
    kind: Literal["text", "number", "date", "select", "checkbox"] = "text"
    required: bool = False
    options: list[str] = Field(default_factory=list, max_length=30)

    @model_validator(mode="after")
    def choices(self):
        if self.kind == "select" and not self.options:
            raise ValueError("A selection field needs options.")
        if any(not value.strip() or len(value) > 120 for value in self.options):
            raise ValueError("Options must be between 1 and 120 characters.")
        if len(set(self.options)) != len(self.options):
            raise ValueError("Options must be unique.")
        return self


class Component(Contract):
    key: str = Field(pattern=r"^[a-z][a-z0-9_]{0,63}$")
    name: str = Field(min_length=1, max_length=80)
    lead_id: uuid.UUID | None = None


class IssueTemplate(Contract):
    key: str = Field(pattern=r"^[a-z][a-z0-9_]{0,63}$")
    name: str = Field(min_length=1, max_length=80)
    issue_type: Literal["epic", "story", "task", "bug"] = "task"
    description: str = Field(default="", max_length=20000)
    priority: Literal["highest", "high", "medium", "low", "lowest"] = "medium"


class WorkspaceConfig(Contract):
    states: list[WorkflowState] = Field(default_factory=default_states, min_length=4, max_length=40)
    fields: list[CustomField] = Field(default_factory=list, max_length=30)
    components: list[Component] = Field(default_factory=list, max_length=50)
    templates: list[IssueTemplate] = Field(default_factory=list, max_length=30)

    @model_validator(mode="after")
    def configuration(self):
        for rows in (self.states, self.fields, self.components, self.templates):
            if len({item.key for item in rows}) != len(rows):
                raise ValueError("Keys must be unique.")
            if any(not item.name.strip() for item in rows):
                raise ValueError("Enter a name.")
        states = {item.key: item for item in self.states}
        # Keep canonical destinations for legacy clients, imports and reporting.
        for category in ("todo", "in_progress", "in_review", "done"):
            if category not in states or states[category].category != category:
                raise ValueError("Keep the four standard workflow states and their categories.")
        for state in self.states:
            if state.allowed_next is not None and (
                len(set(state.allowed_next)) != len(state.allowed_next)
                or any(key not in states for key in state.allowed_next)
            ):
                raise ValueError("Transitions must point to unique existing states.")
        return self


class ViewFilters(Contract):
    q: str = Field(default="", max_length=255)
    issue_type: str = ""
    status: str = ""
    workflow_state: str = ""
    priority: str = ""
    assignee: str = ""
    parent_id: str = ""
    sprint: str = ""
    label: str = Field(default="", max_length=50)
    component: str = ""
    due_after: str = ""
    due_before: str = ""
    project_ids: list[uuid.UUID] = Field(default_factory=list, max_length=50)


class BoardColumn(Contract):
    key: str = Field(pattern=r"^[a-z][a-z0-9_]{0,63}$")
    name: str = Field(min_length=1, max_length=80)
    states: list[str] = Field(min_length=1, max_length=40)
    limit: int | None = Field(default=None, ge=1, le=1000)


class ViewSettings(Contract):
    layout: Literal["board", "list", "table", "calendar"] = "board"
    board_type: Literal["scrum", "kanban"] = "scrum"
    filters: ViewFilters = Field(default_factory=ViewFilters)
    group_by: Literal["none", "assignee", "epic", "priority"] = "none"
    order_by: Literal["rank", "updated", "created", "due", "priority"] = "rank"
    properties: list[Literal["assignee", "priority", "points", "due", "labels", "component"]] = Field(
        default_factory=lambda: ["assignee", "priority", "points"], max_length=6
    )
    columns: list[BoardColumn] = Field(default_factory=list, max_length=40)

    @model_validator(mode="after")
    def columns_unique(self):
        if len({item.key for item in self.columns}) != len(self.columns):
            raise ValueError("Column keys must be unique.")
        states = [key for column in self.columns for key in column.states]
        if len(states) != len(set(states)):
            raise ValueError("A workflow state belongs to only one column.")
        if len(self.properties) != len(set(self.properties)):
            raise ValueError("Card properties must be unique.")
        if any(not column.name.strip() for column in self.columns):
            raise ValueError("Enter a column name.")
        return self


class ViewIn(Contract):
    name: str = Field(min_length=1, max_length=120)
    visibility: Literal["team", "private"] = "team"
    settings: ViewSettings = Field(default_factory=ViewSettings)

    @field_validator("name")
    @classmethod
    def trimmed(cls, value):
        if not value.strip():
            raise ValueError("Enter a name.")
        return value.strip()


class ViewCreate(ViewIn):
    project_id: uuid.UUID | None = None


class ViewOut(ViewIn):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    project_id: uuid.UUID | None
    owner_id: uuid.UUID
    can_manage: bool = False


class BulkUpdate(Contract):
    issue_ids: list[uuid.UUID] = Field(min_length=1, max_length=100)
    changes: PmIssueUpdate

    @model_validator(mode="after")
    def fields(self):
        if len(set(self.issue_ids)) != len(self.issue_ids):
            raise ValueError("Choose each issue once.")
        if not self.changes.model_fields_set:
            raise ValueError("Choose a field to change.")
        return self

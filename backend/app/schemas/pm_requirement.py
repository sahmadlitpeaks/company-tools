import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

RequirementStatus = Literal["draft", "ready", "in_progress", "delivered", "archived"]


class RequirementContent(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    title: str = Field(min_length=1, max_length=255)
    original_request: str = Field(default="", max_length=50000)
    context: str = Field(default="", max_length=50000)
    functional_requirements: str = Field(default="", max_length=50000)
    technical_requirements: str = Field(default="", max_length=50000)
    scope: str = Field(default="", max_length=50000)
    expected_outcome: str = Field(default="", max_length=50000)
    acceptance_criteria: str = Field(default="", max_length=50000)
    supporting_information: str = Field(default="", max_length=50000)
    owner_id: uuid.UUID | None = None
    status: RequirementStatus = "draft"


class RequirementUpdate(RequirementContent):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    version: int = Field(ge=1)


class RequirementLinkInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    target_id: uuid.UUID

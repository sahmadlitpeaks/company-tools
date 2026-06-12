import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class QuestionIn(BaseModel):
    text: str
    qtype: str = "scale"
    sort: int = 0


class QuestionOut(QuestionIn):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID


class SurveyCreate(BaseModel):
    title: str
    description: str | None = None
    kind: str = "custom"
    anonymous: bool = True
    questions: list[QuestionIn] = []


class SurveyUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    status: str | None = None
    anonymous: bool | None = None


class SurveyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    description: str | None = None
    kind: str
    anonymous: bool
    status: str
    response_count: int = 0
    created_at: datetime
    questions: list[QuestionOut] = []


class AnswerIn(BaseModel):
    question_id: uuid.UUID
    value_num: int | None = None
    value_text: str | None = None


class ResponseIn(BaseModel):
    answers: list[AnswerIn]


class QuestionResult(BaseModel):
    question_id: uuid.UUID
    text: str
    qtype: str
    response_count: int = 0
    average: float | None = None  # for scale questions
    enps: float | None = None  # for nps questions (-100..100)
    text_answers: list[str] = []


class SurveyResults(BaseModel):
    survey_id: uuid.UUID
    title: str
    response_count: int
    questions: list[QuestionResult] = []


class KudosCreate(BaseModel):
    to_user_id: uuid.UUID
    message: str
    value_tag: str | None = None


class KudosOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    from_user_id: uuid.UUID | None = None
    from_name: str | None = None
    to_user_id: uuid.UUID
    to_name: str | None = None
    message: str
    value_tag: str | None = None
    created_at: datetime

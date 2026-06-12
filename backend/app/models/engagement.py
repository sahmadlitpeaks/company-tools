"""Employee engagement — surveys (incl. eNPS pulse) and peer recognition (kudos).

Surveys are authored by HR with typed questions; employees submit responses
that can be anonymous. Kudos are lightweight public shout-outs between peers,
optionally tagged with a company value.
"""
import uuid

from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin

SURVEY_KINDS = {"pulse", "enps", "custom"}
SURVEY_STATUSES = {"draft", "open", "closed"}
QUESTION_TYPES = {"scale", "nps", "text", "boolean"}


class Survey(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "surveys"

    title: Mapped[str] = mapped_column(String(255), index=True)
    description: Mapped[str | None] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(String(16), default="custom", index=True)
    anonymous: Mapped[bool] = mapped_column(default=True)
    status: Mapped[str] = mapped_column(String(16), default="draft", index=True)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    questions: Mapped[list["SurveyQuestion"]] = relationship(
        back_populates="survey", cascade="all, delete-orphan"
    )
    responses: Mapped[list["SurveyResponse"]] = relationship(
        back_populates="survey", cascade="all, delete-orphan"
    )


class SurveyQuestion(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "survey_questions"

    survey_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("surveys.id", ondelete="CASCADE"), index=True
    )
    text: Mapped[str] = mapped_column(Text)
    qtype: Mapped[str] = mapped_column(String(16), default="scale")
    sort: Mapped[int] = mapped_column(Integer, default=0)

    survey: Mapped["Survey"] = relationship(back_populates="questions")


class SurveyResponse(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "survey_responses"

    survey_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("surveys.id", ondelete="CASCADE"), index=True
    )
    # Null when the survey is anonymous.
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )

    survey: Mapped["Survey"] = relationship(back_populates="responses")
    answers: Mapped[list["SurveyAnswer"]] = relationship(
        back_populates="response", cascade="all, delete-orphan"
    )


class SurveyAnswer(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "survey_answers"

    response_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("survey_responses.id", ondelete="CASCADE"), index=True
    )
    question_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("survey_questions.id", ondelete="CASCADE"), index=True
    )
    value_num: Mapped[int | None] = mapped_column(Integer, nullable=True)
    value_text: Mapped[str | None] = mapped_column(Text, nullable=True)

    response: Mapped["SurveyResponse"] = relationship(back_populates="answers")


class Kudos(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "kudos"

    from_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    to_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    message: Mapped[str] = mapped_column(Text)
    value_tag: Mapped[str | None] = mapped_column(String(48), nullable=True)

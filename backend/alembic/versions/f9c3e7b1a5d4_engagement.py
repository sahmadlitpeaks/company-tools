"""Engagement: surveys (incl. eNPS) and kudos

Revision ID: f9c3e7b1a5d4
Revises: e8b2f6a4c1d9
Create Date: 2026-06-11

"""
from alembic import op
import sqlalchemy as sa


revision = "f9c3e7b1a5d4"
down_revision = "e8b2f6a4c1d9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "surveys",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("kind", sa.String(length=16), nullable=False, server_default="custom"),
        sa.Column("anonymous", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="draft"),
        sa.Column("created_by_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_surveys_title", "surveys", ["title"])
    op.create_index("ix_surveys_kind", "surveys", ["kind"])
    op.create_index("ix_surveys_status", "surveys", ["status"])

    op.create_table(
        "survey_questions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("survey_id", sa.Uuid(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("qtype", sa.String(length=16), nullable=False, server_default="scale"),
        sa.Column("sort", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["survey_id"], ["surveys.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_survey_questions_survey_id", "survey_questions", ["survey_id"])

    op.create_table(
        "survey_responses",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("survey_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["survey_id"], ["surveys.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_survey_responses_survey_id", "survey_responses", ["survey_id"])
    op.create_index("ix_survey_responses_user_id", "survey_responses", ["user_id"])

    op.create_table(
        "survey_answers",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("response_id", sa.Uuid(), nullable=False),
        sa.Column("question_id", sa.Uuid(), nullable=False),
        sa.Column("value_num", sa.Integer(), nullable=True),
        sa.Column("value_text", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["response_id"], ["survey_responses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["question_id"], ["survey_questions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_survey_answers_response_id", "survey_answers", ["response_id"])
    op.create_index("ix_survey_answers_question_id", "survey_answers", ["question_id"])

    op.create_table(
        "kudos",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("from_user_id", sa.Uuid(), nullable=True),
        sa.Column("to_user_id", sa.Uuid(), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("value_tag", sa.String(length=48), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["from_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["to_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_kudos_from_user_id", "kudos", ["from_user_id"])
    op.create_index("ix_kudos_to_user_id", "kudos", ["to_user_id"])


def downgrade() -> None:
    op.drop_table("kudos")
    op.drop_index("ix_survey_answers_question_id", table_name="survey_answers")
    op.drop_index("ix_survey_answers_response_id", table_name="survey_answers")
    op.drop_table("survey_answers")
    op.drop_index("ix_survey_responses_user_id", table_name="survey_responses")
    op.drop_index("ix_survey_responses_survey_id", table_name="survey_responses")
    op.drop_table("survey_responses")
    op.drop_index("ix_survey_questions_survey_id", table_name="survey_questions")
    op.drop_table("survey_questions")
    op.drop_index("ix_surveys_status", table_name="surveys")
    op.drop_index("ix_surveys_kind", table_name="surveys")
    op.drop_index("ix_surveys_title", table_name="surveys")
    op.drop_table("surveys")

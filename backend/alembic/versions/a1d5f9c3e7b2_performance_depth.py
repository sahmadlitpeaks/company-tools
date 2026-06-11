"""Performance depth: 360 feedback, 1:1s, continuous feedback

Revision ID: a1d5f9c3e7b2
Revises: f9c3e7b1a5d4
Create Date: 2026-06-11

"""
from alembic import op
import sqlalchemy as sa


revision = "a1d5f9c3e7b2"
down_revision = "f9c3e7b1a5d4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "review_feedback",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("review_id", sa.Uuid(), nullable=False),
        sa.Column("author_id", sa.Uuid(), nullable=False),
        sa.Column("relation", sa.String(length=16), nullable=False, server_default="peer"),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="requested"),
        sa.Column("rating", sa.Integer(), nullable=True),
        sa.Column("strengths", sa.Text(), nullable=True),
        sa.Column("improvements", sa.Text(), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["review_id"], ["reviews.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["author_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_review_feedback_review_id", "review_feedback", ["review_id"])
    op.create_index("ix_review_feedback_author_id", "review_feedback", ["author_id"])
    op.create_index("ix_review_feedback_status", "review_feedback", ["status"])

    op.create_table(
        "one_on_ones",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("manager_id", sa.Uuid(), nullable=False),
        sa.Column("employee_id", sa.Uuid(), nullable=False),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="scheduled"),
        sa.Column("agenda", sa.JSON(), nullable=True),
        sa.Column("shared_notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["manager_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["employee_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_one_on_ones_manager_id", "one_on_ones", ["manager_id"])
    op.create_index("ix_one_on_ones_employee_id", "one_on_ones", ["employee_id"])
    op.create_index("ix_one_on_ones_scheduled_at", "one_on_ones", ["scheduled_at"])
    op.create_index("ix_one_on_ones_status", "one_on_ones", ["status"])

    op.create_table(
        "continuous_feedback",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("from_user_id", sa.Uuid(), nullable=True),
        sa.Column("to_user_id", sa.Uuid(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["from_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["to_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_continuous_feedback_from_user_id", "continuous_feedback", ["from_user_id"])
    op.create_index("ix_continuous_feedback_to_user_id", "continuous_feedback", ["to_user_id"])


def downgrade() -> None:
    op.drop_table("continuous_feedback")
    op.drop_index("ix_one_on_ones_status", table_name="one_on_ones")
    op.drop_index("ix_one_on_ones_scheduled_at", table_name="one_on_ones")
    op.drop_index("ix_one_on_ones_employee_id", table_name="one_on_ones")
    op.drop_index("ix_one_on_ones_manager_id", table_name="one_on_ones")
    op.drop_table("one_on_ones")
    op.drop_index("ix_review_feedback_status", table_name="review_feedback")
    op.drop_index("ix_review_feedback_author_id", table_name="review_feedback")
    op.drop_index("ix_review_feedback_review_id", table_name="review_feedback")
    op.drop_table("review_feedback")

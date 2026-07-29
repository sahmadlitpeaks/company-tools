"""time breaks and correction requests

Revision ID: e1a2b3c4d5f6
Revises: d0c4a8e2f6b1
"""
from alembic import op
import sqlalchemy as sa

revision = "e1a2b3c4d5f6"
down_revision = "d0c4a8e2f6b1"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "time_breaks",
        sa.Column("entry_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["entry_id"], ["time_entries.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_time_breaks_entry_id", "time_breaks", ["entry_id"])
    op.create_index("ix_time_breaks_user_id", "time_breaks", ["user_id"])
    op.create_table(
        "time_correction_requests",
        sa.Column("entry_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("approval_request_id", sa.Uuid(), nullable=True),
        sa.Column("requested_clock_in", sa.DateTime(timezone=True), nullable=True),
        sa.Column("requested_clock_out", sa.DateTime(timezone=True), nullable=True),
        sa.Column("requested_minutes", sa.Integer(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("decided_by_id", sa.Uuid(), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decision_note", sa.Text(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["approval_request_id"], ["approval_requests.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["decided_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["entry_id"], ["time_entries.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("approval_request_id"),
    )
    op.create_index("ix_time_correction_requests_entry_id", "time_correction_requests", ["entry_id"])
    op.create_index("ix_time_correction_requests_status", "time_correction_requests", ["status"])
    op.create_index("ix_time_correction_requests_user_id", "time_correction_requests", ["user_id"])


def downgrade():
    op.drop_table("time_correction_requests")
    op.drop_table("time_breaks")

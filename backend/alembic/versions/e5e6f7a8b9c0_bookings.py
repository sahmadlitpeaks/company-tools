"""booking spaces and reservations

Revision ID: e5e6f7a8b9c0
Revises: e4d5e6f7a8b9
"""
from alembic import op
import sqlalchemy as sa

revision = "e5e6f7a8b9c0"
down_revision = "e4d5e6f7a8b9"
branch_labels = None
depends_on = None


def cols():
    return [
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    ]


def upgrade():
    op.create_table(
        "booking_spaces",
        sa.Column("name", sa.String(180), nullable=False), sa.Column("location", sa.String(255), nullable=False),
        sa.Column("capacity", sa.Integer(), nullable=False), sa.Column("equipment", sa.JSON(), nullable=False),
        sa.Column("type", sa.String(16), nullable=False), sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("company_id", sa.Uuid()), *cols(),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="SET NULL"),
    )
    for c in ("name", "location", "type", "active", "company_id"): op.create_index(f"ix_booking_spaces_{c}", "booking_spaces", [c])
    op.create_table(
        "space_bookings",
        sa.Column("space_id", sa.Uuid(), nullable=False), sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("purpose", sa.String(500), nullable=False), sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False), sa.Column("timezone", sa.String(64), nullable=False),
        sa.Column("status", sa.String(16), nullable=False), sa.Column("company_id", sa.Uuid()), *cols(),
        sa.ForeignKeyConstraint(["space_id"], ["booking_spaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="SET NULL"),
    )
    for c in ("space_id", "user_id", "starts_at", "ends_at", "status", "company_id"): op.create_index(f"ix_space_bookings_{c}", "space_bookings", [c])


def downgrade():
    op.drop_table("space_bookings"); op.drop_table("booking_spaces")

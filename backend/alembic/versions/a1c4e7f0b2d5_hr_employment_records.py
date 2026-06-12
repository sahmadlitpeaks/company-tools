"""HR employment records: user fields + employment_events

Revision ID: a1c4e7f0b2d5
Revises: f7b9d2e5a1c3
Create Date: 2026-06-09

"""
from alembic import op
import sqlalchemy as sa


revision = "a1c4e7f0b2d5"
down_revision = "f7b9d2e5a1c3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("date_of_birth", sa.Date(), nullable=True))
    op.add_column("users", sa.Column("manager_id", sa.Uuid(), nullable=True))
    op.add_column("users", sa.Column("employment_type", sa.String(length=24), nullable=True))
    op.add_column("users", sa.Column("hire_date", sa.Date(), nullable=True))
    op.add_column("users", sa.Column("probation_end_date", sa.Date(), nullable=True))
    op.add_column("users", sa.Column("contract_end_date", sa.Date(), nullable=True))
    op.add_column("users", sa.Column("emergency_contact_name", sa.String(length=255), nullable=True))
    op.add_column("users", sa.Column("emergency_contact_phone", sa.String(length=64), nullable=True))
    op.add_column("users", sa.Column("emergency_contact_relationship", sa.String(length=64), nullable=True))
    op.create_index("ix_users_manager_id", "users", ["manager_id"])
    op.create_foreign_key(
        "fk_users_manager_id", "users", "users", ["manager_id"], ["id"], ondelete="SET NULL"
    )

    op.create_table(
        "employment_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("event_type", sa.String(length=24), nullable=False, server_default="note"),
        sa.Column("effective_date", sa.Date(), nullable=False),
        sa.Column("title", sa.String(length=512), nullable=False),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column("created_by_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_employment_events_user_id", "employment_events", ["user_id"])
    op.create_index("ix_employment_events_event_type", "employment_events", ["event_type"])
    op.create_index("ix_employment_events_effective_date", "employment_events", ["effective_date"])


def downgrade() -> None:
    op.drop_table("employment_events")
    op.drop_constraint("fk_users_manager_id", "users", type_="foreignkey")
    op.drop_index("ix_users_manager_id", table_name="users")
    for col in (
        "emergency_contact_relationship", "emergency_contact_phone", "emergency_contact_name",
        "contract_end_date", "probation_end_date", "hire_date", "employment_type",
        "manager_id", "date_of_birth",
    ):
        op.drop_column("users", col)

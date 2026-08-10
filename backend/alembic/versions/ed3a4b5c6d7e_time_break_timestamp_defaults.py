"""add database defaults for time usability timestamps

Revision ID: ed3a4b5c6d7e
Revises: ec2f3a4b5c6d
"""

from alembic import op
import sqlalchemy as sa


revision = "ed3a4b5c6d7e"
down_revision = "ec2f3a4b5c6d"
branch_labels = None
depends_on = None


def upgrade():
    for table_name in ("time_breaks", "time_correction_requests"):
        op.alter_column(
            table_name,
            "created_at",
            existing_type=sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            existing_nullable=False,
        )
        op.alter_column(
            table_name,
            "updated_at",
            existing_type=sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            existing_nullable=False,
        )


def downgrade():
    for table_name in ("time_breaks", "time_correction_requests"):
        op.alter_column(
            table_name,
            "created_at",
            existing_type=sa.DateTime(timezone=True),
            server_default=None,
            existing_nullable=False,
        )
        op.alter_column(
            table_name,
            "updated_at",
            existing_type=sa.DateTime(timezone=True),
            server_default=None,
            existing_nullable=False,
        )

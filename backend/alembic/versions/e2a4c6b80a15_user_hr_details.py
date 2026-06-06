"""user HR details (personal email, passport, nationality) + optional email

Revision ID: e2a4c6b80a15
Revises: d1f3b5a79864
Create Date: 2026-06-06 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e2a4c6b80a15"
down_revision: Union[str, None] = "d1f3b5a79864"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("personal_email", sa.String(length=320), nullable=True))
    op.add_column("users", sa.Column("passport_no", sa.String(length=64), nullable=True))
    op.add_column("users", sa.Column("nationality", sa.String(length=128), nullable=True))
    op.add_column("users", sa.Column("bamboo_id", sa.String(length=64), nullable=True))
    op.create_index("ix_users_personal_email", "users", ["personal_email"])
    # Official email becomes optional (new joiners may not have one yet).
    op.alter_column("users", "email", existing_type=sa.String(length=320), nullable=True)


def downgrade() -> None:
    op.alter_column("users", "email", existing_type=sa.String(length=320), nullable=False)
    op.drop_index("ix_users_personal_email", table_name="users")
    op.drop_column("users", "bamboo_id")
    op.drop_column("users", "nationality")
    op.drop_column("users", "passport_no")
    op.drop_column("users", "personal_email")

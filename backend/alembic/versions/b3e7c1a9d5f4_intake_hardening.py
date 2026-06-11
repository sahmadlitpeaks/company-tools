"""Intake hardening: HMAC secret, rate limit, dedup, per-source thresholds

Revision ID: b3e7c1a9d5f4
Revises: a1d5f9c3e7b2
Create Date: 2026-06-11

"""
from alembic import op
import sqlalchemy as sa


revision = "b3e7c1a9d5f4"
down_revision = "a1d5f9c3e7b2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("intake_sources") as batch:
        batch.add_column(sa.Column("signing_secret", sa.String(length=128), nullable=True))
        batch.add_column(sa.Column("rate_limit_per_min", sa.Integer(), nullable=False, server_default="60"))
        batch.add_column(sa.Column("dedup_window_min", sa.Integer(), nullable=False, server_default="10"))
        batch.add_column(sa.Column("spam_threshold", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("clean_threshold", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("intake_sources") as batch:
        batch.drop_column("clean_threshold")
        batch.drop_column("spam_threshold")
        batch.drop_column("dedup_window_min")
        batch.drop_column("rate_limit_per_min")
        batch.drop_column("signing_secret")

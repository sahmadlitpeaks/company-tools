"""backup import source and idea identity controls

Revision ID: ec2f3a4b5c6d
Revises: eb1e2f3a4b5c
"""

from alembic import op
import sqlalchemy as sa


revision = "ec2f3a4b5c6d"
down_revision = "eb1e2f3a4b5c"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "backup_records",
        sa.Column(
            "source",
            sa.String(length=20),
            nullable=False,
            server_default="created",
        ),
    )
    op.create_index(
        "ix_backup_records_source",
        "backup_records",
        ["source"],
    )
    op.add_column(
        "ideas",
        sa.Column("submitted_name", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "ideas",
        sa.Column(
            "is_anonymous",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.create_index("ix_ideas_is_anonymous", "ideas", ["is_anonymous"])


def downgrade():
    op.drop_index("ix_ideas_is_anonymous", table_name="ideas")
    op.drop_column("ideas", "is_anonymous")
    op.drop_column("ideas", "submitted_name")
    op.drop_index("ix_backup_records_source", table_name="backup_records")
    op.drop_column("backup_records", "source")

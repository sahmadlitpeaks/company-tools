"""Training: courses, assignments, certifications

Revision ID: b8f2d6a0c4e7
Revises: a7e1c5d9b3f8
Create Date: 2026-06-11

"""
from alembic import op
import sqlalchemy as sa


revision = "b8f2d6a0c4e7"
down_revision = "a7e1c5d9b3f8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "courses",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("category", sa.String(length=48), nullable=True),
        sa.Column("url", sa.String(length=1024), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_by_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_courses_title", "courses", ["title"])
    op.create_index("ix_courses_active", "courses", ["active"])

    op.create_table(
        "course_assignments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("course_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="assigned"),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("assigned_by_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["assigned_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_course_assignments_course_id", "course_assignments", ["course_id"])
    op.create_index("ix_course_assignments_user_id", "course_assignments", ["user_id"])
    op.create_index("ix_course_assignments_status", "course_assignments", ["status"])

    op.create_table(
        "certifications",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("issuer", sa.String(length=255), nullable=True),
        sa.Column("issued_date", sa.Date(), nullable=True),
        sa.Column("expiry_date", sa.Date(), nullable=True),
        sa.Column("credential_id", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_certifications_user_id", "certifications", ["user_id"])
    op.create_index("ix_certifications_expiry_date", "certifications", ["expiry_date"])


def downgrade() -> None:
    op.drop_table("certifications")
    op.drop_index("ix_course_assignments_status", table_name="course_assignments")
    op.drop_index("ix_course_assignments_user_id", table_name="course_assignments")
    op.drop_index("ix_course_assignments_course_id", table_name="course_assignments")
    op.drop_table("course_assignments")
    op.drop_index("ix_courses_active", table_name="courses")
    op.drop_index("ix_courses_title", table_name="courses")
    op.drop_table("courses")

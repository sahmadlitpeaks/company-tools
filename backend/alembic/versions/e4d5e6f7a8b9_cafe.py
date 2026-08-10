"""cafe menu and orders

Revision ID: e4d5e6f7a8b9
Revises: e3c4d5e6f7a8
"""
from alembic import op
import sqlalchemy as sa

revision = "e4d5e6f7a8b9"
down_revision = "e3c4d5e6f7a8"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "cafe_menu_items",
        sa.Column("name", sa.String(180), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("price", sa.Numeric(10, 2)),
        sa.Column("available", sa.Boolean(), nullable=False),
        sa.Column("company_id", sa.Uuid()),
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="SET NULL"),
    )
    for column in ("name", "available", "company_id"):
        op.create_index(f"ix_cafe_menu_items_{column}", "cafe_menu_items", [column])
    op.create_table(
        "cafe_orders",
        sa.Column("employee_id", sa.Uuid(), nullable=False),
        sa.Column("menu_item_id", sa.Uuid(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("notes", sa.Text()),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("status_history", sa.JSON(), nullable=False),
        sa.Column("company_id", sa.Uuid()),
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["employee_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["menu_item_id"], ["cafe_menu_items.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="SET NULL"),
    )
    for column in ("employee_id", "menu_item_id", "status", "company_id"):
        op.create_index(f"ix_cafe_orders_{column}", "cafe_orders", [column])


def downgrade():
    op.drop_table("cafe_orders")
    op.drop_table("cafe_menu_items")

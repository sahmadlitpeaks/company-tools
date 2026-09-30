"""Allow inactive owner rules to retain history after an employee is removed.

Revision ID: q3a4b5c6d7e8
Revises: p2f3a4b5c6d7
"""
from alembic import op
import sqlalchemy as sa

revision = "q3a4b5c6d7e8"
down_revision = "p2f3a4b5c6d7"
branch_labels = None
depends_on = None

def upgrade():
    op.drop_constraint("ck_sp_rule_one_owner", "sharepoint_owner_rules", type_="check")
    op.create_check_constraint("ck_sp_rule_one_owner", "sharepoint_owner_rules",
        "(owner_user_id IS NULL OR owner_department_id IS NULL) AND (NOT is_active OR owner_user_id IS NOT NULL OR owner_department_id IS NOT NULL)")

def downgrade():
    invalid = op.get_bind().scalar(sa.text(
        "SELECT count(*) FROM sharepoint_owner_rules "
        "WHERE (owner_user_id IS NOT NULL) = (owner_department_id IS NOT NULL)"))
    if invalid:
        raise RuntimeError("Reassign or remove inactive owner rules without exactly one owner before downgrading.")
    op.drop_constraint("ck_sp_rule_one_owner", "sharepoint_owner_rules", type_="check")
    op.create_check_constraint("ck_sp_rule_one_owner", "sharepoint_owner_rules",
        "(owner_user_id IS NOT NULL) <> (owner_department_id IS NOT NULL)")

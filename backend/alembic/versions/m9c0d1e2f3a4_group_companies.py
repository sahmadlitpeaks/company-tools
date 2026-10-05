"""Register AG Holding group companies and legal-name aliases.

Revision ID: m9c0d1e2f3a4
Revises: l8b9c0d1e2f3
"""

import uuid

from alembic import op
import sqlalchemy as sa


revision = "m9c0d1e2f3a4"
down_revision = "l8b9c0d1e2f3"
branch_labels = None
depends_on = None

PARENT_ID = uuid.UUID("b5a4d000-0000-4000-8000-000000000001")
GROUP_COMPANIES = (
    (uuid.UUID("b5a4d000-0000-4000-8000-000000000002"), "agiomix", "Agiomix", ["Agiomix FZ-LLC"]),
    (uuid.UUID("b5a4d000-0000-4000-8000-000000000003"), "litpeaks", "Litpeaks", []),
    (uuid.UUID("b5a4d000-0000-4000-8000-000000000004"), "precision-health", "Precision Health", []),
)


def upgrade():
    op.add_column("companies", sa.Column("parent_company_id", sa.Uuid(), nullable=True))
    op.add_column("companies", sa.Column("aliases", sa.JSON(), nullable=True))
    op.create_foreign_key("fk_company_parent", "companies", "companies",
                          ["parent_company_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_companies_parent_company_id", "companies", ["parent_company_id"])

    bind = op.get_bind()
    parent = bind.execute(sa.text("""
        SELECT id FROM companies
        WHERE slug = 'ag-holding' OR lower(name) = 'ag holding'
        ORDER BY CASE WHEN slug = 'ag-holding' THEN 0 ELSE 1 END LIMIT 1
    """)).scalar_one_or_none()
    if parent is None:
        # A deleted default company must not make the whole production upgrade fail.
        occupied = bind.execute(
            sa.text("SELECT 1 FROM companies WHERE id = :id")
                .bindparams(sa.bindparam("id", type_=sa.Uuid())),
            {"id": PARENT_ID},
        ).scalar_one_or_none()
        parent = uuid.uuid4() if occupied else PARENT_ID
        bind.execute(sa.text("""
            INSERT INTO companies (id, slug, name, primary_color, accent_color,
                                   base_font_size, is_active, is_default, created_at, updated_at)
            VALUES (:id, 'ag-holding', 'AG Holding', '#0b5cab', '#0b5cab',
                    16, true, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        """).bindparams(sa.bindparam("id", type_=sa.Uuid())), {"id": parent})
    parent_id = uuid.UUID(str(parent))
    insert = sa.text("""
        INSERT INTO companies (id, slug, name, primary_color, accent_color, base_font_size,
                               is_active, is_default, parent_company_id, aliases,
                               created_at, updated_at)
        VALUES (:id, :slug, :name, '#0b5cab', '#0b5cab', 16, true, false,
                :parent_id, :aliases, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    """).bindparams(sa.bindparam("id", type_=sa.Uuid()),
                     sa.bindparam("parent_id", type_=sa.Uuid()),
                     sa.bindparam("aliases", type_=sa.JSON()))
    update = sa.text("""
        UPDATE companies SET parent_company_id = :parent_id, aliases = :aliases,
                             is_active = true
        WHERE id = :id
    """).bindparams(sa.bindparam("id", type_=sa.Uuid()),
                     sa.bindparam("parent_id", type_=sa.Uuid()),
                     sa.bindparam("aliases", type_=sa.JSON()))
    for company_id, slug, name, required_aliases in GROUP_COMPANIES:
        existing = bind.execute(sa.text("""
            SELECT id, aliases FROM companies
            WHERE slug = :slug OR lower(name) = lower(:name)
            ORDER BY CASE WHEN slug = :slug THEN 0 ELSE 1 END LIMIT 1
        """), {"slug": slug, "name": name}).mappings().first()
        if existing:
            company_id = uuid.UUID(str(existing["id"]))
            aliases = list(existing["aliases"] or [])
            for alias in required_aliases:
                if alias.casefold() not in {item.casefold() for item in aliases}:
                    aliases.append(alias)
            bind.execute(update, {"id": company_id, "parent_id": parent_id, "aliases": aliases})
        else:
            bind.execute(insert, {"id": company_id, "slug": slug, "name": name,
                                  "parent_id": parent_id, "aliases": required_aliases})


def downgrade():
    # Keep company records: other modules may already reference them.
    op.drop_index("ix_companies_parent_company_id", table_name="companies")
    op.drop_constraint("fk_company_parent", "companies", type_="foreignkey")
    op.drop_column("companies", "aliases")
    op.drop_column("companies", "parent_company_id")

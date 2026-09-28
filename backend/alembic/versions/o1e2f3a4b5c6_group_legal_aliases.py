"""Link confirmed group legal names to their existing company brands.

Revision ID: o1e2f3a4b5c6
Revises: n0d1e2f3a4b5
"""

from alembic import op
import sqlalchemy as sa


revision = "o1e2f3a4b5c6"
down_revision = "n0d1e2f3a4b5"
branch_labels = None
depends_on = None

LEGAL_ALIASES = {
    "agiomix": "Agiomix Clinical Laboratory LLC",
    "litpeaks": "Litpeaks LLC-FZ",
}


def upgrade():
    bind = op.get_bind()
    update = sa.text("UPDATE companies SET aliases = :aliases WHERE id = :id").bindparams(
        sa.bindparam("aliases", type_=sa.JSON()))
    for slug, alias in LEGAL_ALIASES.items():
        company = bind.execute(sa.text(
            "SELECT id, aliases FROM companies WHERE slug = :slug AND is_active = true"
        ), {"slug": slug}).mappings().first()
        if company is None:
            continue
        aliases = list(company["aliases"] or [])
        if alias.casefold() not in {value.casefold() for value in aliases}:
            aliases.append(alias)
            bind.execute(update, {"id": company["id"], "aliases": aliases})


def downgrade():
    # Keep aliases: they may have already existed or been confirmed by an admin.
    pass

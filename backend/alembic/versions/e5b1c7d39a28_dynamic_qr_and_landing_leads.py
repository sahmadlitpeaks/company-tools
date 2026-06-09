"""dynamic qr and landing leads

Revision ID: e5b1c7d39a28
Revises: d4a6b8c2f015
Create Date: 2026-06-02 14:35:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e5b1c7d39a28'
down_revision: Union[str, None] = 'd4a6b8c2f015'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'qr_codes',
        sa.Column('dynamic', sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.create_table(
        'landing_leads',
        sa.Column('page_id', sa.Uuid(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=True),
        sa.Column('email', sa.String(length=320), nullable=True),
        sa.Column('phone', sa.String(length=64), nullable=True),
        sa.Column('message', sa.Text(), nullable=True),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.ForeignKeyConstraint(['page_id'], ['landing_pages.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_landing_leads_page_id'), 'landing_leads', ['page_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_landing_leads_page_id'), table_name='landing_leads')
    op.drop_table('landing_leads')
    op.drop_column('qr_codes', 'dynamic')

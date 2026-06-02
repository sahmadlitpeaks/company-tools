"""add asset tracker

Revision ID: b7e2f4a9c130
Revises: 1022bd6ce795
Create Date: 2026-06-02 13:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b7e2f4a9c130'
down_revision: Union[str, None] = '1022bd6ce795'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'tracked_assets',
        sa.Column('asset_tag', sa.String(length=64), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('category', sa.String(length=128), nullable=True),
        sa.Column('status', sa.String(length=32), nullable=False),
        sa.Column('location', sa.String(length=255), nullable=True),
        sa.Column('serial_number', sa.String(length=128), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('assigned_to_id', sa.Uuid(), nullable=True),
        sa.Column('purchase_date', sa.Date(), nullable=True),
        sa.Column('purchase_cost', sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column('vendor', sa.String(length=255), nullable=True),
        sa.Column('warranty_expiry', sa.Date(), nullable=True),
        sa.Column('useful_life_years', sa.Integer(), nullable=True),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.ForeignKeyConstraint(['assigned_to_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_tracked_assets_asset_tag'), 'tracked_assets', ['asset_tag'], unique=True)
    op.create_index(op.f('ix_tracked_assets_category'), 'tracked_assets', ['category'], unique=False)
    op.create_index(op.f('ix_tracked_assets_status'), 'tracked_assets', ['status'], unique=False)
    op.create_index(op.f('ix_tracked_assets_assigned_to_id'), 'tracked_assets', ['assigned_to_id'], unique=False)

    op.create_table(
        'asset_events',
        sa.Column('asset_id', sa.Uuid(), nullable=False),
        sa.Column('event_type', sa.String(length=32), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=True),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('cost', sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column('performed_by_id', sa.Uuid(), nullable=True),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.ForeignKeyConstraint(['asset_id'], ['tracked_assets.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['performed_by_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_asset_events_asset_id'), 'asset_events', ['asset_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_asset_events_asset_id'), table_name='asset_events')
    op.drop_table('asset_events')
    op.drop_index(op.f('ix_tracked_assets_assigned_to_id'), table_name='tracked_assets')
    op.drop_index(op.f('ix_tracked_assets_status'), table_name='tracked_assets')
    op.drop_index(op.f('ix_tracked_assets_category'), table_name='tracked_assets')
    op.drop_index(op.f('ix_tracked_assets_asset_tag'), table_name='tracked_assets')
    op.drop_table('tracked_assets')

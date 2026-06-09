"""add activity log

Revision ID: c93f5a1d2e44
Revises: b7e2f4a9c130
Create Date: 2026-06-02 13:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c93f5a1d2e44'
down_revision: Union[str, None] = 'b7e2f4a9c130'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'activity_logs',
        sa.Column('user_id', sa.Uuid(), nullable=True),
        sa.Column('actor_name', sa.String(length=255), nullable=True),
        sa.Column('action', sa.String(length=32), nullable=False),
        sa.Column('entity_type', sa.String(length=48), nullable=False),
        sa.Column('entity_id', sa.String(length=64), nullable=True),
        sa.Column('summary', sa.Text(), nullable=False),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_activity_logs_user_id'), 'activity_logs', ['user_id'], unique=False)
    op.create_index(op.f('ix_activity_logs_action'), 'activity_logs', ['action'], unique=False)
    op.create_index(op.f('ix_activity_logs_entity_type'), 'activity_logs', ['entity_type'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_activity_logs_entity_type'), table_name='activity_logs')
    op.drop_index(op.f('ix_activity_logs_action'), table_name='activity_logs')
    op.drop_index(op.f('ix_activity_logs_user_id'), table_name='activity_logs')
    op.drop_table('activity_logs')

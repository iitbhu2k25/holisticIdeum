"""assivardash tables (previously managed by Django)

Revision ID: 3f1c2a9b7d10
Revises: ebb8a35d397d
Create Date: 2026-10-27 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3f1c2a9b7d10'
down_revision: Union[str, None] = 'ebb8a35d397d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create the tables only when missing; databases migrated by Django already have them."""
    existing = set(sa.inspect(op.get_bind()).get_table_names())

    if 'assivardash_river' not in existing:
        op.create_table('assivardash_river',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('name', sa.String(length=50), nullable=False),
        sa.Column('image', sa.String(length=255), nullable=False),
        sa.Column('description', sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name')
        )

    if 'assivardash_river_location' not in existing:
        op.create_table('assivardash_river_location',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('river_id', sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(['river_id'], ['assivardash_river.id'], ),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_assivardash_river_location_river_id'), 'assivardash_river_location', ['river_id'], unique=False)

    if 'assivardash_river_action' not in existing:
        op.create_table('assivardash_river_action',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('icon', sa.String(length=10), nullable=False),
        sa.Column('color', sa.String(length=20), nullable=False),
        sa.Column('location_id', sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(['location_id'], ['assivardash_river_location.id'], ),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_assivardash_river_action_location_id'), 'assivardash_river_action', ['location_id'], unique=False)

    if 'assivardash_river_intervention' not in existing:
        op.create_table('assivardash_river_intervention',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('action_id', sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(['action_id'], ['assivardash_river_action.id'], ),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_assivardash_river_intervention_action_id'), 'assivardash_river_intervention', ['action_id'], unique=False)

    if 'assivardash_river_workflowphase' not in existing:
        op.create_table('assivardash_river_workflowphase',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('phase', sa.String(length=20), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('commenced', sa.DateTime(timezone=True), nullable=True),
        sa.Column('completed', sa.DateTime(timezone=True), nullable=True),
        sa.Column('deadline', sa.DateTime(timezone=True), nullable=True),
        sa.Column('intervention_id', sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(['intervention_id'], ['assivardash_river_intervention.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('intervention_id', 'phase')
        )
        op.create_index(op.f('ix_assivardash_river_workflowphase_intervention_id'), 'assivardash_river_workflowphase', ['intervention_id'], unique=False)

    if 'assivardash_fund_department' not in existing:
        op.create_table('assivardash_fund_department',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('department_name', sa.String(length=255), nullable=True),
        sa.Column('fund_scheme_name', sa.String(length=255), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('intervention_id', sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(['intervention_id'], ['assivardash_river_intervention.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('intervention_id')
        )


def downgrade() -> None:
    op.drop_table('assivardash_fund_department')
    op.drop_table('assivardash_river_workflowphase')
    op.drop_table('assivardash_river_intervention')
    op.drop_table('assivardash_river_action')
    op.drop_table('assivardash_river_location')
    op.drop_table('assivardash_river')

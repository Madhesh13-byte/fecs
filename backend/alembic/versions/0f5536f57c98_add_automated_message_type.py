"""add_automated_message_type

Revision ID: 0f5536f57c98
Revises: 562fc942c1d8
Create Date: 2026-03-24 06:23:25.668665

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0f5536f57c98'
down_revision = '562fc942c1d8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # PostgreSQL requires ALTER TYPE to add enum values - autogenerate can't detect this
    op.execute("ALTER TYPE messagetype ADD VALUE IF NOT EXISTS 'AUTOMATED'")


def downgrade() -> None:
    # PostgreSQL does not support removing enum values directly.
    # To downgrade, the enum would need to be recreated - skip for safety.
    pass

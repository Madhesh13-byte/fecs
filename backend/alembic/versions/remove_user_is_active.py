"""remove user is_active column

Revision ID: remove_user_is_active
Revises: add_user_fields
Create Date: 2024-01-15 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'remove_user_is_active'
down_revision = 'add_device_registrations'
branch_labels = None
depends_on = None


def upgrade():
    # Remove is_active column from users table
    op.drop_column('users', 'is_active')


def downgrade():
    # Add back is_active column if needed to rollback
    op.add_column('users', sa.Column('is_active', sa.Integer(), nullable=False, server_default='1'))

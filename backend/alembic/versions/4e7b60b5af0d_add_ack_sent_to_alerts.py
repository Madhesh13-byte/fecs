"""add_ack_sent_to_alerts

Revision ID: 4e7b60b5af0d
Revises: 0f5536f57c98
Create Date: 2026-03-24 09:10:15.923173

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '4e7b60b5af0d'
down_revision = '0f5536f57c98'
branch_labels = None
depends_on = None

acktype_enum = sa.Enum('NONE', 'LED', 'BUZZER_LED', name='acktype')


def upgrade() -> None:
    acktype_enum.create(op.get_bind(), checkfirst=True)
    op.add_column('alerts', sa.Column('ack_sent', acktype_enum, nullable=True))


def downgrade() -> None:
    op.drop_column('alerts', 'ack_sent')
    acktype_enum.drop(op.get_bind(), checkfirst=True)

"""invitations

Revision ID: 0002
Revises: 0001
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "invitations",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("roles", pg.ARRAY(sa.String()), nullable=False, server_default="{employee}"),
        sa.Column("invited_by", pg.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("accepted_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_invitations_email", "invitations", ["email"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_invitations_email", table_name="invitations")
    op.drop_table("invitations")

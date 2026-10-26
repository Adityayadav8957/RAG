# ruff: noqa: S608  (PUBLIC is a module constant, not user input)
"""pgvector (replaces Qdrant), self-serve workspaces (tenants), semantic cache table

Revision ID: 0003
Revises: 0002
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

DIM = 768  # must equal Settings.embedding_dim
PUBLIC = (
    "'gmail.com','googlemail.com','outlook.com','hotmail.com','live.com','msn.com','yahoo.com',"
    "'yahoo.co.in','icloud.com','me.com','aol.com','proton.me','protonmail.com','rediffmail.com'"
)


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # --- workspaces: every user, document and invitation belongs to exactly one tenant -------
    op.add_column("users", sa.Column("tenant", sa.String(120), nullable=False, server_default=""))
    op.execute(
        f"""UPDATE users SET tenant = CASE
              WHEN split_part(email, '@', 2) IN ({PUBLIC}) THEN 'p-' || substr(md5(google_sub), 1, 12)
              ELSE split_part(email, '@', 2) END"""
    )
    op.create_index("ix_users_tenant", "users", ["tenant"])

    op.add_column("documents", sa.Column("tenant", sa.String(120), nullable=False, server_default=""))
    op.execute("UPDATE documents d SET tenant = u.tenant FROM users u WHERE u.id = d.owner_id")
    op.create_index("ix_documents_tenant", "documents", ["tenant"])

    op.add_column("invitations", sa.Column("tenant", sa.String(120), nullable=False, server_default=""))
    op.execute("UPDATE invitations i SET tenant = u.tenant FROM users u WHERE u.id = i.invited_by")
    op.create_index("ix_invitations_tenant", "invitations", ["tenant"])

    # --- vectors live next to the rows they describe ----------------------------------------
    op.execute(f"ALTER TABLE chunks ADD COLUMN embedding vector({DIM})")
    op.execute("CREATE INDEX ix_chunks_embedding ON chunks USING hnsw (embedding vector_cosine_ops)")
    # Existing documents were indexed in Qdrant: mark them for re-embedding.
    op.execute("UPDATE documents SET status = 'processing' WHERE status = 'ready'")

    op.create_table(
        "semantic_cache",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("scope", sa.String(120), nullable=False),
        sa.Column("answer", sa.Text, nullable=False),
        sa.Column("citations", pg.JSONB, nullable=False, server_default="[]"),
        sa.Column("source_doc_ids", pg.ARRAY(pg.UUID(as_uuid=True)), nullable=False, server_default="{}"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.execute(f"ALTER TABLE semantic_cache ADD COLUMN embedding vector({DIM}) NOT NULL")
    op.execute(
        "CREATE INDEX ix_semantic_cache_embedding ON semantic_cache USING hnsw (embedding vector_cosine_ops)"
    )
    op.create_index("ix_semantic_cache_scope", "semantic_cache", ["scope", "expires_at"])
    op.execute("CREATE INDEX ix_semantic_cache_docs ON semantic_cache USING gin (source_doc_ids)")


def downgrade() -> None:
    op.drop_table("semantic_cache")
    op.execute("DROP INDEX IF EXISTS ix_chunks_embedding")
    op.execute("ALTER TABLE chunks DROP COLUMN IF EXISTS embedding")
    for table in ("invitations", "documents", "users"):
        op.drop_index(f"ix_{table}_tenant", table_name=table)
        op.drop_column(table, "tenant")

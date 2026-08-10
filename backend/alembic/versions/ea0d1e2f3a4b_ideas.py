"""ideas votes and comments

Revision ID: ea0d1e2f3a4b
Revises: e9c0d1e2f3a4
"""
from alembic import op
import sqlalchemy as sa
revision="ea0d1e2f3a4b";down_revision="e9c0d1e2f3a4";branch_labels=None;depends_on=None
def common():return[sa.Column("id",sa.Uuid(),primary_key=True),sa.Column("created_at",sa.DateTime(timezone=True),server_default=sa.text("now()"),nullable=False),sa.Column("updated_at",sa.DateTime(timezone=True),server_default=sa.text("now()"),nullable=False)]
def upgrade():
 op.create_table("ideas",sa.Column("title",sa.String(255),nullable=False),sa.Column("description",sa.Text(),nullable=False),sa.Column("kind",sa.String(16),nullable=False),sa.Column("status",sa.String(20),nullable=False),sa.Column("author_id",sa.Uuid(),nullable=False),sa.Column("company_id",sa.Uuid()),*common(),sa.ForeignKeyConstraint(["author_id"],["users.id"],ondelete="CASCADE"),sa.ForeignKeyConstraint(["company_id"],["companies.id"],ondelete="SET NULL"))
 for c in("title","kind","status","author_id","company_id"):op.create_index(f"ix_ideas_{c}","ideas",[c])
 op.create_table("idea_votes",sa.Column("idea_id",sa.Uuid(),nullable=False),sa.Column("user_id",sa.Uuid(),nullable=False),*common(),sa.ForeignKeyConstraint(["idea_id"],["ideas.id"],ondelete="CASCADE"),sa.ForeignKeyConstraint(["user_id"],["users.id"],ondelete="CASCADE"),sa.UniqueConstraint("idea_id","user_id",name="uq_idea_vote"))
 op.create_index("ix_idea_votes_idea_id","idea_votes",["idea_id"]);op.create_index("ix_idea_votes_user_id","idea_votes",["user_id"])
 op.create_table("idea_comments",sa.Column("idea_id",sa.Uuid(),nullable=False),sa.Column("author_id",sa.Uuid(),nullable=False),sa.Column("body",sa.Text(),nullable=False),*common(),sa.ForeignKeyConstraint(["idea_id"],["ideas.id"],ondelete="CASCADE"),sa.ForeignKeyConstraint(["author_id"],["users.id"],ondelete="CASCADE"))
 op.create_index("ix_idea_comments_idea_id","idea_comments",["idea_id"]);op.create_index("ix_idea_comments_author_id","idea_comments",["author_id"])
def downgrade():op.drop_table("idea_comments");op.drop_table("idea_votes");op.drop_table("ideas")

"""Freeze completed sprint burndown, including existing closed sprints.

Revision ID: x0b1c2d3e4f5
Revises: w9a0b1c2d3e4

Legacy reports are frozen from the data available at upgrade time. Previously
deleted issues/history cannot be recovered. This migration intentionally keeps
the legacy calculation independent of future application code.
"""
import uuid
from datetime import date, datetime, timedelta, timezone

from alembic import op
import sqlalchemy as sa

revision = "x0b1c2d3e4f5"
down_revision = "w9a0b1c2d3e4"
branch_labels = None
depends_on = None


def _day(value):
    if value is None:
        return None
    if isinstance(value, str):
        value = datetime.fromisoformat(value)
    return (value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value).astimezone(timezone.utc).date()


def upgrade():
    op.add_column("pm_sprints", sa.Column("burndown_snapshot", sa.JSON(), nullable=True))
    db = op.get_bind()
    # Typed lightweight tables support both PostgreSQL and SQLite without ORM
    # imports or driver-dependent JSON serialization.
    sprints = sa.table("pm_sprints", sa.column("id", sa.Uuid()), sa.column("burndown_snapshot", sa.JSON()))
    closed = db.execute(sa.text("SELECT * FROM pm_sprints WHERE status = 'closed'")).mappings()
    for sprint in list(closed):
        start = sprint["start_date"]
        end = sprint["end_date"]
        if isinstance(start, str):
            start = date.fromisoformat(start)
        if isinstance(end, str):
            end = date.fromisoformat(end)
        if not start or not end:
            snapshot = {"sprint": None, "total_points": 0, "days": []}
        else:
            scope = db.execute(sa.text("""
                SELECT DISTINCT i.id, i.story_points, i.status, i.resolved_at
                FROM pm_issues i
                WHERE i.sprint_id = :sprint_id OR (
                    i.project_id = :project_id AND EXISTS (
                        SELECT 1 FROM pm_issue_history h WHERE h.issue_id = i.id
                        AND h.field = 'sprint' AND h.old_value = :name
                        AND h.created_at >= :started
                    )
                )
            """), {"sprint_id": sprint["id"], "project_id": sprint["project_id"],
                   "name": sprint["name"], "started": sprint["started_at"]}).mappings().all()
            total = float(sum(i["story_points"] or 0 for i in scope))
            last = min(date.today(), _day(sprint["completed_at"]) or date.today())
            length = max((end - start).days, 1)
            days = []
            current = start
            while current <= end:
                burned = sum(i["story_points"] or 0 for i in scope if i["status"] == "done"
                             and i["resolved_at"] and _day(i["resolved_at"]) <= current)
                days.append({"date": current.isoformat(),
                             "ideal": round(total * (1 - (current - start).days / length), 2),
                             "remaining": round(total - burned, 2) if current <= last else None})
                current += timedelta(days=1)
            snapshot = {"sprint": {"id": str(sprint["id"]), "name": sprint["name"], "status": "closed",
                                   "start_date": start.isoformat(), "end_date": end.isoformat()},
                        "total_points": total, "days": days}
        # Convert raw SQLite UUID strings before the typed update.
        sprint_id = sprint["id"] if isinstance(sprint["id"], uuid.UUID) else uuid.UUID(sprint["id"])
        db.execute(sprints.update().where(sprints.c.id == sprint_id).values(burndown_snapshot=snapshot))


def downgrade():
    op.drop_column("pm_sprints", "burndown_snapshot")

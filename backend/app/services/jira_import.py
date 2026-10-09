"""Import issues from a Jira CSV export ("Export > CSV (all fields)").

Parsing is separate from importing so the UI can preview what was found and
let a project administrator map Jira statuses and people before anything is
written. Jira repeats column names (Labels, Comment, Sprint, link columns), so
rows are read positionally rather than as dictionaries.
"""
import csv
import io
import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.pm import (
    ISSUE_STATUSES,
    SPRINTABLE_TYPES,
    PmComment,
    PmIssue,
    PmIssueLink,
    PmIssueWatcher,
    PmProject,
    PmProjectMember,
    PmSprint,
)
from app.models.user import User

MAX_BYTES = 10 * 1024 * 1024
# This is process-wide: set once rather than changing/restoring per request.
# The bounded upload size is also the maximum possible decoded field size.
csv.field_size_limit(MAX_BYTES)
MAX_ISSUES = 5000
KEY_RE = re.compile(r"^[A-Z][A-Z0-9_]*-\d+$")
LINK_HEADER = re.compile(r"^(outward|inward) issue link \((.+)\)$")
DATE_FORMATS = (
    "%d/%b/%y %I:%M %p", "%d/%b/%Y %I:%M %p", "%d/%b/%y %H:%M", "%d/%b/%y",
    "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M:%S.%f%z", "%Y-%m-%dT%H:%M:%S%z",
    "%Y-%m-%d", "%d/%m/%Y %H:%M", "%d/%m/%Y",
)
TYPE_MAP = {"epic": "epic", "story": "story", "task": "task", "bug": "bug", "sub-task": "subtask", "subtask": "subtask"}
PRIORITY_MAP = {
    "highest": "highest", "blocker": "highest", "critical": "highest",
    "high": "high", "major": "high",
    "medium": "medium", "normal": "medium",
    "low": "low", "minor": "low",
    "lowest": "lowest", "trivial": "lowest",
}


class JiraImportError(ValueError):
    """The file can't be imported; the message is safe to show."""


@dataclass
class JiraComment:
    when: datetime | None
    author: str
    body: str


@dataclass
class JiraIssue:
    key: str
    jira_id: str
    type_name: str
    summary: str
    description: str = ""
    status: str = ""
    priority: str = ""
    assignee: str = ""
    reporter: str = ""
    created: datetime | None = None
    resolved: datetime | None = None
    due: datetime | None = None
    points: float | None = None
    labels: list[str] = field(default_factory=list)
    parent: str = ""  # Jira issue id or key of the parent (sub-tasks, next-gen epics)
    epic_link: str = ""  # Epic key (company-managed projects)
    sprints: list[str] = field(default_factory=list)
    comments: list[JiraComment] = field(default_factory=list)
    blocks: list[str] = field(default_factory=list)  # keys this issue blocks
    blocked_by: list[str] = field(default_factory=list)
    relates: list[str] = field(default_factory=list)
    attachments: int = 0

    @property
    def issue_type(self) -> str:
        return TYPE_MAP.get(self.type_name.strip().lower(), "task")


def parse_date(value: str) -> datetime | None:
    value = (value or "").strip()
    if not value:
        return None
    for fmt in DATE_FORMATS:
        try:
            parsed = datetime.strptime(value, fmt)
        except ValueError:
            continue
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    return None


def parse_export(raw: bytes) -> list[JiraIssue]:
    if len(raw) > MAX_BYTES:
        raise JiraImportError("The file is larger than 10 MB. Export fewer issues at a time.")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")
    try:
        rows = list(csv.reader(io.StringIO(text), strict=True))
    except csv.Error as exc:
        raise JiraImportError("The CSV is malformed. Export it again as CSV (all fields).") from exc
    if not rows:
        raise JiraImportError("The file is empty.")
    headers = [h.strip().lower() for h in rows[0]]

    def where(test) -> list[int]:
        return [i for i, h in enumerate(headers) if test(h)]

    def named(*names) -> list[int]:
        return where(lambda h: h in names)

    required = {"summary": named("summary"), "issue key": named("issue key"), "issue type": named("issue type")}
    missing = [name for name, cols in required.items() if not cols]
    if missing:
        raise JiraImportError(
            "This doesn't look like a Jira CSV export (missing "
            + ", ".join(missing) + "). In Jira use Filters > Export > CSV (all fields)."
        )
    cols = {
        "key": required["issue key"], "summary": required["summary"], "type": required["issue type"],
        "id": named("issue id"), "description": named("description"), "status": named("status"),
        "priority": named("priority"), "assignee": named("assignee"), "reporter": named("reporter"),
        "created": named("created"), "resolved": named("resolved"), "due": named("due date", "due"),
        "labels": named("labels"), "sprint": named("sprint"), "comment": named("comment"),
        "attachment": named("attachment"),
        "parent": named("parent", "parent id", "parent key"),
        "epic": where(lambda h: "epic link" in h),
        "points": where(lambda h: "story point" in h),
    }
    links: dict[tuple[str, str], list[int]] = {}
    for i, h in enumerate(headers):
        match = LINK_HEADER.match(h)
        if match:
            links.setdefault((match.group(1), match.group(2)), []).append(i)

    issues: list[JiraIssue] = []
    for row in rows[1:]:
        if not any(cell.strip() for cell in row):
            continue

        def all_(name: str) -> list[str]:
            return [row[i].strip() for i in cols[name] if i < len(row) and row[i].strip()]

        def one(name: str) -> str:
            values = all_(name)
            return values[0] if values else ""

        key = one("key").upper()
        if not KEY_RE.match(key):
            continue
        points = None
        raw_points = one("points")
        if raw_points:
            try:
                points = max(0.0, min(1000.0, float(raw_points)))
            except ValueError:
                points = None
        issue = JiraIssue(
            key=key, jira_id=one("id"), type_name=one("type") or "Task", summary=one("summary")[:255] or key,
            description=one("description"), status=one("status"), priority=one("priority"),
            assignee=one("assignee"), reporter=one("reporter"),
            created=parse_date(one("created")), resolved=parse_date(one("resolved")), due=parse_date(one("due")),
            points=points, labels=all_("labels"), parent=one("parent"), epic_link=one("epic").upper(),
            sprints=all_("sprint"), attachments=len(all_("attachment")),
        )
        for value in all_("comment"):
            # Jira writes comments as "date;author;body".
            parts = value.split(";", 2)
            if len(parts) == 3:
                issue.comments.append(JiraComment(parse_date(parts[0]), parts[1].strip(), parts[2].strip()))
            else:
                issue.comments.append(JiraComment(None, "", value))
        for (direction, name), indexes in links.items():
            keys = [row[i].strip().upper() for i in indexes if i < len(row) and KEY_RE.match(row[i].strip().upper())]
            if name.startswith("block"):
                (issue.blocks if direction == "outward" else issue.blocked_by).extend(keys)
            elif name.startswith("relat"):
                issue.relates.extend(keys)
        issues.append(issue)
    if not issues:
        raise JiraImportError("No issues were found in the file.")
    if len(issues) > MAX_ISSUES:
        raise JiraImportError(f"The file has {len(issues)} issues; import at most {MAX_ISSUES} at a time.")
    return issues


def suggest_status(name: str) -> str:
    lowered = name.strip().lower()
    if lowered in ("done", "closed", "resolved", "complete", "completed", "released", "won't do", "cancelled"):
        return "done"
    if any(word in lowered for word in ("review", "qa", "test", "verif", "approval")):
        return "in_review"
    if any(word in lowered for word in ("progress", "doing", "develop", "implement", "working")):
        return "in_progress"
    return "todo"


async def _people(db: AsyncSession) -> list[User]:
    return list(
        (await db.scalars(select(User).where(User.is_active.is_(True), User.status == "active"))).all()
    )


def suggest_user(name: str, people: list[User]) -> User | None:
    wanted = name.strip().lower()
    if not wanted:
        return None
    for person in people:
        email = (person.email or "").lower()
        if wanted in ((person.display_name or "").lower(), email, email.split("@")[0]):
            return person
    return None


async def preview(db: AsyncSession, project: PmProject, issues: list[JiraIssue]) -> dict:
    existing = set(
        (await db.scalars(select(PmIssue.external_key).where(
            PmIssue.project_id == project.id, PmIssue.external_key.is_not(None)
        ))).all()
    )
    people = await _people(db)
    types: dict[str, dict] = {}
    statuses: dict[str, int] = {}
    names: dict[str, int] = {}
    for issue in issues:
        entry = types.setdefault(issue.type_name, {"name": issue.type_name, "count": 0, "imported_as": issue.issue_type})
        entry["count"] += 1
        if issue.status:
            statuses[issue.status] = statuses.get(issue.status, 0) + 1
        for person in [issue.assignee, issue.reporter, *(c.author for c in issue.comments)]:
            if person:
                names[person] = names.get(person, 0) + 1
    warnings = []
    other_types = [t["name"] for t in types.values() if t["name"].strip().lower() not in TYPE_MAP]
    if other_types:
        warnings.append(f"{', '.join(sorted(other_types))} will be imported as tasks.")
    attachments = sum(i.attachments for i in issues)
    if attachments:
        warnings.append(
            f"{attachments} attachment(s) are not part of a CSV export and won't be imported; "
            "the Jira key on each issue lets you find them."
        )
    if any(i.sprints for i in issues) and not project.sprints_enabled:
        warnings.append("This project doesn't use sprints, so Jira sprints will be ignored.")
    sprint_names = sorted({i.sprints[-1] for i in issues if i.sprints and i.issue_type in SPRINTABLE_TYPES and suggest_status(i.status) != "done"})
    suggestions = {name: suggest_user(name, people) for name in names}
    return {
        "total": len(issues),
        "already_imported": sum(1 for i in issues if i.key in existing),
        "types": sorted(types.values(), key=lambda t: -t["count"]),
        "statuses": [
            {"name": name, "count": count, "suggested": suggest_status(name)}
            for name, count in sorted(statuses.items(), key=lambda item: -item[1])
        ],
        "people": [
            {
                "name": name, "count": count,
                "suggested_user_id": str(suggestions[name].id) if suggestions[name] else None,
                "suggested_name": (suggestions[name].display_name or suggestions[name].email) if suggestions[name] else None,
            }
            for name, count in sorted(names.items(), key=lambda item: (-item[1], item[0].lower()))
        ],
        "sprints": sprint_names if project.sprints_enabled else [],
        "comments": sum(len(i.comments) for i in issues),
        "links": sum(len(i.blocks) + len(i.blocked_by) + len(i.relates) for i in issues),
        "attachments": attachments,
        "warnings": warnings,
        "sample": [
            {"key": i.key, "type": i.issue_type, "summary": i.summary, "status": i.status}
            for i in issues[:5]
        ],
    }


async def run_import(
    db: AsyncSession,
    project: PmProject,
    actor: User,
    issues: list[JiraIssue],
    status_map: dict[str, str],
    user_map: dict[str, uuid.UUID | None],
    add_members: bool,
) -> dict:
    """Create the issues; the caller commits. ``project`` must be row-locked."""
    from app.api.pm import _clean_labels  # shared label rules
    from app.services.pm_workspace import configuration

    members = dict(
        (await db.execute(
            select(PmProjectMember.user_id, PmProjectMember.role).where(PmProjectMember.project_id == project.id)
        )).all()
    )
    valid_users = {p.id for p in await _people(db)}
    for name, user_id in user_map.items():
        if user_id and user_id not in valid_users:
            raise JiraImportError(f"Choose an active person for {name}.")
    members_added = 0

    def ensure_member(user_id: uuid.UUID | None, role: str) -> bool:
        nonlocal members_added
        if not user_id:
            return False
        if user_id in members:
            return True
        if not add_members:
            return False
        db.add(PmProjectMember(project_id=project.id, user_id=user_id, role=role))
        members[user_id] = role
        members_added += 1
        return True

    existing = {
        row.external_key: row
        for row in (await db.scalars(select(PmIssue).where(
            PmIssue.project_id == project.id, PmIssue.external_key.is_not(None)
        ))).all()
    }
    by_key: dict[str, PmIssue] = dict(existing)
    id_to_key = {i.jira_id: i.key for i in issues if i.jira_id}
    fresh = [i for i in issues if i.key not in existing]
    order = {"epic": 0, "story": 1, "task": 1, "bug": 1, "subtask": 2}
    fresh.sort(key=lambda i: order[i.issue_type])
    if fresh and any(field.required for field in configuration(project).fields):
        raise JiraImportError("Jira CSV does not map custom fields. Make required custom fields optional before importing, then fill them in.")

    sprints: dict[str, PmSprint] = {}
    if project.sprints_enabled:
        for sprint in (await db.scalars(select(PmSprint).where(
            PmSprint.project_id == project.id, PmSprint.status != "closed"
        ))).all():
            sprints.setdefault(sprint.name, sprint)
    sprints_created = 0
    warnings: list[str] = []
    converted = 0
    unassigned_viewers = 0
    rank = float(await db.scalar(
        select(func.coalesce(func.max(PmIssue.rank), 0)).where(PmIssue.project_id == project.id)
    ) or 0)
    position = {i.key: n for n, i in enumerate(issues)}
    now = datetime.now(timezone.utc)

    def parent_key(issue: JiraIssue) -> str:
        ref = issue.parent.upper()
        return ref if KEY_RE.match(ref) else id_to_key.get(issue.parent, "")

    created: list[tuple[JiraIssue, PmIssue]] = []
    for item in fresh:
        issue_type = item.issue_type
        parent = None
        if issue_type == "subtask":
            parent = by_key.get(parent_key(item))
            if not parent or parent.issue_type not in SPRINTABLE_TYPES:
                issue_type, parent, converted = "task", None, converted + 1
        if issue_type in SPRINTABLE_TYPES:
            candidate = by_key.get(item.epic_link) or by_key.get(parent_key(item))
            parent = candidate if candidate and candidate.issue_type == "epic" else None

        status = status_map.get(item.status) or suggest_status(item.status)
        if status not in ISSUE_STATUSES:
            raise JiraImportError(f"Choose a valid status for {item.status}.")
        assignee = user_map.get(item.assignee) if item.assignee else None
        if assignee and not ensure_member(assignee, "member"):
            assignee = None
        elif assignee and members.get(assignee) == "viewer":
            assignee, unassigned_viewers = None, unassigned_viewers + 1
        reporter = user_map.get(item.reporter) if item.reporter else None
        if reporter and not ensure_member(reporter, "viewer"):
            reporter = None

        notes = [f"Imported from Jira {item.key}."]
        if item.reporter and not reporter:
            notes.append(f"Reported in Jira by {item.reporter}.")
        if item.assignee and not assignee:
            notes.append(f"Assigned in Jira to {item.assignee}.")
        description = "\n\n".join(filter(None, [item.description.strip(), " ".join(notes)]))

        sprint_id = None
        if project.sprints_enabled and item.sprints and issue_type in SPRINTABLE_TYPES and status != "done":
            name = item.sprints[-1][:120]
            if name not in sprints:
                sprints[name] = PmSprint(project_id=project.id, name=name, status="future")
                db.add(sprints[name])
                await db.flush()
                sprints_created += 1
            sprint_id = sprints[name].id

        project.issue_seq = (project.issue_seq or 0) + 1
        created_at = item.created or now
        row = PmIssue(
            project_id=project.id, number=project.issue_seq, issue_type=issue_type,
            summary=item.summary, description=description, status=status, workflow_state=status,
            priority=PRIORITY_MAP.get(item.priority.strip().lower(), "medium"),
            story_points=item.points, labels=_clean_labels(item.labels)[:20],
            reporter_id=reporter or actor.id, assignee_id=assignee, parent_id=parent.id if parent else None,
            sprint_id=sprint_id, due_date=item.due.date() if item.due else None,
            resolved_at=(item.resolved or item.created or now) if status == "done" else None,
            rank=rank + 1 + position[item.key], created_by_id=actor.id, external_key=item.key,
            created_at=created_at, updated_at=created_at,
        )
        db.add(row)
        await db.flush()
        by_key[item.key] = row
        created.append((item, row))
        for watcher in {reporter, assignee} - {None}:
            db.add(PmIssueWatcher(issue_id=row.id, user_id=watcher))

    comments = 0
    for item, row in created:
        for comment in item.comments:
            if not comment.body:
                continue
            author = user_map.get(comment.author) if comment.author else None
            body = comment.body if author else f"{comment.author or 'Someone'} (in Jira): {comment.body}"
            when = comment.when or row.created_at
            db.add(PmComment(issue_id=row.id, author_id=author, body=body[:20000], created_at=when, updated_at=when))
            comments += 1

    seen: set[tuple] = set()
    if existing:
        imported_ids = [r.id for r in existing.values()]
        for link in (await db.scalars(select(PmIssueLink).where(PmIssueLink.source_id.in_(imported_ids)))).all():
            seen.add((link.source_id, link.target_id, link.link_type))
    links = 0
    for item, row in created:
        pairs = [(row, by_key.get(k), "blocks") for k in item.blocks]
        pairs += [(by_key.get(k), row, "blocks") for k in item.blocked_by]
        pairs += [(row, by_key.get(k), "relates") for k in item.relates]
        for source, target, kind in pairs:
            if not source or not target or source.id == target.id:
                continue
            ident = (source.id, target.id, kind) if kind == "blocks" else (*sorted((source.id, target.id), key=str), kind)
            if ident in seen or (kind == "relates" and (target.id, source.id, kind) in seen):
                continue
            seen.add(ident)
            db.add(PmIssueLink(source_id=source.id, target_id=target.id, link_type=kind))
            links += 1

    if converted:
        warnings.append(f"{converted} sub-task(s) without an importable parent were imported as tasks.")
    if unassigned_viewers:
        warnings.append(f"{unassigned_viewers} issue(s) were left unassigned because their Jira assignee is a viewer here.")
    return {
        "created": len(created),
        "skipped": len(issues) - len(fresh),
        "comments": comments,
        "links": links,
        "sprints_created": sprints_created,
        "members_added": members_added,
        "warnings": warnings,
        "first_key": f"{project.key}-{created[0][1].number}" if created else None,
    }

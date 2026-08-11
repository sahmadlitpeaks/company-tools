"""Recurring checklists — template authoring, daily runs, verification.

Two routers:
  * ``/api/checklist-templates`` — admin/manager authoring of a round.
  * ``/api/checklist-runs``      — the day's work: respond, submit, verify.

A run is a :class:`~app.models.workplace.Task` with ``template_id`` set, so it
reuses tasks' comments, attachments and activity log rather than duplicating
them.
"""
import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.checklist import (
    RESPONSE_TYPES,
    SCHEDULES,
    ChecklistTemplate,
    ChecklistTemplateItem,
)
from app.models.tracked_asset import TrackedAsset
from app.models.user import User
from app.models.workplace import Attachment, Task, TaskItem, Ticket
from app.schemas.checklist import (
    ChecklistTemplateCreate,
    ChecklistTemplateOut,
    ChecklistTemplateUpdate,
    ComplianceSummary,
    GenerateRequest,
    GenerateResult,
    IssueHotspot,
    RunDetail,
    RunItemOut,
    RunItemUpdate,
    RunOut,
    RunVerify,
    TemplateCompliance,
    TemplateItemOut,
)
from app.services.activity import record
from app.services.checklist_runs import (
    TICKET_CATEGORIES,
    deadline_for,
    generate_due_runs,
    generate_for_template,
    next_run_date,
    raise_ticket_for_item,
    run_is_late,
)
from app.services.checklist_report_pdf import render_run_report
from app.services.checklist_seed import starter_templates
from app.services.notify import notify_user
from app.services.people import user_names

router = APIRouter(prefix="/checklist-templates", tags=["checklists"])
runs_router = APIRouter(prefix="/checklist-runs", tags=["checklists"])

ITEM_STATUSES = {"pending", "ok", "issue", "na", "done"}
PRIORITIES = {"low", "normal", "high", "urgent"}
# A run counts as answered once nothing is left pending.
OPEN_RUN_STATUSES = ("todo", "in_progress")


def _is_manager(user: User) -> bool:
    return user.is_admin or user.role == "manager"


def _require_manager(user: User) -> None:
    if not _is_manager(user):
        raise HTTPException(status_code=403, detail="Managers and admins only")


# --------------------------------------------------------------------------
# Templates
# --------------------------------------------------------------------------
def _validate_template(data: dict) -> None:
    if "schedule" in data and data["schedule"] not in SCHEDULES:
        raise HTTPException(status_code=422, detail="Invalid schedule")
    if data.get("team") and data["team"] not in TICKET_CATEGORIES:
        raise HTTPException(status_code=422, detail="Invalid team")
    if data.get("schedule") == "weekly" and not data.get("days_of_week"):
        raise HTTPException(
            status_code=422, detail="Weekly schedules need at least one weekday"
        )
    for day in data.get("days_of_week") or []:
        if day < 1 or day > 7:
            raise HTTPException(
                status_code=422, detail="days_of_week uses 1 (Mon) … 7 (Sun)"
            )
    if data.get("day_of_month") is not None and not 1 <= data["day_of_month"] <= 31:
        raise HTTPException(status_code=422, detail="day_of_month must be 1–31")


def _validate_items(items) -> None:
    for it in items or []:
        if it.response_type not in RESPONSE_TYPES:
            raise HTTPException(
                status_code=422, detail=f"Invalid response type '{it.response_type}'"
            )
        if it.ticket_priority not in PRIORITIES:
            raise HTTPException(status_code=422, detail="Invalid ticket priority")


async def _load_template(db: AsyncSession, template_id: uuid.UUID) -> ChecklistTemplate:
    tpl = (
        await db.execute(
            select(ChecklistTemplate)
            .options(selectinload(ChecklistTemplate.items))
            .where(ChecklistTemplate.id == template_id)
            # Without populate_existing a reload after replacing the item list
            # hands back the stale collection from the identity map.
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    return tpl


async def _serialize_template(
    db: AsyncSession, tpl: ChecklistTemplate, *, with_items: bool = True
) -> ChecklistTemplateOut:
    names = await user_names(db, {tpl.assignee_id, tpl.reviewer_id})
    out = ChecklistTemplateOut.model_validate(tpl)
    out.assignee_name = names.get(tpl.assignee_id) if tpl.assignee_id else None
    out.reviewer_name = names.get(tpl.reviewer_id) if tpl.reviewer_id else None
    if tpl.assignee_department_id:
        from app.models.department import Department

        dept = await db.get(Department, tpl.assignee_department_id)
        out.assignee_department_name = dept.name if dept else None
    out.item_count = len(tpl.items)
    out.next_run_date = next_run_date(tpl) if tpl.active else None
    out.items = (
        [TemplateItemOut.model_validate(i) for i in sorted(tpl.items, key=lambda x: x.sort)]
        if with_items
        else []
    )
    return out


@router.get("", response_model=list[ChecklistTemplateOut])
async def list_templates(
    team: str | None = None,
    active: bool | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    stmt = (
        select(ChecklistTemplate)
        .options(selectinload(ChecklistTemplate.items))
        .order_by(ChecklistTemplate.name)
    )
    if team:
        stmt = stmt.where(ChecklistTemplate.team == team)
    if active is not None:
        stmt = stmt.where(ChecklistTemplate.active.is_(active))
    rows = (await db.execute(stmt)).scalars().all()
    return [await _serialize_template(db, t, with_items=False) for t in rows]


@router.post("", response_model=ChecklistTemplateOut, status_code=201)
async def create_template(
    payload: ChecklistTemplateCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_manager(user)
    data = payload.model_dump(exclude={"items"})
    _validate_template(data)
    _validate_items(payload.items)
    tpl = ChecklistTemplate(**data, created_by_id=user.id)
    db.add(tpl)
    await db.flush()
    for i, it in enumerate(payload.items):
        db.add(
            ChecklistTemplateItem(
                template_id=tpl.id, **{**it.model_dump(), "sort": it.sort or i}
            )
        )
    record(
        db,
        user=user,
        action="created",
        entity_type="checklist_template",
        entity_id=tpl.id,
        summary=f"{user.display_name or user.email} created checklist '{tpl.name}'",
    )
    await db.commit()
    return await _serialize_template(db, await _load_template(db, tpl.id))


@router.post("/samples", response_model=list[ChecklistTemplateOut], status_code=201)
async def seed_sample_templates(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Create the starter rounds (IT, Facilities, Lab) if they don't exist yet.

    Gives a new deployment something real to run against — and shows the same
    machinery serving three departments with different schedules, response types
    and photo rules.
    """
    _require_manager(user)
    existing = set(
        (await db.execute(select(ChecklistTemplate.name))).scalars().all()
    )
    created: list[uuid.UUID] = []
    for spec in starter_templates():
        if spec["name"] in existing:
            continue
        items = spec.pop("items")
        tpl = ChecklistTemplate(**spec, created_by_id=user.id)
        db.add(tpl)
        await db.flush()
        for i, it in enumerate(items):
            db.add(
                ChecklistTemplateItem(template_id=tpl.id, **{**it, "sort": it.get("sort", i)})
            )
        created.append(tpl.id)
    if created:
        record(
            db,
            user=user,
            action="created",
            entity_type="checklist_template",
            summary=f"{user.display_name or user.email} seeded "
            f"{len(created)} starter checklist(s)",
        )
    await db.commit()
    return [
        await _serialize_template(db, await _load_template(db, tid), with_items=False)
        for tid in created
    ]


@router.get("/{template_id}", response_model=ChecklistTemplateOut)
async def get_template(
    template_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return await _serialize_template(db, await _load_template(db, template_id))


@router.patch("/{template_id}", response_model=ChecklistTemplateOut)
async def update_template(
    template_id: uuid.UUID,
    payload: ChecklistTemplateUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_manager(user)
    tpl = await _load_template(db, template_id)
    data = payload.model_dump(exclude_unset=True, exclude={"items"})
    merged = {**{"schedule": tpl.schedule, "team": tpl.team}, **data}
    _validate_template(merged)
    for field, value in data.items():
        setattr(tpl, field, value)

    if payload.items is not None:
        _validate_items(payload.items)
        # Replacing the item list only affects runs generated from now on;
        # runs already in flight keep the items they were created with.
        for old in list(tpl.items):
            await db.delete(old)
        await db.flush()
        for i, it in enumerate(payload.items):
            db.add(
                ChecklistTemplateItem(
                    template_id=tpl.id, **{**it.model_dump(), "sort": it.sort or i}
                )
            )
    record(
        db,
        user=user,
        action="updated",
        entity_type="checklist_template",
        entity_id=tpl.id,
        summary=f"{user.display_name or user.email} updated checklist '{tpl.name}'",
    )
    await db.commit()
    return await _serialize_template(db, await _load_template(db, template_id))


@router.delete("/{template_id}", status_code=204)
async def delete_template(
    template_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_manager(user)
    tpl = await db.get(ChecklistTemplate, template_id)
    if tpl:
        await db.delete(tpl)
        await db.commit()


@router.post("/{template_id}/generate", response_model=GenerateResult)
async def generate_one(
    template_id: uuid.UUID,
    payload: GenerateRequest | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Materialise this template's run for a date (default today).

    Idempotent — re-running returns ``created: 0`` rather than a duplicate.
    """
    _require_manager(user)
    tpl = await _load_template(db, template_id)
    day = (payload.on if payload else None) or date.today()
    run = await generate_for_template(db, tpl, day)
    return GenerateResult(created=1 if run else 0, run_ids=[run.id] if run else [])


@router.post("/generate-due", response_model=GenerateResult)
async def generate_all_due(
    payload: GenerateRequest | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Run the generation job on demand (the scheduler does this hourly)."""
    _require_manager(user)
    runs = await generate_due_runs(db, on=(payload.on if payload else None))
    return GenerateResult(created=len(runs), run_ids=[r.id for r in runs])


# --------------------------------------------------------------------------
# Runs
# --------------------------------------------------------------------------
async def _photo_counts(
    db: AsyncSession, item_ids: set[uuid.UUID]
) -> dict[uuid.UUID, int]:
    if not item_ids:
        return {}
    rows = (
        await db.execute(
            select(Attachment.entity_id, func.count())
            .where(
                Attachment.entity_type == "task_item",
                Attachment.entity_id.in_(item_ids),
            )
            .group_by(Attachment.entity_id)
        )
    ).all()
    return {r[0]: int(r[1]) for r in rows}


async def _load_run(db: AsyncSession, run_id: uuid.UUID) -> Task:
    task = await db.get(Task, run_id, options=[selectinload(Task.items)])
    if not task or not task.template_id:
        raise HTTPException(status_code=404, detail="Run not found")
    return task


async def _can_view(db: AsyncSession, user: User, run: Task) -> bool:
    if _is_manager(user):
        return True
    if user.id in (run.assignee_id, run.reviewer_id):
        return True
    # Rota runs stay visible to the whole owning department — including after a
    # colleague claims one, so the team can see the day's state.
    if run.template_id and user.department_id:
        tpl = await db.get(ChecklistTemplate, run.template_id)
        if tpl and tpl.assignee_department_id == user.department_id:
            return True
    return False


async def _require_view(db: AsyncSession, user: User, run: Task) -> None:
    if not await _can_view(db, user, run):
        raise HTTPException(status_code=403, detail="You don't have access to this run")


async def _serialize_runs(
    db: AsyncSession, runs: list[Task]
) -> list[RunOut]:
    if not runs:
        return []
    tpl_ids = {r.template_id for r in runs if r.template_id}
    templates = {
        t.id: t
        for t in (
            (
                await db.execute(
                    select(ChecklistTemplate).where(ChecklistTemplate.id.in_(tpl_ids))
                )
            )
            .scalars()
            .all()
        )
    }
    names = await user_names(
        db,
        {r.assignee_id for r in runs}
        | {r.reviewer_id for r in runs}
        | {r.verified_by_id for r in runs},
    )
    stats = await _item_stats(db, {r.id for r in runs})

    out: list[RunOut] = []
    for run in runs:
        tpl = templates.get(run.template_id)
        row = RunOut.model_validate(run)
        row.template_name = tpl.name if tpl else None
        row.team = tpl.team if tpl else None
        row.assignee_name = names.get(run.assignee_id) if run.assignee_id else None
        row.reviewer_name = names.get(run.reviewer_id) if run.reviewer_id else None
        row.verified_by_name = (
            names.get(run.verified_by_id) if run.verified_by_id else None
        )
        total, answered, issues = stats.get(run.id, (0, 0, 0))
        row.items_total = total
        row.items_answered = answered
        row.issues = issues
        row.is_late = (
            run_is_late(run, deadline_for(tpl, run.run_date))
            if tpl and run.run_date
            else False
        )
        out.append(row)
    return out


async def _item_stats(
    db: AsyncSession, run_ids: set[uuid.UUID]
) -> dict[uuid.UUID, tuple[int, int, int]]:
    """run_id -> (total, answered, issues)."""
    if not run_ids:
        return {}
    rows = (
        await db.execute(
            select(TaskItem.task_id, TaskItem.status, func.count())
            .where(TaskItem.task_id.in_(run_ids))
            .group_by(TaskItem.task_id, TaskItem.status)
        )
    ).all()
    acc: dict[uuid.UUID, list[int]] = {}
    for task_id, status, count in rows:
        bucket = acc.setdefault(task_id, [0, 0, 0])
        bucket[0] += int(count)
        if status != "pending":
            bucket[1] += int(count)
        if status == "issue":
            bucket[2] += int(count)
    return {k: (v[0], v[1], v[2]) for k, v in acc.items()}


@runs_router.get("/summary", response_model=ComplianceSummary)
async def compliance_summary(
    from_date: date | None = Query(None, alias="from"),
    to_date: date | None = Query(None, alias="to"),
    team: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Manager view: completion, lateness and repeat-offender checkpoints."""
    _require_manager(user)
    end = to_date or date.today()
    start = from_date or (end - timedelta(days=29))

    templates = {
        t.id: t
        for t in (
            (
                await db.execute(
                    select(ChecklistTemplate).where(
                        ChecklistTemplate.team == team
                    )
                    if team
                    else select(ChecklistTemplate)
                )
            )
            .scalars()
            .all()
        )
    }
    runs = (
        (
            await db.execute(
                select(Task).where(
                    Task.template_id.in_(templates.keys() or [uuid.uuid4()]),
                    Task.run_date >= start,
                    Task.run_date <= end,
                )
            )
        )
        .scalars()
        .all()
    )
    stats = await _item_stats(db, {r.id for r in runs})

    per_template: dict[uuid.UUID, TemplateCompliance] = {
        tid: TemplateCompliance(
            template_id=tid, template_name=tpl.name, team=tpl.team
        )
        for tid, tpl in templates.items()
    }
    total_verified = total_late = total_issues = 0
    for run in runs:
        row = per_template.get(run.template_id)
        if not row:
            continue
        tpl = templates[run.template_id]
        row.runs += 1
        if run.status == "done":
            row.verified += 1
            total_verified += 1
        elif run.status == "submitted":
            row.submitted += 1
        else:
            row.open += 1
        if run.run_date and run_is_late(run, deadline_for(tpl, run.run_date)):
            row.late += 1
            total_late += 1
        issues = stats.get(run.id, (0, 0, 0))[2]
        row.issues += issues
        total_issues += issues
    for row in per_template.values():
        row.completion_rate = round(row.verified / row.runs * 100, 1) if row.runs else 0.0

    # Repeat offenders: checkpoints that failed most often in the window.
    hotspot_rows = (
        await db.execute(
            select(
                TaskItem.title,
                TaskItem.section,
                TaskItem.asset_id,
                func.count(),
                func.max(Task.run_date),
            )
            .join(Task, Task.id == TaskItem.task_id)
            .where(
                TaskItem.status == "issue",
                Task.run_date >= start,
                Task.run_date <= end,
                Task.template_id.in_(templates.keys() or [uuid.uuid4()]),
            )
            .group_by(TaskItem.title, TaskItem.section, TaskItem.asset_id)
            .order_by(func.count().desc())
            .limit(15)
        )
    ).all()
    asset_ids = {r[2] for r in hotspot_rows if r[2]}
    asset_names = {}
    if asset_ids:
        asset_names = {
            a.id: a.name
            for a in (
                (
                    await db.execute(
                        select(TrackedAsset).where(TrackedAsset.id.in_(asset_ids))
                    )
                )
                .scalars()
                .all()
            )
        }
    hotspots = [
        IssueHotspot(
            title=r[0],
            section=r[1],
            asset_id=r[2],
            asset_name=asset_names.get(r[2]) if r[2] else None,
            issue_count=int(r[3]),
            last_seen=r[4],
        )
        for r in hotspot_rows
    ]

    runs_count = len(runs)
    return ComplianceSummary(
        from_date=start,
        to_date=end,
        runs=runs_count,
        verified=total_verified,
        late=total_late,
        issues=total_issues,
        completion_rate=(
            round(total_verified / runs_count * 100, 1) if runs_count else 0.0
        ),
        by_template=[r for r in per_template.values() if r.runs],
        hotspots=hotspots,
    )


@runs_router.patch("/items/{item_id}", response_model=RunItemOut)
async def respond_to_item(
    item_id: uuid.UUID,
    payload: RunItemUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Record OK / Issue / N/A (or a reading) against one checkpoint."""
    item = await db.get(TaskItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    run = await _load_run(db, item.task_id)
    await _require_view(db, user, run)
    if run.status in ("submitted", "done"):
        raise HTTPException(
            status_code=409, detail="This run is locked; ask the reviewer to send it back"
        )

    data = payload.model_dump(exclude_unset=True)
    if "status" in data and data["status"] not in ITEM_STATUSES:
        raise HTTPException(status_code=422, detail="Invalid item status")
    for field, value in data.items():
        setattr(item, field, value)
    if item.response_type in ("text", "number") and item.value:
        item.status = "done"
    item.done = item.status in ("ok", "done", "na")
    item.responded_by_id = user.id
    item.responded_at = datetime.now(timezone.utc)

    # First response on the run starts the clock and moves it off the backlog.
    if run.status == "todo":
        run.status = "in_progress"
        run.started_at = run.started_at or datetime.now(timezone.utc)

    if item.status == "issue":
        tpl = await db.get(ChecklistTemplate, run.template_id)
        await raise_ticket_for_item(db, task=run, item=item, template=tpl, user=user)
    await db.commit()
    await db.refresh(item)

    out = RunItemOut.model_validate(item)
    out.responded_by_name = user.display_name or user.email
    out.photo_count = (await _photo_counts(db, {item.id})).get(item.id, 0)
    if item.ticket_id:
        # Resolve from the item, not from this call's return value — re-marking
        # an item reuses the ticket already linked to it.
        linked = await db.get(Ticket, item.ticket_id)
        out.ticket_number = linked.number if linked else None
    if item.asset_id:
        asset = await db.get(TrackedAsset, item.asset_id)
        out.asset_name = asset.name if asset else None
    return out


@runs_router.get("", response_model=list[RunOut])
async def list_runs(
    template_id: uuid.UUID | None = None,
    assignee_id: uuid.UUID | None = None,
    status: str | None = None,
    team: str | None = None,
    mine: bool = Query(False, description="Runs assigned to me or claimable by my team"),
    awaiting_verification: bool = False,
    from_date: date | None = Query(None, alias="from"),
    to_date: date | None = Query(None, alias="to"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = (
        select(Task)
        .where(Task.template_id.is_not(None))
        .order_by(Task.run_date.desc(), Task.created_at.desc())
    )
    if template_id:
        stmt = stmt.where(Task.template_id == template_id)
    if assignee_id:
        stmt = stmt.where(Task.assignee_id == assignee_id)
    if status:
        stmt = stmt.where(Task.status == status)
    if from_date:
        stmt = stmt.where(Task.run_date >= from_date)
    if to_date:
        stmt = stmt.where(Task.run_date <= to_date)
    if awaiting_verification:
        stmt = stmt.where(Task.status == "submitted")
        if not user.is_admin:
            stmt = stmt.where(Task.reviewer_id == user.id)
    if team:
        stmt = stmt.where(
            Task.template_id.in_(
                select(ChecklistTemplate.id).where(ChecklistTemplate.team == team)
            )
        )
    if mine or not _is_manager(user):
        # Own work, plus the rota runs belonging to the caller's department.
        clauses = [Task.assignee_id == user.id, Task.reviewer_id == user.id]
        if user.department_id:
            clauses.append(
                Task.template_id.in_(
                    select(ChecklistTemplate.id).where(
                        ChecklistTemplate.assignee_department_id == user.department_id
                    )
                )
            )
        stmt = stmt.where(or_(*clauses))
    runs = (await db.execute(stmt)).scalars().all()
    return await _serialize_runs(db, list(runs))


@runs_router.get("/{run_id}", response_model=RunDetail)
async def get_run(
    run_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    run = await _load_run(db, run_id)
    await _require_view(db, user, run)
    base = (await _serialize_runs(db, [run]))[0]
    detail = RunDetail(**base.model_dump(), description=run.description)

    photos = await _photo_counts(db, {i.id for i in run.items})
    asset_ids = {i.asset_id for i in run.items if i.asset_id}
    assets = {}
    if asset_ids:
        assets = {
            a.id: a.name
            for a in (
                (
                    await db.execute(
                        select(TrackedAsset).where(TrackedAsset.id.in_(asset_ids))
                    )
                )
                .scalars()
                .all()
            )
        }
    ticket_ids = {i.ticket_id for i in run.items if i.ticket_id}
    tickets = {}
    if ticket_ids:
        tickets = {
            t.id: t.number
            for t in (
                (await db.execute(select(Ticket).where(Ticket.id.in_(ticket_ids))))
                .scalars()
                .all()
            )
        }
    responder_names = await user_names(db, {i.responded_by_id for i in run.items})

    for item in sorted(run.items, key=lambda x: x.sort):
        row = RunItemOut.model_validate(item)
        row.photo_count = photos.get(item.id, 0)
        row.asset_name = assets.get(item.asset_id) if item.asset_id else None
        row.ticket_number = tickets.get(item.ticket_id) if item.ticket_id else None
        row.responded_by_name = (
            responder_names.get(item.responded_by_id) if item.responded_by_id else None
        )
        detail.items.append(row)
    return detail


@runs_router.get("/{run_id}/report.pdf")
async def run_report_pdf(
    run_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """A printable PDF of the run — every checkpoint, its response, notes and
    embedded photo evidence. Same access rule as viewing the run."""
    run = await _load_run(db, run_id)
    await _require_view(db, user, run)
    base = (await _serialize_runs(db, [run]))[0]

    item_ids = {i.id for i in run.items}
    photos_by_item: dict = {}
    if item_ids:
        atts = (
            await db.execute(
                select(Attachment)
                .where(
                    Attachment.entity_type == "task_item",
                    Attachment.entity_id.in_(item_ids),
                )
                .order_by(Attachment.created_at.asc())
            )
        ).scalars().all()
        for a in atts:
            photos_by_item.setdefault(a.entity_id, []).append(a.file_path)
    responder_names = await user_names(
        db, {i.responded_by_id for i in run.items if i.responded_by_id}
    )

    sections: list[dict] = []
    for item in sorted(run.items, key=lambda x: x.sort):
        name = item.section or "Checks"
        if not sections or sections[-1]["name"] != name:
            sections.append({"name": name, "items": []})
        sections[-1]["items"].append(
            {
                "title": item.title,
                "status": item.status,
                "note": item.note,
                "value": item.value,
                "responded_by": responder_names.get(item.responded_by_id)
                if item.responded_by_id
                else None,
                "responded_at": item.responded_at.strftime("%Y-%m-%d %H:%M")
                if item.responded_at
                else None,
                "photos": photos_by_item.get(item.id, []),
            }
        )

    pdf = render_run_report(
        {
            "name": base.template_name or run.title,
            "run_date": str(run.run_date or ""),
            "checked_by": base.assignee_name,
            "verified_by": base.verified_by_name or base.reviewer_name,
            "status": base.status,
            "answered": base.items_answered,
            "total": base.items_total,
            "sections": sections,
        }
    )
    stamp = str(run.run_date or "report")
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="routine-check-{stamp}.pdf"'},
    )


@runs_router.post("/{run_id}/claim", response_model=RunOut)
async def claim_run(
    run_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Take an unassigned rota run. Also fixes the reviewer to your manager."""
    run = await _load_run(db, run_id)
    await _require_view(db, user, run)
    if run.assignee_id and run.assignee_id != user.id:
        raise HTTPException(status_code=409, detail="Already claimed by someone else")
    run.assignee_id = user.id
    if run.reviewer_id is None:
        tpl = await db.get(ChecklistTemplate, run.template_id)
        if tpl and tpl.requires_verification:
            run.reviewer_id = tpl.reviewer_id or user.manager_id
    await db.commit()
    await db.refresh(run)
    return (await _serialize_runs(db, [run]))[0]


@runs_router.post("/{run_id}/submit", response_model=RunOut)
async def submit_run(
    run_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Hand a completed round to the reviewer.

    Refuses while anything is unanswered or a required photo is missing — this
    is what makes "take a picture and mark it done" enforceable.
    """
    run = await _load_run(db, run_id)
    await _require_view(db, user, run)
    if run.status in ("submitted", "done"):
        raise HTTPException(status_code=409, detail="This run was already submitted")

    pending = [i for i in run.items if i.status == "pending"]
    if pending:
        raise HTTPException(
            status_code=422,
            detail=f"{len(pending)} check(s) still unanswered — "
            f"first is '{sorted(pending, key=lambda x: x.sort)[0].title}'",
        )
    photos = await _photo_counts(db, {i.id for i in run.items})
    missing = [
        i
        for i in run.items
        if i.photo_required and i.status != "na" and photos.get(i.id, 0) == 0
    ]
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"{len(missing)} check(s) need a photo — "
            f"first is '{sorted(missing, key=lambda x: x.sort)[0].title}'",
        )

    tpl = await db.get(ChecklistTemplate, run.template_id)
    now = datetime.now(timezone.utc)
    run.submitted_at = now
    # When the template demands verification the run waits even if no reviewer
    # was resolved — an unrouted run must not quietly self-approve. Admins can
    # verify a run that has no named reviewer.
    if tpl and tpl.requires_verification:
        run.status = "submitted"
    else:
        run.status = "done"
        run.completed_at = now
    actor = user.display_name or user.email
    record(
        db,
        user=user,
        action="submitted",
        entity_type="checklist_run",
        entity_id=run.id,
        summary=f"{actor} submitted '{run.title}'",
    )
    if run.status == "submitted" and run.reviewer_id:
        issues = sum(1 for i in run.items if i.status == "issue")
        await notify_user(
            db,
            user_id=run.reviewer_id,
            title="Checks ready for your verification",
            body=f"{run.title}{f' — {issues} issue(s)' if issues else ''}",
            link="/routine-checks",
            category="task",
            dedup_key=f"run-submitted:{run.id}",
        )
    await db.commit()
    await db.refresh(run)
    return (await _serialize_runs(db, [run]))[0]


@runs_router.post("/{run_id}/verify", response_model=RunOut)
async def verify_run(
    run_id: uuid.UUID,
    payload: RunVerify,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Reviewer signs the run off, or sends it back with a note."""
    run = await _load_run(db, run_id)
    if not (user.is_admin or run.reviewer_id == user.id):
        raise HTTPException(status_code=403, detail="Only the reviewer can verify")
    if run.status != "submitted":
        raise HTTPException(status_code=409, detail="This run is not awaiting verification")
    if payload.decision not in ("verify", "reject"):
        raise HTTPException(status_code=422, detail="Invalid decision")

    now = datetime.now(timezone.utc)
    actor = user.display_name or user.email
    run.review_note = payload.note
    if payload.decision == "verify":
        run.status = "done"
        run.verified_at = now
        run.verified_by_id = user.id
        run.completed_at = now
        title, body = "Your checks were verified", run.title
    else:
        run.status = "in_progress"
        run.submitted_at = None
        title, body = "Your checks were sent back", payload.note or run.title
    record(
        db,
        user=user,
        action=payload.decision,
        entity_type="checklist_run",
        entity_id=run.id,
        summary=f"{actor} {'verified' if payload.decision == 'verify' else 'sent back'} '{run.title}'",
    )
    if run.assignee_id and run.assignee_id != user.id:
        await notify_user(
            db,
            user_id=run.assignee_id,
            title=title,
            body=body,
            link="/routine-checks",
            category="task",
        )
    await db.commit()
    await db.refresh(run)
    return (await _serialize_runs(db, [run]))[0]

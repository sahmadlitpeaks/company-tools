"""Helpers to record per-field changes (adds rows to the session; caller commits)."""
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.field_audit import FieldChange


def _norm(v) -> str | None:
    if v is None:
        return None
    return str(v)


def record_field_change(
    db: AsyncSession,
    *,
    entity_type: str,
    entity_id: uuid.UUID,
    field: str,
    old,
    new,
    actor_id: uuid.UUID | None,
) -> None:
    old_s, new_s = _norm(old), _norm(new)
    if old_s == new_s:
        return
    db.add(FieldChange(
        entity_type=entity_type, entity_id=entity_id, field=field,
        old_value=old_s, new_value=new_s, actor_id=actor_id,
    ))

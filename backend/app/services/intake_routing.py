"""Decide what an inbound submission *is* and where it should go.

A careers form and a sales enquiry arrive through the same webhook, from the
same website, in the same shape. Which is which is a business decision that
changes over time, so it lives in admin-editable rules here rather than in the
WordPress plugin — a site owner should never have to redeploy a plugin because
the sales team reorganised its pipeline.

Rules are ordered and the first match wins. Conditions can test the form, the
page it sits on, or any submitted value, so "the enquiry dropdown said Careers"
is expressible without a dedicated form.
"""
import re
from dataclasses import dataclass
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.intake import DESTINATIONS, SUBMISSION_TYPES, IntakeRoutingRule

CONDITION_KINDS = ["page_url", "form_key", "form_name", "field", "subject", "message", "type"]
CONDITION_OPS = ["equals", "contains", "starts_with", "regex", "exists"]


@dataclass
class Routing:
    """The resolved outcome for one submission."""

    type: str | None = None
    destination: str | None = None
    job_id: Any = None
    job_from_field: str | None = None
    assignee_id: Any = None
    auto_convert: bool | None = None
    tag: str | None = None
    rule_id: Any = None
    rule_name: str | None = None


def _haystack(condition: dict, *, form, core: dict, raw: dict, page_url: str | None) -> str | None:
    kind = condition.get("kind")
    if kind == "page_url":
        return page_url or core.get("page_url")
    if kind == "form_key":
        return getattr(form, "form_key", None)
    if kind == "form_name":
        return getattr(form, "name", None)
    if kind == "subject":
        return core.get("subject")
    if kind == "message":
        return core.get("message")
    if kind == "type":
        return core.get("type")
    if kind == "field":
        field_name = condition.get("field")
        if not field_name:
            return None
        if field_name in raw:
            value = raw[field_name]
        else:
            value = core.get(field_name)
        if isinstance(value, (list, tuple)):
            return ", ".join(str(v) for v in value)
        return None if value is None else str(value)
    return None


def condition_matches(
    condition: dict, *, form, core: dict, raw: dict, page_url: str | None
) -> bool:
    if not isinstance(condition, dict):
        return False
    actual = _haystack(condition, form=form, core=core, raw=raw, page_url=page_url)
    op = condition.get("op") or "contains"
    wanted = str(condition.get("value") or "")

    if op == "exists":
        return bool(actual and str(actual).strip())
    if actual is None:
        return False
    actual_s = str(actual).lower()
    wanted_s = wanted.lower()

    if op == "equals":
        return actual_s.strip() == wanted_s.strip()
    if op == "starts_with":
        return actual_s.strip().startswith(wanted_s.strip())
    if op == "regex":
        try:
            return bool(re.search(wanted, str(actual), re.IGNORECASE))
        except re.error:
            # A malformed pattern must never take the ingest endpoint down.
            return False
    return wanted_s in actual_s


def rule_matches(rule: IntakeRoutingRule, *, form, core: dict, raw: dict, page_url: str | None) -> bool:
    """Every condition must hold. A rule with no conditions matches nothing.

    That last part is deliberate — an empty rule saved by accident would
    otherwise silently capture every submission on the site.
    """
    conditions = rule.conditions or []
    if not conditions:
        return False
    return all(
        condition_matches(c, form=form, core=core, raw=raw, page_url=page_url)
        for c in conditions
    )


async def resolve(
    db: AsyncSession,
    *,
    source,
    form,
    core: dict,
    raw: dict,
    page_url: str | None = None,
) -> Routing:
    """Find the first matching rule and return its outcome.

    Falls back to the form's own destination/type when nothing matches, so a
    site with no rules at all still behaves sensibly.
    """
    source_id = getattr(source, "id", None)
    form_id = getattr(form, "id", None)
    stmt = (
        select(IntakeRoutingRule)
        .where(IntakeRoutingRule.active.is_(True))
        .where(or_(IntakeRoutingRule.source_id.is_(None), IntakeRoutingRule.source_id == source_id))
        .order_by(IntakeRoutingRule.priority, IntakeRoutingRule.created_at)
    )
    rules = (await db.execute(stmt)).scalars().all()

    for rule in rules:
        if rule.form_id and rule.form_id != form_id:
            continue
        if not rule_matches(rule, form=form, core=core, raw=raw, page_url=page_url):
            continue
        outcome = rule.outcome or {}
        rule.match_count = (rule.match_count or 0) + 1
        routing = Routing(
            type=outcome.get("type") if outcome.get("type") in SUBMISSION_TYPES else None,
            destination=(
                outcome.get("destination") if outcome.get("destination") in DESTINATIONS else None
            ),
            job_id=outcome.get("job_id"),
            job_from_field=outcome.get("job_from_field"),
            assignee_id=outcome.get("assignee_id"),
            auto_convert=outcome.get("auto_convert"),
            tag=outcome.get("tag"),
            rule_id=rule.id,
            rule_name=rule.name,
        )
        break
    else:
        routing = Routing()

    # Fill the gaps from the form, then the source.
    if routing.destination is None:
        routing.destination = getattr(form, "destination", None) or "crm_lead"
    if routing.type is None:
        # A type stated in the request beats the configured default, but a rule
        # that explicitly reclassified the submission still beats both.
        declared = core.get("type")
        routing.type = (
            (declared if declared in SUBMISSION_TYPES else None)
            or getattr(form, "default_type", None)
            or getattr(source, "default_type", "lead")
        )
    if routing.job_id is None:
        routing.job_id = getattr(form, "job_id", None)
    if routing.auto_convert is None:
        form_auto = getattr(form, "auto_convert", None)
        routing.auto_convert = (
            form_auto if form_auto is not None else getattr(source, "auto_convert", False)
        )
    return routing

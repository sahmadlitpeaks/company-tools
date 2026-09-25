"""Turn evidence-backed SharePoint facts into owned compliance work."""

import uuid
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.company import Company
from app.models.department import Department
from app.models.sharepoint import (
    SharePointComplianceEvent, SharePointComplianceTask, SharePointDocument,
    SharePointDocumentVersion, SharePointOwnerRule, SharePointReminder, SharePointConnection,
)
from app.models.user import User
from app.services.sharepoint.common import digest, now

DOCUMENT_TYPES = {
    "trade_license", "contract", "iso_cap_certificate", "insurance", "dpa",
    "regulatory_license", "vendor_agreement", "laboratory_accreditation",
    "it_software_agreement", "other", "unknown",
}
CONTRACT_TYPES = {"contract", "vendor_agreement", "it_software_agreement", "dpa"}
DEFAULT_LEADS = (60, 30, 28, 21, 14, 7, 6, 5, 4, 3, 2, 1, 0, -1)
OPTIONAL_FACT_ISSUES = frozenset({"parties", "obligations"})


def event(db, document_id, action, *, task_id=None, actor_id=None, details=None):
    db.add(SharePointComplianceEvent(document_id=document_id, task_id=task_id,
        actor_id=actor_id, action=action, details=details))


async def archive_prior_version(db: AsyncSession, document: SharePointDocument):
    if not document.version or not document.compliance:
        return
    existing = (await db.scalars(select(SharePointDocumentVersion).where(
        SharePointDocumentVersion.document_id == document.id,
        SharePointDocumentVersion.source_version == document.version))).first()
    if existing is None:
        db.add(SharePointDocumentVersion(document_id=document.id,
            source_version=document.version, modified_at=document.modified_at,
            extracted=document.compliance, status=document.compliance_status))
        event(db, document.id, "version_archived", details={"source_version": document.version})
    for task in (await db.scalars(select(SharePointComplianceTask).where(
        SharePointComplianceTask.document_id == document.id,
        SharePointComplianceTask.status == "active"))).all():
        task.status = "suspended"
        for reminder in (await db.scalars(select(SharePointReminder).where(
            SharePointReminder.task_id == task.id,
            SharePointReminder.status.in_(["pending", "failed"])))).all():
            reminder.status = "dismissed"


def _fact_value(fact):
    return fact.get("value") if isinstance(fact, dict) else None


def combine_facts(analysis: dict) -> tuple[dict, list[str]]:
    """Reject conflicts between independently analyzed document chunks."""
    sections = analysis.get("sections") or [analysis]
    fields = ("document_type", "company", "reference_number", "issue_date", "effective_date",
              "expiry_date", "renewal_date", "termination_notice")
    combined: dict = {"parties": [], "obligations": [], "required_actions": [], "validation_issues": []}
    conflicts: list[str] = []
    for section in sections:
        data = section.get("compliance") or {}
        issues = data.get("validation_issues") or []
        combined["validation_issues"].extend(issues)
        conflicts.extend(issue for issue in issues if issue not in OPTIONAL_FACT_ISSUES)
        for field in fields:
            candidate = data.get(field)
            if candidate is None or candidate == "unknown":
                continue
            value = candidate if field == "document_type" else candidate.get("days") if field == "termination_notice" else _fact_value(candidate)
            existing = combined.get(field)
            existing_value = existing if field == "document_type" else existing.get("days") if field == "termination_notice" and existing else _fact_value(existing)
            if existing is not None and str(existing_value).casefold() != str(value).casefold():
                if field not in conflicts:
                    conflicts.append(field)
            elif existing is None:
                combined[field] = candidate
        for field in ("parties", "obligations", "required_actions"):
            combined[field].extend(data.get(field) or [])
    combined.setdefault("document_type", "unknown")
    return combined, conflicts


async def _company(db: AsyncSession, name: str | None) -> Company | None:
    if not name:
        return None
    normalized = " ".join(name.casefold().split())
    companies = (await db.scalars(select(Company).where(Company.is_active.is_(True)))).all()
    matches = [company for company in companies if normalized in {
        " ".join(candidate.casefold().split())
        for candidate in (company.name, company.slug, *(company.aliases or []))
    }]
    return matches[0] if len(matches) == 1 else None


async def reconcile_company_matches(db: AsyncSession) -> int:
    """Revisit stored extractions after the company catalog gains a matching name.

    Uses saved analysis, so this does not call the AI API or re-download files.
    Other review reasons remain in force; tasks start only when validation clears.
    """
    from app.services.sharepoint.reminders import populate_task_reminders

    documents = (await db.scalars(select(SharePointDocument).where(
        SharePointDocument.status == "ready",
        SharePointDocument.compliance_status == "needs_review",
        SharePointDocument.company_id.is_(None),
        SharePointDocument.in_scope.is_(True),
        SharePointDocument.deleted.is_(False),
    ))).all()
    matched = 0
    for document in documents:
        facts = document.compliance or {}
        if "company" not in facts.get("review_reasons", []) or not document.analysis:
            continue
        if not await _company(db, _fact_value(facts.get("company"))):
            continue
        plans = await apply_analysis(db, document, document.analysis,
            uploaded_by_email=document.uploaded_by_email,
            uploaded_by_oid=document.uploaded_by_oid)
        if not document.company_id:
            continue
        matched += 1
        event(db, document.id, "company_matched", details={"company_id": str(document.company_id)})
        for task, leads in plans:
            await populate_task_reminders(db, task, leads)
    return matched


async def reconcile_optional_fact_reviews(db: AsyncSession) -> int:
    """Recheck old review holds involving discarded optional descriptions.

    Reuses stored analysis without calling the AI API or downloading the file.
    Other review reasons, including missing owner or action date, still block.
    """
    from app.services.sharepoint.reminders import populate_task_reminders

    documents = (await db.scalars(select(SharePointDocument).where(
        SharePointDocument.status == "ready",
        SharePointDocument.compliance_status == "needs_review",
        SharePointDocument.in_scope.is_(True),
        SharePointDocument.deleted.is_(False),
    ))).all()
    updated = 0
    for document in documents:
        reasons = set((document.compliance or {}).get("review_reasons") or [])
        if not reasons.intersection(OPTIONAL_FACT_ISSUES) or not document.analysis:
            continue
        plans = await apply_analysis(db, document, document.analysis,
            uploaded_by_email=document.uploaded_by_email,
            uploaded_by_oid=document.uploaded_by_oid)
        updated += 1
        for task, leads in plans:
            await populate_task_reminders(db, task, leads)
    return updated


async def resolve_owner(db: AsyncSession, company_id, document_type: str,
                        uploaded_by_email: str | None = None, uploaded_by_oid: str | None = None):
    rules = (await db.scalars(select(SharePointOwnerRule).where(SharePointOwnerRule.is_active.is_(True))
        .order_by(SharePointOwnerRule.priority.asc(), SharePointOwnerRule.created_at.asc()))).all()
    rules = sorted(rules, key=lambda rule: (
        0 if rule.company_id == company_id else 1,
        0 if rule.document_type == document_type else 1,
        rule.priority,
    ))
    for rule in rules:
        if rule.company_id not in (None, company_id) or rule.document_type not in (None, document_type):
            continue
        if rule.owner_user_id:
            owner = await db.get(User, rule.owner_user_id)
            if owner and owner.is_active and owner.status == "active" and owner.email:
                return owner.id, None, "rule", rule.reminder_leads or list(DEFAULT_LEADS)
        if rule.owner_department_id:
            department = await db.get(Department, rule.owner_department_id)
            member = (await db.scalars(select(User).where(
                User.department_id == rule.owner_department_id, User.is_active.is_(True),
                User.status == "active", User.email.is_not(None)).limit(1))).first()
            if department and member:
                return None, department.id, "rule", rule.reminder_leads or list(DEFAULT_LEADS)
    if uploaded_by_email or uploaded_by_oid:
        from sqlalchemy import or_
        checks = []
        if uploaded_by_email:
            checks.append(User.email == uploaded_by_email.strip().lower())
        if uploaded_by_oid:
            checks.append(User.azure_oid == uploaded_by_oid)
        uploader = (await db.scalars(select(User).where(or_(*checks),
            User.is_active.is_(True), User.status == "active"))).first()
        if uploader and uploader.email:
            return uploader.id, None, "uploaded_by", list(DEFAULT_LEADS)
    departments = (await db.scalars(select(Department))).all()
    compliance = next((department for department in departments if department.name.casefold() == "compliance"), None)
    compliance_member = (await db.scalars(select(User).where(
        User.department_id == compliance.id, User.is_active.is_(True),
        User.status == "active", User.email.is_not(None)).limit(1))).first() if compliance else None
    if compliance and compliance_member:
        return None, compliance.id, "default_compliance", list(DEFAULT_LEADS)
    default_admin = (await db.scalars(select(User).join(
        SharePointConnection, SharePointConnection.user_id == User.id).where(
        User.is_admin.is_(True), User.is_active.is_(True), User.status == "active",
        User.email.is_not(None)).order_by(User.created_at.asc()).limit(1))).first()
    if default_admin:
        return default_admin.id, None, "default_compliance_admin", list(DEFAULT_LEADS)
    return None, None, "needs_review", list(DEFAULT_LEADS)


def candidate_actions(facts: dict) -> list[tuple[str, str, date, str]]:
    result = []
    document_type = facts.get("document_type", "other")
    label = document_type.replace("_", " ").title()
    expiry = _fact_value(facts.get("expiry_date"))
    notice = (facts.get("termination_notice") or {}).get("days")
    if expiry:
        expiry_date = date.fromisoformat(expiry)
        if document_type in CONTRACT_TYPES and notice:
            result.append(("termination_notice", "Review termination or renewal notice", expiry_date - timedelta(days=notice), "notice_period"))
        else:
            result.append(("expiry", f"Renew {label}", expiry_date, "expiry"))
    renewal = _fact_value(facts.get("renewal_date"))
    if renewal:
        renewal_date = date.fromisoformat(renewal)
        if not result or renewal_date != result[0][2]:
            result.append(("renewal", f"Renew {label}", renewal_date, "renewal"))
    for index, action in enumerate(facts.get("required_actions") or []):
        deadline = action.get("deadline")
        if deadline:
            result.append((f"action-{index}", action.get("title") or "Document action", date.fromisoformat(deadline), "explicit_action"))
    return result


async def apply_analysis(db: AsyncSession, document: SharePointDocument, analysis: dict, *,
                         uploaded_by_email=None, uploaded_by_oid=None,
                         override_company_id=None, override_owner_user_id=None,
                         override_owner_department_id=None, human_review=False):
    facts, conflicts = combine_facts(analysis)
    company = await db.get(Company, override_company_id) if override_company_id else await _company(db, _fact_value(facts.get("company")))
    document_type = facts["document_type"]
    owner_user_id, owner_department_id, assignment, leads = await resolve_owner(
        db, company.id if company else None, document_type, uploaded_by_email, uploaded_by_oid)
    if override_owner_user_id or override_owner_department_id:
        owner_user_id, owner_department_id = override_owner_user_id, override_owner_department_id
        assignment = "human_review"
    actions = candidate_actions(facts)
    reasons = [] if human_review else list(conflicts)
    if document_type == "unknown" or document_type not in DOCUMENT_TYPES or (document_type == "other" and not human_review):
        reasons.append("document_type")
    if not company:
        reasons.append("company")
    if not actions:
        reasons.append("action_date")
    if not owner_user_id and not owner_department_id:
        reasons.append("owner")
    if facts.get("termination_notice") and not facts.get("expiry_date"):
        reasons.append("notice_without_expiry")
    if document_type in CONTRACT_TYPES and facts.get("expiry_date") and not facts.get("termination_notice") and not human_review:
        reasons.append("notice_period")
    facts["review_reasons"] = sorted(set(reasons))
    document.compliance, document.company_id = facts, company.id if company else None
    if reasons:
        document.compliance_status = "needs_review"
        event(db, document.id, "needs_review", details={"reasons": facts["review_reasons"]})
        return []
    document.compliance_status = "active"
    tasks = []
    for key, title, due, basis in actions:
        action_key = digest([key, title, due.isoformat()])[:64]
        task = (await db.scalars(select(SharePointComplianceTask).where(
            SharePointComplianceTask.document_id == document.id,
            SharePointComplianceTask.action_key == action_key))).first()
        if task is None:
            task = SharePointComplianceTask(source_id=document.source_id, document_id=document.id,
                action_key=action_key, title=title[:512], due_date=due, basis=basis,
                status="active", owner_user_id=owner_user_id,
                owner_department_id=owner_department_id, assignment_source=assignment)
            db.add(task)
            await db.flush()
            event(db, document.id, "task_created", task_id=task.id,
                  details={"due_date": due.isoformat(), "assignment": assignment})
        elif task.status == "suspended":
            task.status = "active"
            task.owner_user_id, task.owner_department_id = owner_user_id, owner_department_id
            task.assignment_source = assignment
            event(db, document.id, "task_reactivated", task_id=task.id)
        tasks.append(task)
    active_keys = {task.action_key for task in tasks}
    for old_task in (await db.scalars(select(SharePointComplianceTask).where(
        SharePointComplianceTask.document_id == document.id,
        SharePointComplianceTask.status == "suspended"))).all():
        if old_task.action_key not in active_keys:
            old_task.status = "superseded"
            event(db, document.id, "task_superseded", task_id=old_task.id)
    event(db, document.id, "extracted", details={"document_type": document_type,
        "company_id": str(company.id), "reference_number": _fact_value(facts.get("reference_number")),
        "task_count": len(tasks)})
    await _supersede_previous(db, document, facts)
    return [(task, leads) for task in tasks]


async def _supersede_previous(db: AsyncSession, new_document: SharePointDocument, facts: dict):
    reference = _fact_value(facts.get("reference_number"))
    expiry = _fact_value(facts.get("expiry_date"))
    if not reference or not expiry or not new_document.company_id:
        return
    previous = (await db.scalars(select(SharePointDocument).where(
        SharePointDocument.source_id == new_document.source_id,
        SharePointDocument.company_id == new_document.company_id,
        SharePointDocument.id != new_document.id,
        SharePointDocument.compliance_status == "active"))).all()
    for old in previous:
        old_facts = old.compliance or {}
        if old_facts.get("document_type") != facts.get("document_type"):
            continue
        if str(_fact_value(old_facts.get("reference_number")) or "").casefold() != reference.casefold():
            continue
        old_expiry = _fact_value(old_facts.get("expiry_date"))
        if not old_expiry or old_expiry >= expiry:
            continue
        old.compliance_status = "superseded"
        for task in (await db.scalars(select(SharePointComplianceTask).where(
            SharePointComplianceTask.document_id == old.id,
            SharePointComplianceTask.status == "active"))).all():
            task.status, task.superseded_by_id = "superseded", new_document.id
            event(db, old.id, "task_superseded", task_id=task.id,
                details={"replacement_id": str(new_document.id)})
            for reminder in (await db.scalars(select(SharePointReminder).where(
                SharePointReminder.task_id == task.id,
                SharePointReminder.status.in_(["pending", "failed"])))).all():
                reminder.status = "dismissed"
        event(db, old.id, "document_superseded", details={"replacement_id": str(new_document.id)})

"""Decision approval, immutable evidence, role boundaries and stale writes."""
import uuid

import pytest
import pytest_asyncio

from helpers import make_member

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def setup(client, auth):
    project = (await client.post("/api/pm/projects", headers=auth, json={"key": "DEC", "name": "Decisions"})).json()
    proposer, owner = await make_member(client, auth, "decision-owner@agholding.net")
    approver, reviewer = await make_member(client, auth, "decision-reviewer@agholding.net")
    outsider, _ = await make_member(client, auth, "decision-outsider@agholding.net", role="manager")
    for uid, role in ((owner, "member"), (reviewer, "viewer")):
        assert (await client.post(f"/api/pm/projects/{project['id']}/members", headers=auth,
                                  json={"user_id": uid, "role": role})).status_code == 201
    issue = (await client.post(f"/api/pm/projects/{project['id']}/issues", headers=proposer,
                               json={"summary": "Implement threshold", "issue_type": "story"})).json()
    content = dict(title="Finance approval threshold", category="business", context="Control purchasing",
                   approach="Finance approves above 5000", rationale="Reduce delays", owner_id=owner,
                   approver_id=reviewer, issue_ids=[issue["id"]], evidence=[
                       {"type": "meeting", "label": "Meeting notes", "url": "https://example.test/meeting"}])
    response = await client.post(f"/api/pm/projects/{project['id']}/decisions", headers=proposer, json=content)
    assert response.status_code == 201, response.text
    return project, proposer, approver, outsider, content, response.json(), issue


async def action(client, headers, row, name, **payload):
    return await client.post(f"/api/pm/decisions/{row['id']}/{name}", headers=headers,
                             json={"version": row["version"], **payload})


async def submitted(client, setup):
    project, proposer, approver, outsider, content, row, issue = setup
    response = await action(client, proposer, row, "submit", change_summary="Initial proposal")
    assert response.status_code == 200, response.text
    return response.json()


async def test_decision_links_search_filters_and_numbering(client, auth, setup):
    project, proposer, approver, outsider, content, row, issue = setup
    assert row["key"] == "DEC-DEC-1" and row["issues"][0]["key"] == issue["key"]
    assert row["evidence"][0]["added_by_id"] == content["owner_id"]
    links = (await client.get(f"/api/pm/issues/{issue['id']}/decisions", headers=approver)).json()
    assert [d["id"] for d in links] == [row["id"]]
    for q in ("DEC-DEC-1", "Finance", "Reduce delays", issue["key"]):
        result = await client.get(f"/api/pm/projects/{project['id']}/decisions", headers=approver, params={"q": q})
        assert result.json()["total"] == 1, result.text
    empty = await client.get(f"/api/pm/projects/{project['id']}/decisions?q=%25", headers=proposer)
    assert empty.json()["total"] == 0
    for params in ({"before": "9999-12-31"}, {"after": row["created_at"][:10], "before": row["created_at"][:10]}):
        result = await client.get(f"/api/pm/projects/{project['id']}/decisions", headers=proposer, params=params)
        assert result.status_code == 200 and result.json()["total"] == 1
    assert (await client.get(f"/api/pm/projects/{project['id']}/decisions", headers=proposer,
                             params={"after": "2026-10-16", "before": "2026-10-15"})).status_code == 422
    for params in ({"status": "approved"}, {"category": "technical"}, {"owner_id": str(uuid.uuid4())}, {"offset": 1}):
        result = (await client.get(f"/api/pm/projects/{project['id']}/decisions", headers=proposer, params=params)).json()
        assert result["items"] == []
    second = (await client.post(f"/api/pm/projects/{project['id']}/decisions", headers=proposer, json=content)).json()
    assert second["key"] == "DEC-DEC-2"


async def test_project_and_viewer_boundaries(client, auth, setup):
    project, proposer, approver, outsider, content, row, issue = setup
    for path in (f"/api/pm/decisions/{row['id']}", f"/api/pm/projects/{project['id']}/decisions", f"/api/pm/issues/{issue['id']}/decisions"):
        assert (await client.get(path, headers=outsider)).status_code == 404
    assert (await client.post(f"/api/pm/projects/{project['id']}/decisions", headers=approver, json=content)).status_code == 403
    assert (await client.patch(f"/api/pm/decisions/{row['id']}", headers=approver, json={**content, "version": 1})).status_code == 403
    pending = await submitted(client, setup)
    assert (await action(client, outsider, pending, "approval", revision_number=1, outcome="approved")).status_code == 404
    # A platform admin is not a substitute for the explicitly assigned approver.
    assert (await action(client, auth, pending, "approval", revision_number=1, outcome="approved")).status_code == 403
    approved = await action(client, approver, pending, "approval", revision_number=1, outcome="approved")
    assert approved.status_code == 200 and approved.json()["approved_revision_number"] == 1


async def test_approved_snapshot_survives_revision_and_issue_deletion(client, auth, setup):
    project, proposer, approver, outsider, content, row, issue = setup
    pending = await submitted(client, setup)
    approved = (await action(client, approver, pending, "approval", revision_number=1, outcome="approved", note="Agreed")).json()
    snapshot = approved["revisions"][0]["snapshot"]
    assert (await client.patch(f"/api/pm/decisions/{row['id']}", headers=proposer, json={**content, "version": approved["version"]})).status_code == 409
    draft = (await action(client, proposer, approved, "revise", reason="Raise the threshold")).json()
    changed = (await client.patch(f"/api/pm/decisions/{row['id']}", headers=proposer,
                                  json={**content, "approach": "Finance approves above 10000", "version": draft["version"]})).json()
    assert changed["approved_revision_number"] == 1 and changed["revisions"][0]["snapshot"] == snapshot
    assert (await client.delete(f"/api/pm/issues/{issue['id']}", headers=proposer)).status_code == 204
    pending2 = (await action(client, proposer, changed, "submit", change_summary="Higher threshold requested")).json()
    assert pending2["revision_number"] == 2 and pending2["approved_revision_number"] == 1
    assert pending2["revisions"][1]["snapshot"] == snapshot
    assert snapshot["issues"][0]["key"] == issue["key"]
    assert (await action(client, approver, pending2, "approval", revision_number=1, outcome="approved")).status_code == 409
    approved2 = (await action(client, approver, pending2, "approval", revision_number=2, outcome="approved")).json()
    assert approved2["approved_revision_number"] == 2
    assert [e["action"] for e in approved2["events"]].count("approved") == 2
    assert (await client.delete(f"/api/pm/decisions/{row['id']}", headers=auth)).status_code == 405


async def test_rejection_reason_withdrawal_and_stale_writes(client, setup):
    project, proposer, approver, outsider, content, row, issue = setup
    pending = await submitted(client, setup)
    assert (await action(client, approver, pending, "approval", revision_number=1, outcome="rejected", note="  ")).status_code == 422
    rejected = (await action(client, approver, pending, "approval", revision_number=1, outcome="rejected", note="Need impact estimate")).json()
    assert rejected["status"] == "rejected" and rejected["events"][-1]["note"] == "Need impact estimate"
    assert (await action(client, approver, pending, "approval", revision_number=1, outcome="approved")).status_code == 409
    draft = (await action(client, proposer, rejected, "revise", reason="Add estimate")).json()
    pending2 = (await action(client, proposer, draft, "submit", change_summary="Added estimate")).json()
    draft2 = (await action(client, proposer, pending2, "revise", reason="Withdraw for more research")).json()
    assert draft2["status"] == "draft" and len(draft2["revisions"]) == 2
    assert (await action(client, approver, pending2, "approval", revision_number=2, outcome="approved")).status_code == 409
    assert (await client.patch(f"/api/pm/decisions/{row['id']}", headers=proposer, json={**content, "version": row["version"]})).status_code == 409


async def test_invalid_links_people_and_lifecycle_payloads(client, auth, setup):
    project, proposer, approver, outsider, content, row, issue = setup
    other = (await client.post("/api/pm/projects", headers=auth, json={"key": "OT", "name": "Other"})).json()
    hidden = (await client.post(f"/api/pm/projects/{other['id']}/issues", headers=auth, json={"summary": "Private"})).json()
    cases = [{"issue_ids": [hidden["id"]]}, {"owner_id": content["approver_id"]}, {"approver_id": str(uuid.uuid4())},
             {"status": "approved"}, {"title": " "}, {"evidence": [{"label": "Bad", "url": "javascript:alert(1)"}]},
             {"evidence": [{"label": "Bad", "url": "https://user:pass@example.test"}]}]
    for change in cases:
        result = await client.patch(f"/api/pm/decisions/{row['id']}", headers=proposer, json={**content, "version": 1, **change})
        assert result.status_code == 422, result.text
    own = await client.patch(f"/api/pm/decisions/{row['id']}", headers=proposer, json={**content, "version": 1, "approver_id": content["owner_id"]})
    assert own.status_code == 200
    assert (await action(client, proposer, own.json(), "submit", change_summary="Self approval")).status_code == 422


async def test_superseding_archiving_and_project_archive(client, auth, setup):
    project, proposer, approver, outsider, content, row, issue = setup
    old = (await action(client, approver, await submitted(client, setup), "approval", revision_number=1, outcome="approved")).json()
    replacement = (await client.post(f"/api/pm/projects/{project['id']}/decisions", headers=proposer, json={**content, "title": "Replacement"})).json()
    assert (await action(client, proposer, old, "supersede", replacement_id=replacement["id"], reason="Updated policy")).status_code == 422
    submitted2 = (await action(client, proposer, replacement, "submit", change_summary="New policy")).json()
    replacement = (await action(client, approver, submitted2, "approval", revision_number=1, outcome="approved")).json()
    superseded = (await action(client, proposer, old, "supersede", replacement_id=replacement["id"], reason="Updated policy")).json()
    assert superseded["status"] == "superseded" and superseded["related_decisions"][0]["key"] == replacement["key"]
    assert superseded["superseded_by_revision_number"] == 1
    replacement_draft = (await action(client, proposer, replacement, "revise", reason="Explore a further change")).json()
    replacement_draft = (await client.patch(f"/api/pm/decisions/{replacement['id']}", headers=proposer,
                                           json={**content, "title": "Unapproved future policy", "version": replacement_draft["version"]})).json()
    related = (await client.get(f"/api/pm/decisions/{old['id']}", headers=proposer)).json()["related_decisions"][0]
    assert related["title"] == "Replacement" and related["revision_number"] == 1 and related["status"] == "draft"
    assert (await action(client, proposer, superseded, "archive", reason="Retain for reference")).status_code == 403
    archived = (await action(client, auth, superseded, "archive", reason="Retain for reference")).json()
    assert archived["status"] == "archived" and len(archived["revisions"]) == 1
    assert (await client.patch(f"/api/pm/projects/{project['id']}", headers=auth, json={"status": "archived"})).status_code == 200
    assert (await action(client, proposer, replacement_draft, "submit", change_summary="Change")).status_code == 409
    assert (await client.get(f"/api/pm/decisions/{row['id']}", headers=approver)).status_code == 200


async def test_notifications_do_not_fan_out_and_removed_approver_loses_access(client, auth, setup, monkeypatch):
    from app.core.config import settings
    import app.services.dispatch as dispatch
    calls = []
    monkeypatch.setattr(settings, "NOTIFY_OUTBOUND", True)
    monkeypatch.setattr(dispatch, "deliver_notification", lambda **kw: calls.append(kw))
    project, proposer, approver, outsider, content, row, issue = setup
    pending = await submitted(client, setup)
    assert calls == []
    assert (await client.delete(f"/api/pm/projects/{project['id']}/members/{content['approver_id']}", headers=auth)).status_code == 204
    assert (await action(client, approver, pending, "approval", revision_number=1, outcome="approved")).status_code == 404


async def test_assigned_platform_admin_must_retain_explicit_project_membership(client, auth, setup):
    project, proposer, approver, outsider, content, row, issue = setup
    admin, admin_id = await make_member(client, auth, "decision-admin@agholding.net", role="admin")
    assert (await client.post(f"/api/pm/projects/{project['id']}/members", headers=auth,
                              json={"user_id": admin_id, "role": "viewer"})).status_code == 201
    draft = (await client.patch(f"/api/pm/decisions/{row['id']}", headers=proposer,
                                json={**content, "approver_id": admin_id, "version": row["version"]})).json()
    pending = (await action(client, proposer, draft, "submit", change_summary="Administrative review")).json()
    assert pending["status"] == "pending_approval"
    assert (await client.get(f"/api/pm/decisions/{row['id']}", headers=admin)).json()["can_decide"]
    assert (await client.delete(f"/api/pm/projects/{project['id']}/members/{admin_id}", headers=auth)).status_code == 204
    assert not (await client.get(f"/api/pm/decisions/{row['id']}", headers=admin)).json()["can_decide"]
    assert (await action(client, admin, pending, "approval", revision_number=1, outcome="approved")).status_code == 403


async def test_missing_owner_requires_reassignment_before_submission(client, auth, setup):
    from app.core.database import AsyncSessionLocal
    from app.models.pm_decision import PmDecision

    project, proposer, approver, outsider, content, row, issue = setup
    # Ownership is nullable so retained records can outlive their source user.
    async with AsyncSessionLocal() as db:
        saved = await db.get(PmDecision, uuid.UUID(row["id"]))
        saved.owner_id = None
        await db.commit()
    response = await action(client, auth, row, "submit", change_summary="Submit retained draft")
    assert response.status_code == 422
    assert "owner" in response.json()["detail"].lower()
    unchanged = (await client.get(f"/api/pm/decisions/{row['id']}", headers=auth)).json()
    assert unchanged["status"] == "draft" and unchanged["version"] == row["version"]
    assert unchanged["revisions"] == []


async def test_approved_issue_tracking_does_not_change_approval_or_snapshots(client, setup):
    project, proposer, approver, outsider, content, row, issue = setup
    approved = (await action(client, approver, await submitted(client, setup), "approval", revision_number=1, outcome="approved")).json()
    extra = (await client.post(f"/api/pm/projects/{project['id']}/issues", headers=proposer,
                               json={"summary": "Implement approved policy", "issue_type": "task"})).json()
    linked = await action(client, proposer, approved, "issues", issue_id=extra["id"], relationship="implements")
    assert linked.status_code == 200, linked.text
    linked = linked.json()
    assert linked["status"] == "approved" and linked["approved_at"] == approved["approved_at"]
    assert linked["approved_revision_number"] == linked["revision_number"] == 1
    assert linked["revisions"] == approved["revisions"] and linked["version"] == approved["version"] + 1
    added = next(i for i in linked["issues"] if i["id"] == extra["id"])
    assert added["relationship"] == "implements" and added["added_by_id"] == content["owner_id"]
    assert added["added_by_name"] and added["added_at"]
    assert linked["events"][-1]["action"] == "issue_linked"
    assert (await client.get(f"/api/pm/issues/{extra['id']}/decisions", headers=approver)).json()[0]["id"] == row["id"]
    result = (await client.get(f"/api/pm/projects/{project['id']}/decisions", headers=approver, params={"q": extra["key"]})).json()
    assert result["total"] == 1
    changed = (await action(client, proposer, linked, "issues", issue_id=extra["id"], relationship="affects")).json()
    changed_link = next(i for i in changed["issues"] if i["id"] == extra["id"])
    assert changed_link == {**added, "relationship": "affects"}
    assert changed["events"][-1]["action"] == "issue_link_updated"
    repeated = (await action(client, proposer, changed, "issues", issue_id=extra["id"], relationship="affects")).json()
    assert repeated["version"] == changed["version"] and repeated["events"] == changed["events"]
    removed = await client.delete(f"/api/pm/decisions/{row['id']}/issues/{extra['id']}", headers=proposer, params={"version": changed["version"]})
    assert removed.status_code == 200, removed.text
    removed = removed.json()
    assert removed["status"] == "approved" and removed["revisions"] == approved["revisions"]
    assert removed["events"][-1]["action"] == "issue_unlinked"
    assert [i["id"] for i in removed["issues"]] == [issue["id"]]
    assert (await client.get(f"/api/pm/issues/{extra['id']}/decisions", headers=approver)).json() == []


async def test_issue_tracking_permissions_validation_and_stale_writes(client, auth, setup):
    project, proposer, approver, outsider, content, row, issue = setup
    base = f"/api/pm/decisions/{row['id']}/issues"
    for headers, status in ((approver, 403), (outsider, 404)):
        assert (await action(client, headers, row, "issues", issue_id=issue["id"])).status_code == status
        assert (await client.delete(f"{base}/{issue['id']}", headers=headers, params={"version": row["version"]})).status_code == status
    other = (await client.post("/api/pm/projects", headers=auth, json={"key": "OTHER", "name": "Other project"})).json()
    foreign = (await client.post(f"/api/pm/projects/{other['id']}/issues", headers=auth, json={"summary": "Private task", "issue_type": "task"})).json()
    for issue_id in (foreign["id"], str(uuid.uuid4())):
        assert (await action(client, proposer, row, "issues", issue_id=issue_id)).status_code == 422
    assert (await action(client, proposer, row, "issues", issue_id=issue["id"], relationship="unknown")).status_code == 422
    changed = (await action(client, proposer, row, "issues", issue_id=issue["id"], relationship="implements")).json()
    assert (await action(client, proposer, row, "issues", issue_id=issue["id"], relationship="affects")).status_code == 409
    assert (await client.delete(f"{base}/{issue['id']}", headers=proposer, params={"version": row["version"]})).status_code == 409
    assert (await client.delete(f"{base}/{issue['id']}", headers=proposer)).status_code == 422
    # Retained draft links keep their original actor/time and relationship.
    edited = (await client.patch(f"/api/pm/decisions/{row['id']}", headers=proposer, json={**content, "version": changed["version"]})).json()
    assert edited["issues"] == changed["issues"]
    assert (await client.patch(f"/api/pm/projects/{project['id']}", headers=auth, json={"status": "archived"})).status_code == 200
    assert (await action(client, proposer, edited, "issues", issue_id=issue["id"])).status_code == 409
    assert (await client.delete(f"{base}/{issue['id']}", headers=proposer, params={"version": edited["version"]})).status_code == 409


async def test_pending_issue_tracking_preserves_submission_and_archived_links_are_read_only(client, auth, setup):
    project, proposer, approver, outsider, content, row, issue = setup
    pending = await submitted(client, setup)
    removed = (await client.delete(f"/api/pm/decisions/{row['id']}/issues/{issue['id']}", headers=proposer, params={"version": pending["version"]})).json()
    assert removed["status"] == "pending_approval" and removed["issues"] == [] and removed["revisions"] == pending["revisions"]
    assert (await action(client, approver, pending, "approval", revision_number=1, outcome="approved")).status_code == 409
    approved = (await action(client, approver, removed, "approval", revision_number=1, outcome="approved")).json()
    archived = (await action(client, auth, approved, "archive", reason="Complete")).json()
    assert archived["can_manage_links"] is False
    assert (await action(client, proposer, archived, "issues", issue_id=issue["id"])).status_code == 409
    assert (await client.delete(f"/api/pm/decisions/{row['id']}/issues/{issue['id']}", headers=proposer, params={"version": archived["version"]})).status_code == 409

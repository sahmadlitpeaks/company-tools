"""Regression tests for the access-control fixes.

Each of these reproduces a loophole that was exploitable on master and asserts
it is now closed:

* a member could read/modify/delete another member's tasks;
* a member could download another user's entity attachments;
* a manager silently held the HR module (salaries, payslips, HR documents).
"""
import io

import pytest

from helpers import make_member

pytestmark = pytest.mark.asyncio


async def test_member_cannot_touch_another_members_task(client, auth):
    ha, _ = await make_member(client, auth, email="alice@agholding.net")
    hb, _ = await make_member(client, auth, email="bob@agholding.net")

    tid = (
        await client.post("/api/tasks", headers=ha, json={"title": "Alice private"})
    ).json()["id"]

    # Bob is neither creator nor assignee — every access path must be refused.
    assert (await client.get(f"/api/tasks/{tid}", headers=hb)).status_code == 403
    assert (
        await client.patch(f"/api/tasks/{tid}", headers=hb, json={"title": "hijack"})
    ).status_code == 403
    assert (await client.delete(f"/api/tasks/{tid}", headers=hb)).status_code == 403

    # Alice still owns it, intact.
    got = await client.get(f"/api/tasks/{tid}", headers=ha)
    assert got.status_code == 200 and got.json()["title"] == "Alice private"


async def test_member_cannot_download_another_users_attachment(client, auth):
    ha, _ = await make_member(client, auth, email="carol@agholding.net")
    hb, _ = await make_member(client, auth, email="dave@agholding.net")

    tid = (
        await client.post("/api/tasks", headers=ha, json={"title": "Carol task"})
    ).json()["id"]
    up = await client.post(
        f"/api/attachments/by/task/{tid}",
        headers=ha,
        files={"file": ("note.txt", io.BytesIO(b"secret"), "text/plain")},
    )
    assert up.status_code == 201
    att_id = up.json()["id"]

    # Dave holds the `tasks` module but is unrelated to this task.
    assert (
        await client.get(f"/api/attachments/by/task/{tid}", headers=hb)
    ).status_code == 403
    assert (
        await client.get(f"/api/attachments/{att_id}/download", headers=hb)
    ).status_code == 403
    # The owner can still read it.
    assert (
        await client.get(f"/api/attachments/{att_id}/download", headers=ha)
    ).status_code == 200


async def test_manager_does_not_get_hr_by_default(client, auth):
    hm, _ = await make_member(
        client, auth, email="mgr@agholding.net", role="manager"
    )
    me = (await client.get("/api/auth/me", headers=hm)).json()
    perms = me.get("effective_permissions") or []
    for mod in ("hr", "recruiting", "people_ops"):
        assert mod not in perms, f"manager should not hold {mod} by default"
    # And the HR endpoints refuse them.
    assert (await client.get("/api/payroll/runs", headers=hm)).status_code == 403
    # A non-HR manager surface still works.
    assert (await client.get("/api/tasks", headers=hm)).status_code == 200

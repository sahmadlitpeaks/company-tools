"""Role/assignment isolation even when Microsoft grants every account every file."""
import time
import uuid
from datetime import date
import pytest
import pytest_asyncio
from sqlalchemy import delete
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.department import Department
from app.models.user import User
from app.models.sharepoint import SharePointConnection, SharePointDocument, SharePointComplianceTask, SharePointReminder
from app.services.sharepoint import graph, chat
from app.services.sharepoint.common import encrypt, SharePointError
from app.services.sharepoint.store import authorize_document, set_cached_authorization, source_for
from helpers import make_member
from test_sharepoint import configured, indexed, metadata, TENANT, CLIENT, OID

@pytest_asyncio.fixture
async def teams(client,auth,indexed,monkeypatch):
    people={}
    for key,role in [("employee","member"),("peer","member"),("other","member"),("manager","manager")]:
        people[key]=await make_member(client,auth,"scope-"+key+"@example.com",role=role)
    async with AsyncSessionLocal() as db:
        finance,marketing=Department(name="Scope Finance"),Department(name="Scope Marketing")
        db.add_all([finance,marketing]); await db.flush()
        for key,(_,uid) in people.items():
            person=await db.get(User,uuid.UUID(uid))
            person.department_id=marketing.id if key=="other" else finance.id
            person.extra_permissions=["sharepoint_intelligence", "tasks"]
            db.add(SharePointConnection(user_id=person.id,tenant_id=TENANT,client_id=CLIENT,object_id=OID,
                token_cipher=encrypt({"access_token":"fake","refresh_token":"fake","expires_at":time.time()+3600})))
        first=await db.get(SharePointDocument,indexed[2])
        first.filename,first.path="Finance assigned.txt","/Scope Finance/Finance assigned.txt"
        docs={"employee":first}
        for key,folder in [("peer","Scope Finance"),("other","Scope Marketing"),
                           ("review","Scope Finance"),("other_review","Scope Marketing")]:
            doc=SharePointDocument(source_id=indexed[1],item_id=key,parent_id="folder",in_scope=True,
                version="v1",filename=key+".txt",path="/"+folder+"/"+key+".txt",status="ready",
                compliance_status="needs_review" if "review" in key else "active")
            db.add(doc); await db.flush(); docs[key]=doc
        tasks={}
        for key in ["employee","peer","other"]:
            task=SharePointComplianceTask(source_id=indexed[1],document_id=docs[key].id,action_key=key,
                title=key+" action",due_date=date(2027,1,20),basis="expiry",status="active",
                assignment_source="manual",owner_user_id=uuid.UUID(people[key][1]))
            db.add(task); await db.flush(); tasks[key]=str(task.id)
        ids={key:str(doc.id) for key,doc in docs.items()}
        await db.commit()
    calls=[]
    async def permitted(self,drive,item):
        calls.append(item)
        return metadata(item,name="Finance assigned.txt" if item=="one" else item+".txt")
    monkeypatch.setattr(graph.GraphClient,"can_read",permitted)
    monkeypatch.setattr(chat,"resolve_openai_credentials",lambda:("","offline"))
    return people,ids,tasks,calls

@pytest.mark.asyncio
@pytest.mark.parametrize("role,expected",[
    ("employee",{"employee"}),("peer",{"peer"}),("other",{"other"}),
    ("manager",{"employee","peer","review"}),("admin",{"employee","peer","other","review","other_review"})])
async def test_library_and_dashboard_are_assignment_scoped(client,auth,teams,role,expected):
    people,ids,_,calls=teams
    headers=auth if role=="admin" else people[role][0]
    response=await client.post("/api/sharepoint/search",headers=headers,json={})
    assert response.status_code==200,response.text
    assert {item["id"] for item in response.json()["items"]}=={ids[key] for key in expected}
    assert len(calls)==len(expected)
    dashboard=await client.get("/api/sharepoint/compliance/dashboard",headers=headers)
    if role not in {"manager","admin"}:
        assert dashboard.status_code==403 and dashboard.json()["detail"]=="manager_required"
    else:
        assert dashboard.status_code==200
        assert {doc["id"] for doc in dashboard.json()["documents"]}=={ids[key] for key in expected}

@pytest.mark.asyncio
async def test_off_scope_deep_links_and_assistant_cannot_read_other_team(client,auth,teams):
    people,ids,_,calls=teams
    headers=people["employee"][0]
    calls.clear()
    for path in [f"/api/sharepoint/documents/{ids['other']}",
                 f"/api/sharepoint/documents/{ids['peer']}/reminders",
                 f"/api/sharepoint/compliance/documents/{ids['other']}/history"]:
        assert (await client.get(path,headers=headers)).status_code==404
    assert (await client.post(f"/api/sharepoint/documents/{ids['other']}/chat",headers=headers,
        json={"messages":[{"role":"user","content":"Read this file"}]})).status_code==404
    assert calls==[]
    reply=await client.post("/api/sharepoint/chat",headers=headers,json={
        "messages":[{"role":"user","content":"Summarize all documents"}]})
    assert reply.status_code==200,reply.text
    assert {cite["document_id"] for cite in reply.json()["citations"]} <= {ids["employee"]}
    assert "other.txt" not in reply.text and "peer.txt" not in reply.text

@pytest.mark.asyncio
async def test_missing_microsoft_connection_never_falls_back_to_index(client,auth,teams):
    people,_,_,calls=teams
    headers,uid=people["employee"]
    async with AsyncSessionLocal() as db:
        await db.execute(delete(SharePointConnection).where(SharePointConnection.user_id==uuid.UUID(uid)))
        await db.commit()
    calls.clear()
    result=await client.post("/api/sharepoint/chat",headers=headers,json={
        "messages":[{"role":"user","content":"Summarize all documents"}]})
    assert result.status_code==403 and result.json()["detail"]=="microsoft_connection_required"
    assert "Finance assigned" not in result.text and not calls

@pytest.mark.asyncio
async def test_transfer_revokes_old_owner_and_manager_even_with_cached_graph_access(client,auth,teams):
    people,ids,tasks,calls=teams
    # Prime the old Graph cache; workspace membership must always be rechecked.
    async with AsyncSessionLocal() as db:
        set_cached_authorization(uuid.UUID(people["employee"][1]),uuid.UUID(ids["employee"]),"v1",metadata())
        task=await db.get(SharePointComplianceTask,uuid.UUID(tasks["employee"]))
        task.owner_user_id=uuid.UUID(people["other"][1]); await db.commit()
    for role in ["employee","manager"]:
        denied=await client.get("/api/sharepoint/documents/"+ids["employee"],headers=people[role][0])
        assert denied.status_code==404
    assert (await client.get("/api/sharepoint/documents/"+ids["employee"],headers=people["other"][0])).status_code==200
    async with AsyncSessionLocal() as db:
        user=await db.get(User,uuid.UUID(people["employee"][1]))
        source=await source_for(db)
        document=await db.get(SharePointDocument,uuid.UUID(ids["employee"]))
        with pytest.raises(SharePointError,match="document_not_found"):
            await authorize_document(db,user,source,document,use_cache=True)

@pytest.mark.asyncio
async def test_sharepoint_denial_still_applies_to_assigned_owner_and_admin(client,auth,teams,monkeypatch):
    people,ids,_,_=teams
    async def denied(*args): raise SharePointError("document_access_denied",403)
    monkeypatch.setattr(graph.GraphClient,"can_read",denied)
    for headers in [auth,people["employee"][0]]:
        assert (await client.get("/api/sharepoint/documents/"+ids["employee"],headers=headers)).status_code==403
        assert (await client.post("/api/sharepoint/search",headers=headers,json={})).json()["items"]==[]


@pytest.mark.asyncio
async def test_explicit_manual_assignments_and_personal_reminders_are_scoped(client, auth, teams):
    people, ids, _, _ = teams
    reminders = {}
    async with AsyncSessionLocal() as db:
        document = await db.get(SharePointDocument, uuid.UUID(ids["other_review"]))
        for role in ["employee", "other"]:
            reminder = SharePointReminder(source_id=document.source_id, document_id=document.id,
                title=role + " private action", target_date="2027-01-20", reminder_date="2026-12-20",
                lead_days=30, recipient_email="scope-" + role + "@example.com", dedup_key=role)
            db.add(reminder)
            await db.flush()
            reminders[role] = str(reminder.id)
        await db.commit()
    headers = people["employee"][0]
    library = await client.post("/api/sharepoint/search", headers=headers, json={})
    assert {item["id"] for item in library.json()["items"]} == {ids["employee"], ids["other_review"]}
    for path in ["/api/sharepoint/reminders", "/api/sharepoint/documents/" + ids["other_review"] + "/reminders"]:
        response = await client.get(path, headers=headers)
        assert response.status_code == 200, response.text
        assert {item["id"] for item in response.json()} == {reminders["employee"]}
    # Knowing an unrelated reminder ID must not allow changing someone else's work.
    for action in ["dismiss", "complete", "reopen"]:
        assert (await client.post("/api/sharepoint/reminders/" + reminders["other"] + "/" + action,
            headers=headers)).status_code == 404
    assert (await client.patch("/api/sharepoint/reminders/" + reminders["other"],
        headers=headers, json={"notes": "Access denied"})).status_code == 404


@pytest.mark.asyncio
async def test_group_inbox_is_manager_only_with_member_fallback_when_no_lead(client, auth, teams):
    people, ids, tasks, _ = teams
    async with AsyncSessionLocal() as db:
        employee = await db.get(User, uuid.UUID(people["employee"][1]))
        task = await db.get(SharePointComplianceTask, uuid.UUID(tasks["employee"]))
        task.owner_user_id = None
        task.owner_department_id = employee.department_id
        await db.commit()
    for role, expected in [("employee", set()), ("peer", {ids["peer"]}),
                           ("manager", {ids["employee"], ids["peer"], ids["review"]})]:
        result = await client.post("/api/sharepoint/search", headers=people[role][0], json={})
        assert result.status_code == 200, result.text
        assert {item["id"] for item in result.json()["items"]} == expected
    async with AsyncSessionLocal() as db:
        manager = await db.get(User, uuid.UUID(people["manager"][1]))
        manager.is_active = False
        await db.commit()
    for role, expected in [("employee", {ids["employee"]}), ("peer", {ids["employee"], ids["peer"]})]:
        result = await client.post("/api/sharepoint/search", headers=people[role][0], json={})
        assert {item["id"] for item in result.json()["items"]} == expected


@pytest.mark.asyncio
async def test_current_membership_and_reports_define_manager_scope(client, auth, teams):
    people, ids, _, _ = teams
    async with AsyncSessionLocal() as db:
        employee = await db.get(User, uuid.UUID(people["employee"][1]))
        other = await db.get(User, uuid.UUID(people["other"][1]))
        employee.department_id = other.department_id
        await db.commit()
    result = await client.post("/api/sharepoint/search", headers=people["manager"][0], json={})
    assert {item["id"] for item in result.json()["items"]} == {ids["peer"], ids["review"]}
    async with AsyncSessionLocal() as db:
        other = await db.get(User, uuid.UUID(people["other"][1]))
        other.manager_id = uuid.UUID(people["manager"][1])
        await db.commit()
    result = await client.post("/api/sharepoint/search", headers=people["manager"][0], json={})
    assert {item["id"] for item in result.json()["items"]} == {ids["peer"], ids["review"], ids["other"]}
    assert (await client.get("/api/sharepoint/documents/" + ids["other_review"],
        headers=people["manager"][0])).status_code == 404


@pytest.mark.asyncio
async def test_configured_reviewer_has_no_global_employee_or_task_visibility(client, auth, teams, monkeypatch):
    people, ids, tasks, _ = teams
    monkeypatch.setattr(settings, "SHAREPOINT_REVIEWER_IDS", people["employee"][1])
    headers = people["employee"][0]
    result = await client.post("/api/sharepoint/search", headers=headers, json={})
    assert {item["id"] for item in result.json()["items"]} == {ids["employee"]}
    board = await client.get("/api/tasks/compliance?preview=true", headers=headers)
    assert board.status_code == 200, board.text
    assert {task["id"] for task in board.json()["tasks"]} == {tasks["employee"]}
    assert (await client.get("/api/sharepoint/compliance/dashboard", headers=headers)).status_code == 403

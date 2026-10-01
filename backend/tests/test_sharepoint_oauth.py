"""Exercise real Authlib state, nonce, PKCE and signed identity through the HTTP callback."""
import base64
import hashlib
import time
import uuid
from urllib.parse import parse_qs, urlparse
import httpx
import pytest
from joserfc import jwt
from joserfc.jwk import RSAKey
from app.api import sharepoint
from app.core.database import AsyncSessionLocal
from app.models.user import User
from app.models.sharepoint import SharePointConnection
from app.services.sharepoint import graph
from app.services.sharepoint.common import decrypt
from helpers import make_member
from test_sharepoint import configured, indexed, TENANT, CLIENT, OID, metadata

@pytest.fixture
def microsoft(configured, monkeypatch):
    key = RSAKey.generate_key(2048)
    public = key.as_dict(private=False)
    public.update(kid="test-key", use="sig", alg="RS256")
    state = {"nonce": None, "challenge": None, "fail": False, "tenant": TENANT, "oid": OID, "exchanges": 0, "refresh": True}
    issuer = f"https://login.microsoftonline.com/{TENANT}/v2.0"
    def respond(request):
        path = request.url.path
        if path.endswith("openid-configuration"):
            return httpx.Response(200, json={"issuer": issuer,
                "authorization_endpoint": f"https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/authorize",
                "token_endpoint": f"https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token",
                "jwks_uri": f"https://login.microsoftonline.com/{TENANT}/discovery/v2.0/keys",
                "id_token_signing_alg_values_supported": ["RS256"]})
        if path.endswith("/keys"):
            return httpx.Response(200, json={"keys": [public]})
        if path.endswith("/token"):
            state["exchanges"] += 1
            data = parse_qs(request.content.decode())
            verifier = data["code_verifier"][0]
            challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
            assert challenge == state["challenge"]
            if state["fail"]:
                return httpx.Response(400, json={"error":"invalid_grant","error_description":"private provider data"})
            claims = {"iss": issuer, "aud": CLIENT, "sub": state["oid"], "oid": state["oid"],
                "tid": state["tenant"], "nonce": state["nonce"], "iat": int(time.time()), "exp": int(time.time())+3600}
            signed = jwt.encode({"alg":"RS256","kid":"test-key"}, claims, key)
            token = {"access_token":"private-access", "expires_in":3600,"token_type":"Bearer","id_token":signed}
            if state["refresh"]: token["refresh_token"] = "private-refresh"
            return httpx.Response(200, json=token)
        raise AssertionError(f"Unexpected Microsoft path: {path}")
    oauth = graph.oauth_client()
    oauth.client_kwargs["transport"] = httpx.MockTransport(respond)
    monkeypatch.setattr(sharepoint, "oauth_client", lambda: oauth)
    return state

async def begin(client, headers, microsoft, return_to="/tasks"):
    result = await client.get("/api/sharepoint/connect", params={"return_to":return_to}, headers=headers, follow_redirects=False)
    assert result.status_code == 302, result.text
    values = parse_qs(urlparse(result.headers["location"]).query)
    microsoft["nonce"], microsoft["challenge"] = values["nonce"][0], values["code_challenge"][0]
    return values["state"][0]

@pytest.mark.asyncio
async def test_local_employee_connects_when_identity_already_has_sso_profile(client,auth,indexed,microsoft,monkeypatch):
    headers, uid = await make_member(client,auth,"sharepoint.local@example.com")
    async with AsyncSessionLocal() as db:
        employee = await db.get(User,uuid.UUID(uid))
        employee.extra_permissions = ["sharepoint_intelligence"]
        await db.commit()
    from app.models.sharepoint import SharePointDocument, SharePointComplianceTask
    from app.services.sharepoint.compliance import apply_analysis
    async def permitted(*args): return metadata()
    monkeypatch.setattr(graph.GraphClient, "can_read", permitted)
    async with AsyncSessionLocal() as db:
        document = await db.get(SharePointDocument,indexed[2])
        plans = await apply_analysis(db,document,{"sections":[{"compliance":{
            "document_type":"trade_license","company":{"value":"Private Vendor"},
            "expiry_date":{"value":"2027-01-20"}}}]}, override_owner_user_id=uuid.UUID(uid))
        tid = str(plans[0][0].id)
        await db.commit()
    before = await client.get("/api/tasks/compliance",headers=headers)
    assert before.json()["tasks"][0]["access_state"] == "microsoft_connection_required"
    assert "Private Vendor" not in before.text
    state = await begin(client,headers,microsoft, f"/tasks?task={tid}")
    result = await client.get("/api/sharepoint/callback", params={"code":"test-code","state":state},headers=headers,follow_redirects=False)
    assert result.status_code == 303, result.text
    assert result.headers["location"] == f"/tasks?task={tid}&connected=1"
    async with AsyncSessionLocal() as db:
        employee = await db.get(User,uuid.UUID(uid))
        assert employee.azure_oid is None
        assert (await db.get(User,indexed[0])).azure_oid == OID
        connection = await db.get(SharePointConnection,employee.id)
        assert connection.object_id == OID and decrypt(connection.token_cipher)["access_token"]=="private-access"
    assert (await client.get("/api/sharepoint/status",headers=headers)).json()["connected"]

    after = await client.get("/api/tasks/compliance",headers=headers)
    task = after.json()["tasks"][0]
    assert task["access_state"] == "ready" and task["can_change_status"]
    assert "Private Vendor" in after.text
    result = await client.patch(f"/api/sharepoint/compliance/tasks/{tid}",headers=headers,
        json={"status":"active","work_status":"in_progress"})
    assert result.status_code == 200, result.text
    admin = await client.get("/api/tasks/compliance",headers=auth)
    assert admin.json()["tasks"][0]["status"] == "in_progress"
    async with AsyncSessionLocal() as db:
        assert (await db.get(SharePointComplianceTask,uuid.UUID(tid))).work_status == "in_progress"

@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["tenant","identity","nonce","refresh","exchange","save"])
async def test_callback_failure_recovers_without_overwriting_connection(client,auth,indexed,microsoft,monkeypatch,failure,caplog):
    state = await begin(client,auth,microsoft)
    if failure == "tenant": microsoft["tenant"] = str(uuid.uuid4())
    if failure == "identity": microsoft["oid"] = str(uuid.uuid4())
    if failure == "nonce": microsoft["nonce"] = "wrong-nonce"
    if failure == "refresh": microsoft["refresh"] = False
    if failure == "exchange": microsoft["fail"] = True
    if failure == "save":
        def broken(*args): raise ValueError("private-access private-refresh test-code private SQL")
        monkeypatch.setattr(sharepoint,"encrypt",broken)
    result = await client.get("/api/sharepoint/callback",params={"code":"test-code","state":state},
        headers=auth,follow_redirects=False)
    assert result.status_code == 303
    error = "microsoft_account_mismatch" if failure in {"tenant","identity"} else "microsoft_consent_required" if failure=="refresh" else "microsoft_connection_save_failed" if failure=="save" else "microsoft_connection_failed"
    assert result.headers["location"] == "/tasks?microsoft_error=" + error
    assert "no-store" in result.headers["cache-control"]
    assert result.headers["referrer-policy"] == "no-referrer"
    assert not any(secret in result.text + caplog.text for secret in ["private-access","private-refresh","test-code","private SQL","private provider data"])
    async with AsyncSessionLocal() as db:
        connection = await db.get(SharePointConnection,indexed[0])
        assert decrypt(connection.token_cipher)["access_token"] == "delegated-token"
        assert connection.object_id == OID

@pytest.mark.asyncio
async def test_cancellation_and_replay_return_to_recovery(client,auth,indexed,microsoft):
    state = await begin(client,auth,microsoft)
    cancelled = await client.get("/api/sharepoint/callback",params={"error":"access_denied","state":state},
        headers=auth,follow_redirects=False)
    assert cancelled.status_code == 303 and cancelled.headers["location"] == "/tasks?microsoft_error=microsoft_connection_failed"
    assert microsoft["exchanges"] == 0
    replay = await client.get("/api/sharepoint/callback",params={"code":"test-code","state":state},
        headers=auth,follow_redirects=False)
    assert replay.status_code == 303 and "microsoft_connection_state_invalid" in replay.headers["location"]
    assert microsoft["exchanges"] == 0

@pytest.mark.asyncio
async def test_state_mismatch_does_not_exchange_code(client,auth,indexed,microsoft):
    await begin(client,auth,microsoft)
    result = await client.get("/api/sharepoint/callback",params={"code":"test-code","state":"wrong-state"},
        headers=auth,follow_redirects=False)
    assert result.status_code == 303 and "microsoft_connection_failed" in result.headers["location"]
    assert microsoft["exchanges"] == 0

@pytest.mark.parametrize("target,expected", [
    ("/tasks?task=44444444-4444-4444-8444-444444444444&code=secret","/tasks?task=44444444-4444-4444-8444-444444444444"),
    ("/tasks?task=invalid&token=secret","/tasks"),
    ("/sharepoint/compliance?code=secret","/sharepoint/compliance"),
    ("https://evil.example/tasks","/sharepoint"),("//evil.example/tasks","/sharepoint"),
    ("/tasks/../admin","/sharepoint"),("/unknown","/sharepoint"),(None,"/sharepoint"),
])
def test_return_destination_is_local_and_strips_secrets(target,expected):
    assert sharepoint.connection_return(target) == expected

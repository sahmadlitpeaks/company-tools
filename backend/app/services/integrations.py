"""Outbound HR integrations: provision a user in Azure Entra ID and push an
employee to BambooHR. Both are best-effort and only run when configured — the
calling endpoints surface a clear 'not configured' message otherwise.

These make live HTTP calls; they need valid credentials and outbound network
access to actually succeed.
"""
import secrets

import httpx

from app.auth.azure import GRAPH_BASE, get_app_token
from app.models.user import User


def _temp_password() -> str:
    return "Ag!" + secrets.token_urlsafe(12)


async def provision_azure_user(cfg: dict, user: User) -> dict:
    """Create the user in Azure Entra ID via Microsoft Graph. Returns
    {ok, azure_oid?, temp_password?, error?}."""
    if not cfg.get("configured"):
        return {"ok": False, "error": "Azure is not configured"}
    if not user.email:
        return {"ok": False, "error": "An official email is required for Azure"}
    try:
        token = await get_app_token(
            cfg["tenant_id"], cfg["client_id"], cfg["client_secret"]
        )
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"Azure auth failed: {str(e)[:200]}"}

    pwd = _temp_password()
    body = {
        "accountEnabled": True,
        "displayName": user.display_name or user.email,
        "givenName": user.given_name,
        "surname": user.surname,
        "mailNickname": user.email.split("@")[0],
        "userPrincipalName": user.email,
        "jobTitle": user.job_title,
        "department": user.department,
        "passwordProfile": {
            "forceChangePasswordNextSignIn": True,
            "password": pwd,
        },
    }
    body = {k: v for k, v in body.items() if v is not None}
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(
                f"{GRAPH_BASE}/users",
                headers={"Authorization": f"Bearer {token}"},
                json=body,
            )
        if resp.status_code in (200, 201):
            return {"ok": True, "azure_oid": resp.json().get("id"), "temp_password": pwd}
        return {"ok": False, "error": f"Graph {resp.status_code}: {resp.text[:200]}"}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)[:200]}


async def push_bamboo_employee(cfg: dict, user: User) -> dict:
    """Create the employee in BambooHR. Returns {ok, bamboo_id?, error?}."""
    if not cfg.get("configured"):
        return {"ok": False, "error": "BambooHR is not configured"}
    url = (
        f"https://api.bamboohr.com/api/gateway.php/{cfg['subdomain']}/v1/employees/"
    )
    payload = {
        "firstName": user.given_name or (user.display_name or "").split(" ")[0] or "New",
        "lastName": user.surname or (user.display_name or " ").split(" ")[-1] or "Joiner",
        "workEmail": user.email or "",
        "homeEmail": user.personal_email or "",
        "jobTitle": user.job_title or "",
        "department": user.department or "",
    }
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(
                url,
                json=payload,
                auth=(cfg["api_key"], "x"),
                headers={"Accept": "application/json"},
            )
        if resp.status_code in (200, 201):
            # BambooHR returns the new id in the Location header.
            loc = resp.headers.get("Location", "")
            bamboo_id = loc.rstrip("/").split("/")[-1] if loc else None
            return {"ok": True, "bamboo_id": bamboo_id}
        return {"ok": False, "error": f"BambooHR {resp.status_code}: {resp.text[:200]}"}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)[:200]}

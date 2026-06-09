"""Shared test helpers for the password-based auth flow (no more dev-login)."""

MEMBER_PW = "Password123!"


async def make_member(
    client,
    auth,
    email="mo@agholding.net",
    *,
    role="member",
    status="active",
    password=MEMBER_PW,
):
    """Create (or update) a user via the admin API with a password, then log in.

    Returns ``(headers, user_id)`` — a drop-in for the old dev-login helper.
    """
    users = (await client.get("/api/users", headers=auth)).json()
    existing = next((u for u in users if u["email"] == email), None)
    if existing:
        uid = existing["id"]
        await client.post(
            f"/api/users/{uid}/set-password", headers=auth, json={"password": password}
        )
        await client.patch(
            f"/api/users/{uid}", headers=auth, json={"status": status, "role": role}
        )
    else:
        r = await client.post(
            "/api/users",
            headers=auth,
            json={
                "email": email,
                "display_name": email.split("@")[0],
                "password": password,
                "role": role,
                "status": status,
            },
        )
        uid = r.json()["id"]
    token = (
        await client.post("/api/auth/login", json={"email": email, "password": password})
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}, uid

"""Shared test helpers for the password-based auth flow (no more dev-login)."""

MEMBER_PW = "Password123!"


async def clear_forced_password_change(email: str) -> None:
    """Mark ``email`` as having already done its first-login password change.

    Any account handed a password by an admin owes a change, and the API refuses
    everything except the change itself until it happens. Tests covering other
    endpoints aren't exercising that gate, so lift it directly rather than
    burning a PBKDF2 round-trip per fixture. The password is left untouched.
    """
    from sqlalchemy import func, select

    from app.core.database import AsyncSessionLocal
    from app.models.user import User

    async with AsyncSessionLocal() as db:
        user = (
            await db.execute(select(User).where(func.lower(User.email) == email.lower()))
        ).scalar_one()
        user.must_change_password = False
        await db.commit()


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
    await clear_forced_password_change(email)
    token = (
        await client.post("/api/auth/login", json={"email": email, "password": password})
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}, uid

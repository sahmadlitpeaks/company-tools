import uuid

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import decode_access_token
from app.models.user import User

bearer = HTTPBearer(auto_error=False)

# Reachable while an account still owes a password change: the endpoints the
# change itself needs, plus the ones the SPA calls to render that screen.
_PASSWORD_CHANGE_EXEMPT = {
    "/api/auth/change-password",
    "/api/auth/me",
    "/api/auth/config",
}


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    token = (
        credentials.credentials
        if credentials is not None
        else request.cookies.get("ag_platform_session")
    )
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )
    payload = decode_access_token(token)
    if not payload or "sub" not in payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        )
    try:
        user_id = uuid.UUID(payload["sub"])
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid subject"
        )
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found"
        )
    if not user.is_active or user.status == "disabled":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account has been disabled. Contact an administrator.",
        )
    if user.status == "pending":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account is awaiting administrator approval.",
        )
    # A temporary password travels by email, so the change can't be enforced in
    # the browser alone — refuse the rest of the API until it has been done.
    if user.must_change_password and request.url.path not in _PASSWORD_CHANGE_EXEMPT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You must change your password before continuing.",
            headers={"X-Password-Change-Required": "1"},
        )
    return user


async def get_current_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Admin privileges required"
        )
    return user


async def get_current_manager(user: User = Depends(get_current_user)) -> User:
    """Admins or brand managers (anyone who can manage some content)."""
    if not (user.is_admin or user.role == "manager"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Manager privileges required"
        )
    return user


def can_manage_company(user: User, company_id: uuid.UUID | None) -> bool:
    """Admins manage everything; managers only their assigned brands."""
    if user.is_admin:
        return True
    if user.role != "manager" or company_id is None:
        return False
    return company_id in set(user.managed_company_ids)

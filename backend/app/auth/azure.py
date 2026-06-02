"""Azure Entra ID (Azure AD) OIDC client + Microsoft Graph helpers."""
import httpx
from authlib.integrations.starlette_client import OAuth

from app.core.config import settings

GRAPH_BASE = "https://graph.microsoft.com/v1.0"

oauth = OAuth()
oauth.register(
    name="azure",
    server_metadata_url=settings.azure_discovery_url,
    client_id=settings.AZURE_CLIENT_ID,
    client_secret=settings.AZURE_CLIENT_SECRET,
    client_kwargs={
        "scope": "openid profile email User.Read",
    },
)


async def fetch_graph_me(access_token: str) -> dict:
    """Fetch the signed-in user's profile from Microsoft Graph."""
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{GRAPH_BASE}/me",
            headers={"Authorization": f"Bearer {access_token}"},
            params={
                "$select": (
                    "id,displayName,givenName,surname,mail,userPrincipalName,"
                    "jobTitle,department,officeLocation,mobilePhone,businessPhones"
                )
            },
        )
        resp.raise_for_status()
        return resp.json()


async def fetch_graph_users(access_token: str) -> list[dict]:
    """Fetch all users in the directory (feature #1 — requires User.Read.All).

    Uses an application token (client-credentials). Pages through results.
    """
    users: list[dict] = []
    url = (
        f"{GRAPH_BASE}/users?$select=id,displayName,givenName,surname,mail,"
        "userPrincipalName,jobTitle,department,officeLocation,mobilePhone,"
        "businessPhones&$top=100"
    )
    async with httpx.AsyncClient(timeout=30) as client:
        while url:
            resp = await client.get(
                url, headers={"Authorization": f"Bearer {access_token}"}
            )
            resp.raise_for_status()
            data = resp.json()
            users.extend(data.get("value", []))
            url = data.get("@odata.nextLink")
    return users


async def get_app_token() -> str:
    """Client-credentials token for app-only Graph calls (directory sync)."""
    token_url = f"{settings.azure_authority}/oauth2/v2.0/token"
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            token_url,
            data={
                "client_id": settings.AZURE_CLIENT_ID,
                "client_secret": settings.AZURE_CLIENT_SECRET,
                "scope": "https://graph.microsoft.com/.default",
                "grant_type": "client_credentials",
            },
        )
        resp.raise_for_status()
        return resp.json()["access_token"]

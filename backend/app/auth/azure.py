"""Azure Entra ID (Azure AD) OIDC client + Microsoft Graph helpers.

The OAuth client is built dynamically from the effective Azure config (admin
DB settings, falling back to environment), so connecting Azure is a UI task —
no code or environment changes required.
"""
import httpx
from authlib.integrations.starlette_client import OAuth

GRAPH_BASE = "https://graph.microsoft.com/v1.0"


def build_oauth(tenant_id: str, client_id: str, client_secret: str) -> OAuth:
    """Construct a one-off Authlib registry for the given Azure credentials."""
    oauth = OAuth()
    oauth.register(
        name="azure",
        server_metadata_url=(
            f"https://login.microsoftonline.com/{tenant_id}"
            "/v2.0/.well-known/openid-configuration"
        ),
        client_id=client_id,
        client_secret=client_secret,
        client_kwargs={"scope": "openid profile email User.Read"},
    )
    return oauth


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
    """Fetch all users in the directory (feature #1 — requires User.Read.All)."""
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


async def get_app_token(tenant_id: str, client_id: str, client_secret: str) -> str:
    """Client-credentials token for app-only Graph calls (directory sync)."""
    token_url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            token_url,
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "scope": "https://graph.microsoft.com/.default",
                "grant_type": "client_credentials",
            },
        )
        resp.raise_for_status()
        return resp.json()["access_token"]

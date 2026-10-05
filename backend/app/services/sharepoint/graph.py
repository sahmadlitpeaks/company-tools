"""A read-only Graph client. Token exchange is the only outbound POST here."""
import asyncio
import time
from urllib.parse import quote, urlparse

import httpx
from authlib.integrations.starlette_client import OAuth
from sqlalchemy import select, update

from app.core.config import settings
from app.models.sharepoint import SharePointConnection
from app.services.sharepoint.common import SharePointError, decrypt, encrypt

GRAPH = "https://graph.microsoft.com/v1.0"


def item_path(drive: str, item: str) -> str:
    return f"/drives/{quote(drive, safe='')}/items/{quote(item, safe='')}"


def graph_url(path):
    if not isinstance(path, str):
        raise SharePointError("invalid_graph_continuation", 502)
    url = path if path.startswith("https://") else GRAPH + path
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.netloc != "graph.microsoft.com" or not parsed.path.startswith("/v1.0/") or parsed.fragment:
        raise SharePointError("invalid_graph_continuation", 502)
    return url


def safe_file_url(url):
    try:
        parsed = urlparse(url)
        return (parsed.scheme == "https" and parsed.port in (None, 443) and not parsed.username
                and bool(parsed.hostname) and parsed.hostname.endswith((".sharepoint.com", ".1drv.com")))
    except (ValueError, TypeError):
        return False


def oauth_client():
    registry = OAuth()
    registry.register(
        name="sharepoint",
        client_id=settings.SHAREPOINT_CLIENT_ID,
        client_secret=settings.SHAREPOINT_CLIENT_SECRET,
        server_metadata_url=f"https://login.microsoftonline.com/{settings.SHAREPOINT_TENANT_ID}/v2.0/.well-known/openid-configuration",
        client_kwargs={"scope": "openid profile offline_access https://graph.microsoft.com/Sites.Selected", "code_challenge_method": "S256"},
    )
    return registry.sharepoint


async def exchange(data):
    url = f"https://login.microsoftonline.com/{settings.SHAREPOINT_TENANT_ID}/oauth2/v2.0/token"
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
            response = await client.post(url, data={
                "client_id": settings.SHAREPOINT_CLIENT_ID,
                "client_secret": settings.SHAREPOINT_CLIENT_SECRET, **data,
            })
        if response.status_code != 200:
            raise SharePointError("microsoft_connection_required", 403)
        token = response.json()
        if not isinstance(token.get("access_token"), str):
            raise SharePointError("invalid_microsoft_response", 502)
        token["expires_at"] = time.time() + int(token.get("expires_in", 3600))
        return token
    except (httpx.HTTPError, ValueError, TypeError):
        raise SharePointError("microsoft_unavailable", 503) from None


async def application_token():
    return (await exchange({"grant_type": "client_credentials", "scope": "https://graph.microsoft.com/.default"}))["access_token"]


async def delegated_token(db, user):
    connection = await db.get(SharePointConnection, user.id)
    if not connection or connection.tenant_id != settings.SHAREPOINT_TENANT_ID or connection.client_id != settings.SHAREPOINT_CLIENT_ID:
        raise SharePointError("microsoft_connection_required", 403)
    if not connection.object_id:
        raise SharePointError("microsoft_connection_required", 403)
    if user.azure_oid and connection.object_id.lower() != user.azure_oid.lower():
        raise SharePointError("microsoft_connection_required", 403)
    token = decrypt(connection.token_cipher)
    if token.get("expires_at", 0) <= time.time() + 60:
        if not token.get("refresh_token"):
            raise SharePointError("microsoft_connection_required", 403)
        refreshed = await exchange({"grant_type": "refresh_token", "refresh_token": token["refresh_token"], "scope": "openid profile offline_access https://graph.microsoft.com/Sites.Selected"})
        refreshed.setdefault("refresh_token", token["refresh_token"])
        result = await db.execute(update(SharePointConnection).where(
            SharePointConnection.user_id == user.id, SharePointConnection.version == connection.version,
        ).values(token_cipher=encrypt(refreshed), version=connection.version + 1))
        if not result.rowcount:
            # A disconnect/another refresh wins; never resurrect disconnected credentials.
            db.expire(connection)
            current = (await db.execute(select(SharePointConnection).where(SharePointConnection.user_id == user.id))).scalar_one_or_none()
            if not current:
                raise SharePointError("microsoft_connection_required", 403)
            token = decrypt(current.token_cipher)
        else:
            token = refreshed
    return token["access_token"]


class GraphClient:
    def __init__(self, token):
        self.token = token

    async def get(self, path, *, content=False, download=False):
        url = graph_url(path)
        for attempt in range(3):
            try:
                async with httpx.AsyncClient(timeout=30, follow_redirects=False) as client:
                    async with client.stream("GET", url, headers={"Authorization": f"Bearer {self.token}"}) as response:
                        code = response.status_code
                        if code == 401:
                            raise SharePointError("microsoft_connection_required", 403)
                        if code in (403, 404):
                            raise SharePointError("document_access_denied", 403)
                        if code == 410:
                            raise SharePointError("delta_expired", 410)
                        if code in (429, 503):
                            retry = response.headers.get("Retry-After", "2")
                            delay = int(retry) if retry.isdigit() else 2 ** (attempt + 1)
                            if attempt == 2 or delay > 15:
                                raise SharePointError("graph_throttled", 503)
                        elif code in (301, 302, 303, 307, 308) and content:
                            target = response.headers.get("location", "")
                            if not safe_file_url(target):
                                raise SharePointError("invalid_download_redirect", 502)
                            if not download:
                                return None
                            return await self.download(target)
                        elif code == 200:
                            if content and not download:
                                return None
                            data = await read_limited(response, settings.SHAREPOINT_MAX_FILE_BYTES if content else 8 * 1024 * 1024)
                            if content:
                                return data
                            import json
                            result = json.loads(data)
                            if not isinstance(result, dict):
                                raise ValueError()
                            return result
                        else:
                            raise SharePointError("graph_request_failed", 502)
                await asyncio.sleep(max(1, delay))
            except (httpx.HTTPError, ValueError, TypeError):
                raise SharePointError("graph_unavailable", 503) from None
        raise SharePointError("graph_unavailable")

    async def download(self, url):
        # New client, never forward the Graph authorization header to file hosts.
        async with httpx.AsyncClient(timeout=60, follow_redirects=False) as client:
            for _ in range(4):
                if not safe_file_url(url):
                    raise SharePointError("invalid_download_redirect", 502)
                async with client.stream("GET", url) as response:
                    if response.status_code in (301, 302, 303, 307, 308):
                        url = response.headers.get("location", "")
                        continue
                    if response.status_code != 200:
                        raise SharePointError("download_failed", 502)
                    return await read_limited(response, settings.SHAREPOINT_MAX_FILE_BYTES)
        raise SharePointError("download_redirect_limit", 502)

    async def item(self, drive, item):
        return await self.get(item_path(drive, item) + "?$select=id,name,eTag,parentReference,webUrl,file,folder,size,lastModifiedDateTime")

    async def can_read(self, drive, item):
        metadata = await self.item(drive, item)
        await self.get(item_path(drive, item) + "/content", content=True)
        current = await self.item(drive, item)
        if not current.get("eTag") or current["eTag"] != metadata.get("eTag"):
            raise SharePointError("document_changed_sync_required", 409)
        return current

    async def verify_source(self, source):
        link = f"/sites/{quote(source.site_id, safe='')}/drives?$select=id"
        visited = set()
        for _ in range(100):
            if link in visited:
                break
            visited.add(link)
            page = await self.get(link)
            if any(item.get("id") == source.drive_id for item in page.get("value", [])):
                folder = await self.item(source.drive_id, source.folder_id)
                if "folder" in folder:
                    return
                break
            link = page.get("@odata.nextLink")
            if not link:
                break
        raise SharePointError("invalid_source_scope", 422)


async def read_limited(response, maximum):
    length = response.headers.get("content-length")
    if length and int(length) > maximum:
        raise SharePointError("file_too_large", 422)
    data = bytearray()
    async for chunk in response.aiter_bytes():
        if len(data) + len(chunk) > maximum:
            raise SharePointError("file_too_large", 422)
        data.extend(chunk)
    return bytes(data)

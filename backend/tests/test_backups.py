import io
import zipfile

import pytest

from app.core.config import settings
from helpers import make_member
pytestmark=pytest.mark.asyncio
async def test_backups_are_admin_only(client,auth):
 member,_=await make_member(client,auth,"backup-member@agholding.net")
 assert (await client.get("/api/backups",headers=member)).status_code==403
 assert (await client.get("/api/backups/status",headers=member)).status_code==403
 assert (await client.get("/api/backups",headers=auth)).status_code==200
async def test_manual_backup_queues_once(client,auth,monkeypatch):
 async def fake(_):return None
 monkeypatch.setattr("app.api.backups.build_backup",fake)
 first=await client.post("/api/backups",headers=auth)
 assert first.status_code==202 and first.json()["status"]=="pending"
 second=await client.post("/api/backups",headers=auth)
 assert second.status_code==409


async def test_admin_can_import_valid_backup_archive(client, auth, tmp_path, monkeypatch):
 monkeypatch.setattr(settings,"BACKUP_ROOT",str(tmp_path))
 payload=io.BytesIO()
 with zipfile.ZipFile(payload,"w",zipfile.ZIP_DEFLATED) as archive:
  archive.writestr("database.dump",b"postgres dump")
  archive.writestr("media.tar.gz",b"media archive")
 response=await client.post(
  "/api/backups/import",
  headers=auth,
  files={"archive":("downloaded-backup.zip",payload.getvalue(),"application/zip")},
 )
 assert response.status_code==201
 body=response.json()
 assert body["status"]=="completed"
 assert body["source"]=="imported"
 assert body["checksum_sha256"]
 assert (tmp_path/body["filename"]).is_file()


async def test_backup_import_rejects_invalid_archive_and_member(client, auth, tmp_path, monkeypatch):
 monkeypatch.setattr(settings,"BACKUP_ROOT",str(tmp_path))
 member,_=await make_member(client,auth,"backup-import-member@agholding.net")
 invalid=await client.post(
  "/api/backups/import",
  headers=auth,
  files={"archive":("invalid.zip",b"not a zip","application/zip")},
 )
 assert invalid.status_code==422
 forbidden=await client.post(
  "/api/backups/import",
  headers=member,
  files={"archive":("invalid.zip",b"not a zip","application/zip")},
 )
 assert forbidden.status_code==403

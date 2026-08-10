import asyncio
import hashlib
import os
import tarfile
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.operations import BackupRecord


def _archive_media(target: Path) -> None:
    media = Path(settings.MEDIA_ROOT)
    with tarfile.open(target, "w:gz") as archive:
        if media.exists():
            archive.add(media, arcname="media")


async def build_backup(record_id) -> None:
    async with AsyncSessionLocal() as db:
        record = await db.get(BackupRecord, record_id)
        if record:
            record.status = "running"
            await db.commit()
    root = Path(settings.BACKUP_ROOT)
    root.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(ZoneInfo("Asia/Dubai")).strftime("%Y%m%d-%H%M%S")
    final = root / f"company-tools-{stamp}-{str(record_id)[:8]}.zip"
    work = root / f".{record_id}"
    work.mkdir(exist_ok=True)
    dump = work / "database.dump"
    media = work / "media.tar.gz"
    try:
        parsed = urlparse(settings.DATABASE_URL.replace("+psycopg", ""))
        env = {**os.environ, "PGPASSWORD": parsed.password or ""}
        process = await asyncio.create_subprocess_exec(
            "pg_dump", "-Fc", "-h", parsed.hostname or "db", "-p", str(parsed.port or 5432),
            "-U", parsed.username or "platform", "-d", parsed.path.lstrip("/"), "-f", str(dump),
            env=env, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await process.communicate()
        if process.returncode:
            raise RuntimeError(stderr.decode(errors="replace")[-2000:])
        await asyncio.to_thread(_archive_media, media)
        def make_zip():
            with zipfile.ZipFile(final, "w", zipfile.ZIP_DEFLATED) as archive:
                archive.write(dump, "database.dump")
                archive.write(media, "media.tar.gz")
        await asyncio.to_thread(make_zip)
        digest = await asyncio.to_thread(lambda: hashlib.sha256(final.read_bytes()).hexdigest())
        async with AsyncSessionLocal() as db:
            record = await db.get(BackupRecord, record_id)
            if record:
                record.status = "completed"; record.filename = final.name
                record.file_path = str(final); record.size_bytes = final.stat().st_size
                record.checksum_sha256 = digest; record.completed_at = datetime.now(timezone.utc)
                await db.commit()
    except Exception as exc:
        async with AsyncSessionLocal() as db:
            record = await db.get(BackupRecord, record_id)
            if record:
                record.status = "failed"; record.error = str(exc)[:4000]
                record.completed_at = datetime.now(timezone.utc); await db.commit()
    finally:
        for path in (dump, media):
            path.unlink(missing_ok=True)
        try: work.rmdir()
        except OSError: pass


async def prune_backups(db: AsyncSession) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(days=settings.BACKUP_RETENTION_DAYS)
    rows = (await db.execute(select(BackupRecord).where(BackupRecord.created_at < cutoff))).scalars().all()
    for row in rows:
        if row.file_path: Path(row.file_path).unlink(missing_ok=True)
        await db.delete(row)
    await db.commit()
    return len(rows)


async def run_scheduled_backup(db: AsyncSession) -> dict:
    now = datetime.now(ZoneInfo("Asia/Dubai"))
    await prune_backups(db)
    if now.hour != settings.BACKUP_HOUR_DUBAI:
        return {"created": 0}
    today = now.date()
    existing = (
        await db.execute(
            select(BackupRecord)
            .where(
                BackupRecord.created_at
                >= datetime.combine(
                    today,
                    datetime.min.time(),
                    tzinfo=ZoneInfo("Asia/Dubai"),
                )
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if existing: return {"created": 0}
    record = BackupRecord(status="pending")
    db.add(record); await db.commit(); await db.refresh(record)
    await build_backup(record.id)
    return {"created": 1}

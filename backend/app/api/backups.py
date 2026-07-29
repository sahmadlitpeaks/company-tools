import uuid
import hashlib
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_admin
from app.core.config import settings
from app.core.database import get_db
from app.models.operations import BackupRecord
from app.models.user import User
from app.services.backups import build_backup


router = APIRouter(prefix="/backups", tags=["backups"])


def out(record):
    return {
        "id": record.id,
        "status": record.status,
        "source": record.source,
        "filename": record.filename,
        "size_bytes": record.size_bytes,
        "checksum_sha256": record.checksum_sha256,
        "error": record.error,
        "created_at": record.created_at,
        "completed_at": record.completed_at,
    }


@router.get("")
async def listing(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    rows = (
        await db.execute(
            select(BackupRecord).order_by(BackupRecord.created_at.desc())
        )
    ).scalars().all()
    return [out(record) for record in rows]


@router.get("/status")
async def status(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    record = (
        await db.execute(
            select(BackupRecord)
            .order_by(BackupRecord.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    return {"configured": True, "latest": out(record) if record else None}


@router.post("",status_code=202)
async def create(
    tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_admin),
):
    running = (
        await db.execute(
            select(BackupRecord)
            .where(BackupRecord.status.in_(["pending", "running"]))
            .limit(1)
        )
    ).scalar_one_or_none()
    if running:
        raise HTTPException(409, "A backup is already running")
    record = BackupRecord(
        status="pending",
        source="created",
        created_by_id=user.id,
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)
    tasks.add_task(build_backup, record.id)
    return out(record)


@router.post("/import", status_code=201)
async def import_archive(
    archive: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_admin),
):
    """Register a previously exported platform archive without restoring it."""
    if not archive.filename or not archive.filename.lower().endswith(".zip"):
        raise HTTPException(422, "Choose a .zip backup archive")

    root = Path(settings.BACKUP_ROOT)
    root.mkdir(parents=True, exist_ok=True)
    import_id = uuid.uuid4()
    temporary = root / f".import-{import_id}.tmp"
    digest = hashlib.sha256()
    size = 0
    try:
        with temporary.open("wb") as output:
            while chunk := await archive.read(1024 * 1024):
                size += len(chunk)
                if size > settings.BACKUP_IMPORT_MAX_BYTES:
                    raise HTTPException(413, "Backup archive is too large")
                digest.update(chunk)
                output.write(chunk)

        if not zipfile.is_zipfile(temporary):
            raise HTTPException(422, "The selected file is not a valid ZIP archive")
        with zipfile.ZipFile(temporary) as bundle:
            names = set(bundle.namelist())
            required = {"database.dump", "media.tar.gz"}
            if not required.issubset(names):
                raise HTTPException(
                    422,
                    "Backup must contain database.dump and media.tar.gz",
                )
            if any(
                Path(name).is_absolute() or ".." in Path(name).parts
                for name in names
            ):
                raise HTTPException(422, "Backup contains unsafe paths")
            if bundle.getinfo("database.dump").file_size == 0:
                raise HTTPException(422, "database.dump is empty")

        stamp = datetime.now(ZoneInfo("Asia/Dubai")).strftime("%Y%m%d-%H%M%S")
        final = root / f"company-tools-imported-{stamp}-{str(import_id)[:8]}.zip"
        temporary.replace(final)
        record = BackupRecord(
            status="completed",
            source="imported",
            filename=final.name,
            file_path=str(final),
            size_bytes=size,
            checksum_sha256=digest.hexdigest(),
            created_by_id=user.id,
            completed_at=datetime.now(timezone.utc),
        )
        db.add(record)
        await db.commit()
        await db.refresh(record)
        return out(record)
    finally:
        await archive.close()
        temporary.unlink(missing_ok=True)


@router.get("/{backup_id}/download")
async def download(
    backup_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    record = await db.get(BackupRecord, backup_id)
    if (
        not record
        or record.status != "completed"
        or not record.file_path
        or not Path(record.file_path).is_file()
    ):
        raise HTTPException(404, "Backup file not found")
    return FileResponse(
        record.file_path,
        filename=record.filename or "backup.zip",
        media_type="application/zip",
    )

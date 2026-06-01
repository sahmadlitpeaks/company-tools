import os
import uuid
from pathlib import Path

from fastapi import UploadFile

from app.core.config import settings

MEDIA_ROOT = Path(settings.MEDIA_ROOT)


def ensure_media_root() -> None:
    MEDIA_ROOT.mkdir(parents=True, exist_ok=True)


async def save_upload(file: UploadFile, subdir: str = "uploads") -> tuple[str, int]:
    """Persist an UploadFile under MEDIA_ROOT/subdir. Returns (rel_path, size)."""
    ensure_media_root()
    dest_dir = MEDIA_ROOT / subdir
    dest_dir.mkdir(parents=True, exist_ok=True)

    suffix = Path(file.filename or "").suffix
    name = f"{uuid.uuid4().hex}{suffix}"
    dest = dest_dir / name

    size = 0
    with dest.open("wb") as out:
        while chunk := await file.read(1024 * 1024):
            out.write(chunk)
            size += len(chunk)
    await file.close()

    rel_path = os.path.relpath(dest, MEDIA_ROOT)
    return rel_path.replace(os.sep, "/"), size


def media_url(rel_path: str) -> str:
    return f"{settings.MEDIA_URL}/{rel_path}"


def absolute_path(rel_path: str) -> Path:
    return MEDIA_ROOT / rel_path

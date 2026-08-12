import os
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile

from app.core.config import settings

MEDIA_ROOT = Path(settings.MEDIA_ROOT)

# Raster image types safe to serve inline. Deliberately excludes SVG and HTML,
# which can carry executable script.
_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}


def validate_image_upload(file: UploadFile) -> None:
    """Reject non-image uploads for files that will be served inline as public
    static assets (card photos, company logos).

    Those subtrees are served directly by StaticFiles, so an uploaded
    ``.svg``/``.html`` would be returned with an executable content type from
    the app's own origin — stored XSS. Everything else is served through the
    download API with attachment disposition and isn't affected.
    """
    ext = Path(file.filename or "").suffix.lower()
    ctype = (file.content_type or "").lower()
    if ext not in _IMAGE_EXTS or not ctype.startswith("image/") or "svg" in ctype:
        raise HTTPException(
            status_code=422,
            detail="Only PNG, JPEG, GIF or WebP images are allowed here.",
        )


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


# Document types accepted for CVs arriving through the intake webhook. No
# images or archives: these are stored unexamined from a public endpoint, so the
# set is kept to what a résumé is actually sent as.
_DOCUMENT_EXTS = {".pdf", ".doc", ".docx", ".rtf", ".odt", ".txt"}


def save_bytes(data: bytes, filename: str, subdir: str = "uploads") -> tuple[str, int]:
    """Persist raw bytes under MEDIA_ROOT/subdir. Returns (rel_path, size).

    The stored name is always a fresh UUID — the caller's filename only ever
    contributes its extension, so a hostile name cannot escape the directory or
    overwrite an existing file.
    """
    ensure_media_root()
    dest_dir = MEDIA_ROOT / subdir
    dest_dir.mkdir(parents=True, exist_ok=True)

    suffix = Path(filename or "").suffix.lower()
    if suffix not in _DOCUMENT_EXTS:
        raise HTTPException(
            status_code=422,
            detail="Only PDF, Word, RTF, ODT or plain-text documents are accepted.",
        )
    dest = dest_dir / f"{uuid.uuid4().hex}{suffix}"
    dest.write_bytes(data)
    rel_path = os.path.relpath(dest, MEDIA_ROOT)
    return rel_path.replace(os.sep, "/"), len(data)


def media_url(rel_path: str) -> str:
    return f"{settings.MEDIA_URL}/{rel_path}"


def absolute_path(rel_path: str) -> Path:
    return MEDIA_ROOT / rel_path

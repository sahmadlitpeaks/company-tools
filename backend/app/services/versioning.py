"""Replace a shareable document's file while keeping its identity (and share
link / QR) intact, snapshotting the previous file as a DocVersion.
"""
import uuid

from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.docversion import DocVersion
from app.models.user import User
from app.services.storage import save_upload


async def replace_file(
    db: AsyncSession,
    *,
    doc,
    doc_type: str,
    current_path: str,
    current_content_type: str | None,
    current_size: int,
    file: UploadFile,
    note: str | None,
    user: User,
    subdir: str,
) -> tuple[str, int]:
    """Snapshot the current file as a DocVersion, then save the new upload.

    Returns (new_rel_path, new_size). The caller updates the doc's own
    file_path / content_type / size_bytes and bumps `doc.version`.
    """
    db.add(
        DocVersion(
            doc_type=doc_type,
            doc_id=doc.id,
            version=doc.version,
            file_path=current_path,
            content_type=current_content_type,
            size_bytes=current_size,
            note=note,
            created_by_id=user.id,
        )
    )
    new_path, new_size = await save_upload(file, subdir=subdir)
    doc.version += 1
    return new_path, new_size


async def list_versions(
    db: AsyncSession, *, doc_type: str, doc_id: uuid.UUID
) -> list[DocVersion]:
    return list(
        (
            await db.execute(
                select(DocVersion)
                .where(
                    DocVersion.doc_type == doc_type, DocVersion.doc_id == doc_id
                )
                .order_by(DocVersion.version.desc())
            )
        )
        .scalars()
        .all()
    )


async def get_version(
    db: AsyncSession, *, doc_type: str, doc_id: uuid.UUID, version: int
) -> DocVersion | None:
    return (
        await db.execute(
            select(DocVersion).where(
                DocVersion.doc_type == doc_type,
                DocVersion.doc_id == doc_id,
                DocVersion.version == version,
            )
        )
    ).scalar_one_or_none()

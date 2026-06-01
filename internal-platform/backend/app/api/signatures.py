import json
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_admin, get_current_user
from app.core.database import get_db
from app.models.signature import EmailSignature, SignatureTemplate
from app.models.user import User
from app.schemas.common import (
    EmailSignatureOut,
    SignatureRenderRequest,
    SignatureTemplateCreate,
    SignatureTemplateOut,
)
from app.services.signatures import render_signature

router = APIRouter(prefix="/signatures", tags=["email-signatures"])


@router.get("/templates", response_model=list[SignatureTemplateOut])
async def list_templates(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    return (
        await db.execute(select(SignatureTemplate).order_by(SignatureTemplate.name))
    ).scalars().all()


@router.post("/templates", response_model=SignatureTemplateOut, status_code=201)
async def create_template(
    payload: SignatureTemplateCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    template = SignatureTemplate(**payload.model_dump())
    db.add(template)
    await db.commit()
    await db.refresh(template)
    return template


def _user_defaults(user: User) -> dict[str, str]:
    return {
        "full_name": user.display_name or "",
        "title": user.job_title or "",
        "department": user.department or "",
        "email": user.email or "",
        "phone": user.business_phone or user.mobile_phone or "",
        "company": "AG Holding",
        "website": "https://agholding.net",
        "accent_color": "#0b5cab",
        "photo_url": user.avatar_url or "",
    }


@router.post("/render", response_model=EmailSignatureOut)
async def render_my_signature(
    payload: SignatureRenderRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    template = await db.get(SignatureTemplate, payload.template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    data = {**_user_defaults(user), **payload.data}
    rendered = render_signature(template.html, data)

    sig = EmailSignature(
        user_id=user.id,
        template_id=template.id,
        data=json.dumps(data),
        rendered_html=rendered,
    )
    db.add(sig)
    await db.commit()
    await db.refresh(sig)
    return sig


@router.get("/{signature_id}/preview", response_class=HTMLResponse)
async def preview_signature(
    signature_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    sig = await db.get(EmailSignature, signature_id)
    if not sig or sig.user_id != user.id:
        raise HTTPException(status_code=404, detail="Signature not found")
    return HTMLResponse(content=sig.rendered_html or "")

import uuid

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class SignatureTemplate(UUIDMixin, TimestampMixin, Base):
    """A reusable HTML email-signature template (feature #7).

    The body is a Jinja-style template using {{ placeholders }} such as
    {{ full_name }}, {{ title }}, {{ email }}, {{ phone }}, {{ logo_url }}.
    """

    __tablename__ = "signature_templates"

    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text)
    html: Mapped[str] = mapped_column(Text)
    is_default: Mapped[bool] = mapped_column(default=False)


class EmailSignature(UUIDMixin, TimestampMixin, Base):
    """A user's generated/rendered signature (feature #7)."""

    __tablename__ = "email_signatures"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    template_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("signature_templates.id", ondelete="SET NULL"), nullable=True
    )
    # JSON of the field values used to render the signature.
    data: Mapped[str | None] = mapped_column(Text)
    rendered_html: Mapped[str | None] = mapped_column(Text)

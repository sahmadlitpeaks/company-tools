"""Render a digital business card to a vCard, a PNG and a PDF.

Image/PDF rendering uses Pillow only (no extra deps). A TrueType font is used
when available (DejaVu is installed in the Docker image); otherwise we fall back
to Pillow's bitmap font so the feature still works in a bare environment.
"""
import io
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from app.models.card import DigitalCard
from app.services.qrcodes import generate_qr_png

_FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]


def build_vcard(card: DigitalCard) -> str:
    """vCard 3.0 text for importing into Contacts/Outlook."""
    lines = ["BEGIN:VCARD", "VERSION:3.0", f"FN:{card.full_name}"]
    if card.full_name:
        parts = card.full_name.split(" ", 1)
        last = parts[1] if len(parts) > 1 else ""
        lines.append(f"N:{last};{parts[0]};;;")
    if card.title:
        lines.append(f"TITLE:{card.title}")
    if card.company:
        lines.append(f"ORG:{card.company}")
    if card.email:
        lines.append(f"EMAIL;TYPE=INTERNET,WORK:{card.email}")
    if card.phone:
        lines.append(f"TEL;TYPE=WORK,VOICE:{card.phone}")
    if card.whatsapp:
        lines.append(f"TEL;TYPE=CELL:{card.whatsapp}")
    if card.website:
        lines.append(f"URL:{card.website}")
    if card.address:
        lines.append(f"ADR;TYPE=WORK:;;{card.address};;;;")
    if card.bio:
        lines.append(f"NOTE:{card.bio}")
    lines.append("END:VCARD")
    return "\r\n".join(lines) + "\r\n"


def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in (_FONT_CANDIDATES[1] if bold else _FONT_CANDIDATES[0], *_FONT_CANDIDATES):
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def render_card_png(card: DigitalCard, card_url: str) -> bytes:
    """Render the business card to a 1000x560 PNG."""
    W, H = 1000, 560
    accent = card.accent_color or "#0b5cab"
    img = Image.new("RGB", (W, H), "#ffffff")
    draw = ImageDraw.Draw(img)

    # Accent side bar.
    draw.rectangle([0, 0, 18, H], fill=accent)
    # Header band.
    draw.rectangle([18, 0, W, 150], fill=accent)

    name_font = _font(48, bold=True)
    title_font = _font(26)
    label_font = _font(24)

    draw.text((50, 38), card.full_name or "", font=name_font, fill="#ffffff")
    if card.title:
        draw.text((52, 100), card.title, font=title_font, fill="#e8eef6")

    y = 200
    rows = []
    if card.company:
        rows.append(("Company", card.company))
    if card.email:
        rows.append(("Email", card.email))
    if card.phone:
        rows.append(("Phone", card.phone))
    if card.whatsapp:
        rows.append(("WhatsApp", card.whatsapp))
    if card.website:
        rows.append(("Web", card.website))
    for label, value in rows:
        draw.text((50, y), f"{label}", font=_font(18), fill=accent)
        draw.text((50, y + 22), value, font=label_font, fill="#1a2230")
        y += 64

    # QR code bottom-right.
    qr_png = generate_qr_png(card_url, fill_color=accent, box_size=6, border=2)
    qr = Image.open(io.BytesIO(qr_png)).convert("RGB")
    qr.thumbnail((230, 230))
    img.paste(qr, (W - qr.width - 50, H - qr.height - 40))
    draw.text((W - 250, H - 30), "Scan to view card", font=_font(16), fill="#64748b")

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def render_card_pdf(card: DigitalCard, card_url: str) -> bytes:
    """Render the same card layout as a one-page PDF."""
    png = render_card_png(card, card_url)
    img = Image.open(io.BytesIO(png)).convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="PDF", resolution=150.0)
    return buf.getvalue()

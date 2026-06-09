"""Render printable asset labels (QR + tag + name) as PNG or a PDF sheet."""
import io
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from app.models.tracked_asset import TrackedAsset
from app.services.qrcodes import generate_qr_png

_FONTS = {
    "regular": "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "bold": "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
}

LABEL_W, LABEL_H = 660, 250


def _font(size: int, bold: bool = False):
    path = _FONTS["bold"] if bold else _FONTS["regular"]
    if Path(path).exists():
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            pass
    return ImageFont.load_default()


def render_label(asset: TrackedAsset, url: str) -> Image.Image:
    """A single label as a PIL image (QR on the left, details on the right)."""
    img = Image.new("RGB", (LABEL_W, LABEL_H), "#ffffff")
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, 0, LABEL_W - 1, LABEL_H - 1], outline="#cbd5e1", width=2)

    qr = Image.open(io.BytesIO(generate_qr_png(url, box_size=6, border=1))).convert("RGB")
    qr.thumbnail((200, 200))
    img.paste(qr, (24, (LABEL_H - qr.height) // 2))

    x = 250
    draw.text((x, 36), "AG Holding", font=_font(20, bold=True), fill="#0b5cab")
    draw.text((x, 74), asset.asset_tag, font=_font(40, bold=True), fill="#1a2230")
    draw.text((x, 132), asset.name[:28], font=_font(24), fill="#334155")
    if asset.category:
        draw.text((x, 170), asset.category[:30], font=_font(20), fill="#64748b")
    return img


def render_label_png(asset: TrackedAsset, url: str) -> bytes:
    buf = io.BytesIO()
    render_label(asset, url).save(buf, format="PNG")
    return buf.getvalue()


def render_labels_pdf(items: list[tuple[TrackedAsset, str]]) -> bytes:
    """Compose labels onto A4 pages (2 columns) and return a multi-page PDF."""
    PAGE_W, PAGE_H = 1240, 1754  # ~A4 @150dpi
    margin, gap = 40, 24
    cols = 2
    col_w = (PAGE_W - 2 * margin - (cols - 1) * gap) // cols
    scale = col_w / LABEL_W
    cell_h = int(LABEL_H * scale)
    rows = max(1, (PAGE_H - 2 * margin) // (cell_h + gap))
    per_page = cols * rows

    pages: list[Image.Image] = []
    for start in range(0, max(1, len(items)), per_page):
        page = Image.new("RGB", (PAGE_W, PAGE_H), "#ffffff")
        for i, (asset, url) in enumerate(items[start : start + per_page]):
            label = render_label(asset, url).resize((col_w, cell_h))
            r, c = divmod(i, cols)
            x = margin + c * (col_w + gap)
            y = margin + r * (cell_h + gap)
            page.paste(label, (x, y))
        pages.append(page)

    if not pages:
        pages = [Image.new("RGB", (PAGE_W, PAGE_H), "#ffffff")]

    buf = io.BytesIO()
    pages[0].save(
        buf, format="PDF", save_all=True, append_images=pages[1:], resolution=150.0
    )
    return buf.getvalue()

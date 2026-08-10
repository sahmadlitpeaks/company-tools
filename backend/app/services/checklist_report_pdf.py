"""Render a completed routine-checks run as a printable PDF, photos included.

Pillow-based (same approach as the payslip PDF) so it needs no extra
dependency. Flows sections and checkpoints down A4 pages, paginating as needed,
and embeds each checkpoint's photo evidence inline.
"""
import io
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from app.services.storage import absolute_path

_FONTS = {
    "regular": "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "bold": "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
}
PAGE_W, PAGE_H = 1240, 1754  # ~A4 @150dpi
MARGIN = 80
BOTTOM = PAGE_H - 70
INK = "#1a2230"
MUTED = "#64748b"
LINE = "#d3dae6"
ACCENT = "#0b5cab"
STATUS_COLOR = {
    "ok": "#16a34a",
    "issue": "#dc2626",
    "na": "#94a3b8",
    "done": "#16a34a",
    "pending": "#cbd5e1",
}
STATUS_LABEL = {"ok": "OK", "issue": "ISSUE", "na": "N/A", "done": "DONE", "pending": "—"}


def _font(size: int, bold: bool = False):
    path = _FONTS["bold"] if bold else _FONTS["regular"]
    if Path(path).exists():
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            pass
    return ImageFont.load_default()


def _wrap(draw, text: str, font, max_w: int) -> list[str]:
    words = (text or "").split()
    lines, cur = [], ""
    for w in words:
        trial = f"{cur} {w}".strip()
        if draw.textlength(trial, font=font) <= max_w:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines or [""]


class _Doc:
    """A paginating canvas: draws top-to-bottom, spilling onto new pages."""

    def __init__(self) -> None:
        self.pages: list[Image.Image] = []
        self._new_page()

    def _new_page(self) -> None:
        img = Image.new("RGB", (PAGE_W, PAGE_H), "white")
        self.img = img
        self.d = ImageDraw.Draw(img)
        self.y = MARGIN
        self.pages.append(img)

    def ensure(self, height: int) -> None:
        if self.y + height > BOTTOM:
            self._new_page()

    def text(self, x, s, font, fill=INK):
        self.d.text((x, self.y), s, font=font, fill=fill)

    def to_pdf(self) -> bytes:
        buf = io.BytesIO()
        self.pages[0].save(
            buf, format="PDF", save_all=True, append_images=self.pages[1:]
        )
        return buf.getvalue()


def render_run_report(run: dict) -> bytes:
    """``run`` shape:
    {name, run_date, checked_by, verified_by, status, answered, total,
     sections: [{name, items: [{title, status, note, value, responded_by,
     responded_at, photos: [rel_path,...]}]}]}
    """
    doc = _Doc()

    # Header band
    doc.d.rectangle([0, 0, PAGE_W, 150], fill=ACCENT)
    doc.d.text((MARGIN, 44), run.get("name") or "Routine Check", font=_font(38, bold=True), fill="white")
    doc.d.text((MARGIN, 100), f"Date: {run.get('run_date', '')}", font=_font(22), fill="white")
    doc.y = 185

    meta = [
        ("Checked by", run.get("checked_by") or "—"),
        ("Verified by", run.get("verified_by") or "—"),
        ("Status", run.get("status") or "—"),
        ("Progress", f"{run.get('answered', 0)}/{run.get('total', 0)}"),
    ]
    for label, value in meta:
        doc.text(MARGIN, label, _font(20), fill=MUTED)
        doc.text(MARGIN + 240, str(value), _font(22, bold=True))
        doc.y += 40
    doc.y += 10
    doc.d.line([MARGIN, doc.y, PAGE_W - MARGIN, doc.y], fill=LINE, width=2)
    doc.y += 30

    for section in run.get("sections", []):
        doc.ensure(60)
        doc.text(MARGIN, section.get("name") or "Checks", _font(26, bold=True), fill=ACCENT)
        doc.y += 50
        for item in section.get("items", []):
            status = item.get("status") or "pending"
            title_font = _font(23, bold=True)
            title_lines = _wrap(doc.d, item.get("title") or "", title_font, PAGE_W - 2 * MARGIN - 130)
            block_h = 34 * len(title_lines) + 26
            doc.ensure(block_h)
            # Status chip
            chip = STATUS_LABEL.get(status, status.upper())
            cf = _font(18, bold=True)
            cw = doc.d.textlength(chip, font=cf) + 24
            doc.d.rounded_rectangle(
                [MARGIN, doc.y, MARGIN + cw, doc.y + 30], radius=6,
                fill=STATUS_COLOR.get(status, "#cbd5e1"),
            )
            doc.d.text((MARGIN + 12, doc.y + 5), chip, font=cf, fill="white")
            # Title (wrapped) to the right of the chip
            tx = MARGIN + cw + 16
            for ln in title_lines:
                doc.d.text((tx, doc.y), ln, font=title_font, fill=INK)
                doc.y += 32
            # Responder line
            who = item.get("responded_by")
            when = item.get("responded_at")
            if who or when:
                doc.text(tx, f"{who or ''}  {when or ''}".strip(), _font(17), fill=MUTED)
                doc.y += 28
            # Reading / note
            if item.get("value"):
                doc.text(tx, f"Reading: {item['value']}", _font(19), fill=INK)
                doc.y += 28
            for ln in _wrap(doc.d, item.get("note") or "", _font(19), PAGE_W - tx - MARGIN):
                if ln:
                    doc.text(tx, ln, _font(19), fill=INK)
                    doc.y += 26
            # Photos
            for rel in item.get("photos", []):
                try:
                    with Image.open(absolute_path(rel)) as im:
                        im = im.convert("RGB")
                        target_w = 460
                        ratio = target_w / im.width
                        target_h = max(1, int(im.height * ratio))
                        im = im.resize((target_w, target_h))
                except Exception:
                    continue
                doc.ensure(target_h + 16)
                px, py = int(tx), int(doc.y)  # paste needs integer coordinates
                doc.img.paste(im, (px, py))
                doc.d.rectangle(
                    [px, py, px + target_w, py + target_h], outline=LINE, width=1
                )
                doc.y += target_h + 14
            doc.y += 16
            doc.d.line([MARGIN, doc.y, PAGE_W - MARGIN, doc.y], fill="#eef1f6", width=1)
            doc.y += 14

    return doc.to_pdf()

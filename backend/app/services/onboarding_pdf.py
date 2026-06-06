"""Render an onboarding/offboarding journey as a printable PDF (hard copy):
employee + branch, assigned assets, account accesses, and the checklist.
Pillow-based (no extra deps), mirroring the asset-label PDF approach.
"""
import io
from datetime import date
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

_FONTS = {
    "regular": "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "bold": "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
}
PAGE_W, PAGE_H = 1240, 1754  # ~A4 @150dpi
MARGIN = 70
INK = "#1a2230"
MUTED = "#64748b"
LINE = "#d3dae6"
ACCENT = "#0b5cab"


def _font(size: int, bold: bool = False):
    path = _FONTS["bold"] if bold else _FONTS["regular"]
    if Path(path).exists():
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            pass
    return ImageFont.load_default()


def render_journey_report(
    *,
    kind: str,
    target_name: str,
    target_email: str,
    branch: str | None,
    status: str,
    created_at,
    assets: list[tuple[str, str]],          # (tag, name)
    grants: list[tuple[str, str, str]],     # (name, username/system, status)
    tasks: list[tuple[str, str, str]],      # (title, category, status)
) -> bytes:
    img = Image.new("RGB", (PAGE_W, PAGE_H), "#ffffff")
    d = ImageDraw.Draw(img)
    y = MARGIN

    # Header band
    d.rectangle([0, 0, PAGE_W, 18], fill=ACCENT)
    title = "Onboarding Record" if kind == "onboarding" else "Offboarding / Access Removal Record"
    d.text((MARGIN, y), title, font=_font(40, True), fill=INK)
    y += 58
    d.text((MARGIN, y), "AG Holding — confidential", font=_font(20), fill=MUTED)
    y += 50

    def field(label: str, value: str, yy: int) -> int:
        d.text((MARGIN, yy), label, font=_font(20, True), fill=MUTED)
        d.text((MARGIN + 260, yy), value or "—", font=_font(22), fill=INK)
        return yy + 38

    y = field("Employee", target_name, y)
    y = field("Email", target_email, y)
    y = field("Branch / sub-company", branch or "—", y)
    y = field("Status", status.replace("_", " ").title(), y)
    y = field(
        "Generated", date.today().isoformat() + f"  (started {str(created_at)[:10]})", y
    )
    y += 14

    def section(heading: str, headers: list[str], rows: list[tuple], widths: list[int], yy: int) -> int:
        d.line([MARGIN, yy, PAGE_W - MARGIN, yy], fill=LINE, width=2)
        yy += 16
        d.text((MARGIN, yy), heading, font=_font(26, True), fill=ACCENT)
        yy += 44
        x = MARGIN
        for h, w in zip(headers, widths):
            d.text((x, yy), h, font=_font(18, True), fill=MUTED)
            x += w
        yy += 30
        if not rows:
            d.text((MARGIN, yy), "None.", font=_font(20), fill=MUTED)
            return yy + 40
        for row in rows:
            x = MARGIN
            for val, w in zip(row, widths):
                d.text((x, yy), str(val)[:48], font=_font(20), fill=INK)
                x += w
            yy += 34
        return yy + 24

    y = section(
        "Assigned assets",
        ["Tag", "Asset"],
        assets,
        [240, 700],
        y,
    )
    y = section(
        "Account & system access",
        ["Access", "User / system", "Status"],
        grants,
        [360, 420, 200],
        y,
    )
    y = section(
        "Checklist",
        ["Item", "Category", "Status"],
        tasks,
        [560, 240, 200],
        y,
    )

    # Sign-off line
    y = max(y, PAGE_H - 180)
    d.line([MARGIN, y, PAGE_W - MARGIN, y], fill=LINE, width=2)
    y += 20
    d.text((MARGIN, y), "IT sign-off: ____________________", font=_font(20), fill=INK)
    d.text((MARGIN + 560, y), "HR sign-off: ____________________", font=_font(20), fill=INK)

    buf = io.BytesIO()
    img.save(buf, format="PDF", resolution=150.0)
    return buf.getvalue()

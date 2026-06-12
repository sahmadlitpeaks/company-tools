"""Render a single payslip as a printable PDF (Pillow-based, no extra deps)."""
import io
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

_FONTS = {
    "regular": "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "bold": "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
}
PAGE_W, PAGE_H = 1240, 1754  # ~A4 @150dpi
MARGIN = 80
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


def render_payslip(
    *,
    company: str,
    employee: str,
    period: str,
    currency: str,
    base_salary,
    items: list[dict],
    gross,
    deductions,
    net,
) -> bytes:
    img = Image.new("RGB", (PAGE_W, PAGE_H), "white")
    d = ImageDraw.Draw(img)

    def money(v) -> str:
        return f"{currency} {float(v or 0):,.2f}"

    # Header
    d.rectangle([0, 0, PAGE_W, 150], fill=ACCENT)
    d.text((MARGIN, 50), company, font=_font(40, bold=True), fill="white")
    d.text((MARGIN, 102), "Payslip", font=_font(24), fill="white")

    y = 200
    d.text((MARGIN, y), f"Employee: {employee}", font=_font(28, bold=True), fill=INK)
    d.text((PAGE_W - MARGIN - 360, y), f"Period: {period}", font=_font(26), fill=INK)
    y += 70
    d.line([MARGIN, y, PAGE_W - MARGIN, y], fill=LINE, width=2)
    y += 30

    earnings = [it for it in items if it.get("kind") != "deduction"]
    deducts = [it for it in items if it.get("kind") == "deduction"]

    def row(label: str, value: str, yy: int, bold: bool = False) -> int:
        f = _font(26, bold=bold)
        d.text((MARGIN, yy), label, font=f, fill=INK)
        w = d.textlength(value, font=f)
        d.text((PAGE_W - MARGIN - w, yy), value, font=f, fill=INK)
        return yy + 44

    d.text((MARGIN, y), "Earnings", font=_font(24, bold=True), fill=MUTED)
    y += 44
    y = row("Base salary", money(base_salary), y)
    for it in earnings:
        y = row(str(it.get("label", "Earning")), money(it.get("amount")), y)
    y = row("Gross", money(gross), y, bold=True)
    y += 20

    d.text((MARGIN, y), "Deductions", font=_font(24, bold=True), fill=MUTED)
    y += 44
    if deducts:
        for it in deducts:
            y = row(str(it.get("label", "Deduction")), money(it.get("amount")), y)
    else:
        y = row("None", money(0), y)
    y = row("Total deductions", money(deductions), y, bold=True)
    y += 30

    d.line([MARGIN, y, PAGE_W - MARGIN, y], fill=LINE, width=2)
    y += 30
    d.rectangle([MARGIN, y, PAGE_W - MARGIN, y + 70], fill="#eef4fb")
    f = _font(32, bold=True)
    d.text((MARGIN + 20, y + 16), "Net pay", font=f, fill=ACCENT)
    nv = money(net)
    w = d.textlength(nv, font=f)
    d.text((PAGE_W - MARGIN - 20 - w, y + 16), nv, font=f, fill=ACCENT)

    d.text((MARGIN, PAGE_H - 90), "This payslip is system-generated.", font=_font(20), fill=MUTED)

    buf = io.BytesIO()
    img.save(buf, format="PDF", resolution=150.0)
    return buf.getvalue()

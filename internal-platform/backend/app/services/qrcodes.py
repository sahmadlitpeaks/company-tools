import io

import qrcode
from qrcode.image.pil import PilImage


def generate_qr_png(
    data: str,
    fill_color: str = "#000000",
    back_color: str = "#ffffff",
    box_size: int = 10,
    border: int = 4,
) -> bytes:
    """Render a QR code for `data` as PNG bytes."""
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=box_size,
        border=border,
    )
    qr.add_data(data)
    qr.make(fit=True)
    img: PilImage = qr.make_image(fill_color=fill_color, back_color=back_color)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()

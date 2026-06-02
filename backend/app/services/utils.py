import re
import secrets
import unicodedata


def slugify(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    value = re.sub(r"[^\w\s-]", "", value).strip().lower()
    return re.sub(r"[-\s]+", "-", value) or secrets.token_hex(4)


def random_code(length: int = 7) -> str:
    """URL-safe short code (no ambiguous chars)."""
    alphabet = "abcdefghjkmnpqrstuvwxyz23456789"
    return "".join(secrets.choice(alphabet) for _ in range(length))

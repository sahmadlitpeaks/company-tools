"""Server-side verification of a proof-of-humanity token.

The token is minted in the visitor's browser and forwarded by the plugin; the
secret never leaves this server, so a bot cannot forge a pass by reading the
page source. This is the single most effective layer against automated
submission — but it is optional, because it needs cooperation from each website
and the rest of the screen has to work without it.

Deliberately fails *soft*: if the provider is unreachable we do not reject the
submission, we quarantine it. An outage at Cloudflare must not silently drop a
day of real leads.
"""
import httpx

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.app_settings import get_captcha_config

_ENDPOINTS = {
    "turnstile": "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    "recaptcha": "https://www.google.com/recaptcha/api/siteverify",
    "hcaptcha": "https://hcaptcha.com/siteverify",
}
_TIMEOUT = 4.0
# reCAPTCHA v3 returns a 0-1 likelihood rather than a pass/fail.
_RECAPTCHA_MIN_SCORE = 0.5


async def verify(
    db: AsyncSession, token: str | None, *, ip: str | None = None
) -> tuple[str, str | None]:
    """Verify a captcha token.

    Returns ``(verdict, detail)`` where verdict is one of:
      ``off``       — no provider configured, nothing to check
      ``missing``   — a provider is configured but no token was sent
      ``pass``      — verified human
      ``fail``      — the provider rejected it
      ``unavailable`` — could not reach the provider; treat as inconclusive
    """
    cfg = await get_captcha_config(db)
    provider, secret = cfg.get("provider"), cfg.get("secret")
    if not provider or not secret or provider not in _ENDPOINTS:
        return "off", None
    if not token:
        return "missing", "No captcha token supplied"

    data = {"secret": secret, "response": token}
    if ip:
        data["remoteip"] = ip
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            response = await client.post(_ENDPOINTS[provider], data=data)
            body = response.json()
    except Exception as exc:  # network, timeout, malformed JSON
        return "unavailable", f"Captcha provider unreachable ({type(exc).__name__})"

    if not body.get("success"):
        codes = body.get("error-codes") or body.get("error_codes") or []
        return "fail", f"Captcha rejected ({', '.join(map(str, codes)) or 'no reason given'})"

    if provider == "recaptcha":
        score = body.get("score")
        if score is not None and float(score) < _RECAPTCHA_MIN_SCORE:
            return "fail", f"reCAPTCHA score {score} below {_RECAPTCHA_MIN_SCORE}"

    return "pass", None

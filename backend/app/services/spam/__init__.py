"""Layered screening for inbound submissions.

No single check catches modern form spam. A bot that fills in a plausible name,
a real-looking address and a bland sentence defeats content matching entirely —
so the verdict combines several independent views:

* ``blocklist``   — explicit operator decisions, the only hard reject
* ``captcha``     — proof of humanity, verified server-side
* ``content``     — the message read on its own
* ``correlation`` — what else this IP/message/address has done recently
* ``learning``    — what the team judged the last time it saw wording like this

``screen()`` runs them and returns one score, one status and the reasons behind
it. The reasons matter: a filter whose decisions cannot be explained is a filter
that gets switched off the first time it holds a real customer.
"""
from dataclasses import dataclass, field

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.spam import blocklist, captcha, correlation, learning
from app.services.spam.content import (  # noqa: F401  (public re-export)
    CLEAN_THRESHOLD,
    DISPOSABLE_DOMAINS,
    HONEYPOT_FIELDS,
    SPAM_THRESHOLD,
    SPAM_WORDS,
    score_submission,
    status_for,
)

__all__ = [
    "CLEAN_THRESHOLD", "DISPOSABLE_DOMAINS", "HONEYPOT_FIELDS", "SPAM_THRESHOLD",
    "SPAM_WORDS", "Screening", "score_submission", "screen", "status_for",
    "learn_from_verdict", "content_hash", "ip_rate_exceeded",
]

content_hash = correlation.content_hash
ip_rate_exceeded = correlation.ip_rate_exceeded

# A submission that arrives faster than a person could plausibly type it.
_MIN_FILL_MS = 3000


@dataclass
class Screening:
    score: int = 0
    status: str = "quarantined"
    reasons: list[str] = field(default_factory=list)
    # Set when the submission should be refused outright rather than stored.
    rejected: bool = False
    reject_reason: str | None = None


async def screen(
    db: AsyncSession,
    *,
    source,
    name: str | None,
    email: str | None,
    phone: str | None,
    subject: str | None,
    message: str | None,
    payload: dict | None,
    ip: str | None = None,
    digest: str | None = None,
    captcha_token: str | None = None,
    elapsed_ms: int | None = None,
    site_flagged: bool = False,
) -> Screening:
    """Run every layer and combine them into one verdict."""
    text = " ".join(filter(None, [subject, message]))
    result = Screening()

    # --- Layer 0: explicit operator decisions ------------------------------
    action, reason = await blocklist.check(
        db, source_id=getattr(source, "id", None), ip=ip, email=email,
        digest=digest, text=text,
    )
    if action == "block":
        result.rejected = True
        result.reject_reason = reason
        return result
    if action == "allow":
        result.score = 0
        result.status = "new"
        result.reasons = [reason or "Allowlisted"]
        return result

    # --- Layer 0b: proof of humanity ---------------------------------------
    mode = getattr(source, "captcha_mode", "off") or "off"
    if mode != "off":
        verdict, detail = await captcha.verify(db, captcha_token, ip=ip)
        if verdict == "fail" or (verdict == "missing" and mode == "required"):
            if mode == "required":
                result.rejected = True
                result.reject_reason = detail or "Captcha verification failed"
                return result
            result.score += 45
            result.reasons.append(detail or "Captcha verification failed")
        elif verdict == "unavailable":
            # Never drop real leads because a third party is down.
            result.score += 20
            result.reasons.append(detail or "Captcha could not be verified")
        elif verdict == "missing":
            result.score += 20
            result.reasons.append("No captcha token supplied")

    # --- Layer 1: the message on its own -----------------------------------
    score, reasons = score_submission(
        name=name, email=email, phone=phone, subject=subject,
        message=message, payload=payload,
    )
    if score >= 100 and reasons and "Honeypot" in reasons[0]:
        # An unambiguous bot marker; no need to weigh anything else.
        result.score = 100
        result.reasons = reasons
        result.status = status_for(100, source.spam_threshold, source.clean_threshold)
        return result
    result.score += score
    result.reasons.extend(reasons)

    # --- Layer 2: what else has been happening -----------------------------
    hist_score, hist_reasons = await correlation.score_history(
        db, ip=ip, email=email, digest=digest, source_id=getattr(source, "id", None)
    )
    result.score += hist_score
    result.reasons.extend(hist_reasons)

    # --- Layer 3: learned wording ------------------------------------------
    learn_score, learn_reasons = await learning.score_tokens(
        db, learning.tokenize(subject, message)
    )
    result.score += learn_score
    result.reasons.extend(learn_reasons)

    # --- Layer 4: submitted impossibly fast ---------------------------------
    if elapsed_ms is not None and 0 <= elapsed_ms < _MIN_FILL_MS:
        result.score += 30
        result.reasons.append(f"Form completed in {elapsed_ms} ms")

    if site_flagged:
        # The site's own screen (Akismet, reCAPTCHA) is decent evidence, so this
        # must be enough on its own to hold an otherwise clean-looking message
        # for review — but never enough to discard it.
        result.score += 30
        result.reasons.append("Flagged by the website's own spam check")

    result.score = max(0, min(100, result.score))
    result.status = status_for(result.score, source.spam_threshold, source.clean_threshold)
    if action == "quarantine" and result.status == "new":
        result.status = "quarantined"
        result.reasons.append(reason or "Held by an operator rule")
    return result


async def learn_from_verdict(db, submission, *, is_spam: bool) -> None:
    """Feed a human triage decision back into the filter."""
    await learning.learn(
        db,
        learning.tokenize(submission.subject, submission.message),
        is_spam=is_spam,
    )

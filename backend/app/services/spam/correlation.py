"""Cross-submission signals: what this sender has done elsewhere, recently.

The content layer judges one message in isolation, which is why a polite,
well-formed "I am interested in your services" from a bot scores zero. These
checks look at the same message arriving at four sites in a minute, or one IP
working through every form it can find — the shape of automated submission that
content matching cannot see.
"""
import hashlib
import re
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.intake import Submission

# Below this length a message is too generic for a repeat to mean anything.
_MIN_HASHABLE = 24


def content_hash(*parts: str | None) -> str | None:
    """Digest of the normalised message, stable across trivial edits."""
    text = " ".join(p for p in parts if p)
    normalised = re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()
    if len(normalised) < _MIN_HASHABLE:
        return None
    return hashlib.sha256(normalised.encode()).hexdigest()


async def score_history(
    db: AsyncSession,
    *,
    ip: str | None,
    email: str | None,
    digest: str | None,
    source_id=None,
    window_min: int = 60,
) -> tuple[int, list[str]]:
    """Score a submission on what else has arrived around it."""
    score = 0
    reasons: list[str] = []
    since = datetime.now(timezone.utc) - timedelta(minutes=window_min)

    if ip:
        # Deliberately across ALL sources: the per-source rate limit already
        # covers one site, and a bot spreading itself thin across ten sites is
        # exactly the case that limit misses.
        recent = await db.scalar(
            select(func.count(Submission.id)).where(
                Submission.ip == ip, Submission.created_at >= since
            )
        ) or 0
        if recent >= 20:
            score += 45
            reasons.append(f"{recent} submissions from this IP in the last hour")
        elif recent >= 8:
            score += 25
            reasons.append(f"{recent} submissions from this IP in the last hour")
        elif recent >= 4:
            score += 10
            reasons.append(f"{recent} submissions from this IP in the last hour")

    if digest:
        sources = await db.scalar(
            select(func.count(func.distinct(Submission.source_id))).where(
                Submission.content_hash == digest, Submission.created_at >= since
            )
        ) or 0
        if sources >= 2:
            score += 40
            reasons.append(f"Identical message sent to {sources} of our websites")
        else:
            repeats = await db.scalar(
                select(func.count(Submission.id)).where(
                    Submission.content_hash == digest,
                    Submission.created_at >= since,
                )
            ) or 0
            if repeats >= 3:
                score += 20
                reasons.append(f"Identical message received {repeats} times recently")

    if email and "@" in email:
        prior_spam = await db.scalar(
            select(func.count(Submission.id)).where(
                Submission.email == email, Submission.status == "spam"
            )
        ) or 0
        if prior_spam >= 3:
            score += 35
            reasons.append("Sender previously marked as spam")
        elif prior_spam >= 1:
            score += 15
            reasons.append("Sender previously marked as spam")

    return min(100, score), reasons


async def ip_rate_exceeded(db: AsyncSession, ip: str | None, per_min: int = 30) -> bool:
    """Hard per-IP ceiling, complementing the existing per-source limit."""
    if not ip or per_min <= 0:
        return False
    since = datetime.now(timezone.utc) - timedelta(minutes=1)
    recent = await db.scalar(
        select(func.count(Submission.id)).where(
            Submission.ip == ip, Submission.created_at >= since
        )
    ) or 0
    return recent >= per_min

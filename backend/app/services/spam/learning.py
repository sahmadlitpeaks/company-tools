"""A filter that learns from the decisions the team already makes.

Every release from quarantine is a "this was real" judgement and every
mark-as-spam is the opposite. Recording which words accompany each verdict costs
nothing and adapts to the junk these particular sites attract, which a fixed
keyword list never does.

Deliberately conservative: it only contributes once a token has been seen
enough times to mean something, and its total influence is capped so a
mislabelled message cannot poison the pipeline.
"""
import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.intake import SpamToken

_TOKEN_RE = re.compile(r"[a-z][a-z0-9'\-]{2,19}")
_MAX_TOKENS = 60
# A token needs this many sightings before it is allowed to move a score.
_MIN_OBSERVATIONS = 5
_MAX_CONTRIBUTION = 30


def tokenize(*parts: str | None) -> list[str]:
    text = " ".join(p for p in parts if p).lower()
    seen: list[str] = []
    for match in _TOKEN_RE.findall(text):
        if match not in seen:
            seen.append(match)
        if len(seen) >= _MAX_TOKENS:
            break
    return seen


async def score_tokens(db: AsyncSession, tokens: list[str]) -> tuple[int, list[str]]:
    """Score text against what the team has previously judged."""
    if not tokens:
        return 0, []
    rows = (
        await db.execute(select(SpamToken).where(SpamToken.token.in_(tokens)))
    ).scalars().all()

    spammy: list[tuple[float, str]] = []
    hammy = 0
    for row in rows:
        total = (row.spam_count or 0) + (row.ham_count or 0)
        if total < _MIN_OBSERVATIONS:
            continue
        ratio = (row.spam_count or 0) / total
        if ratio >= 0.85:
            spammy.append((ratio, row.token))
        elif ratio <= 0.15:
            hammy += 1

    score = 0
    reasons: list[str] = []
    if spammy:
        spammy.sort(reverse=True)
        score = min(_MAX_CONTRIBUTION, 8 * len(spammy))
        reasons.append(
            "Wording matches previously-rejected messages: "
            + ", ".join(t for _, t in spammy[:4])
        )
    if hammy >= 3:
        score -= min(15, 5 * (hammy // 3))
        reasons.append("Wording matches previously-accepted enquiries")
    return score, reasons


async def learn(db: AsyncSession, tokens: list[str], *, is_spam: bool) -> None:
    """Record a human verdict. The caller owns the transaction."""
    if not tokens:
        return
    existing = {
        row.token: row
        for row in (
            await db.execute(select(SpamToken).where(SpamToken.token.in_(tokens)))
        ).scalars().all()
    }
    for token in tokens:
        row = existing.get(token)
        if row is None:
            row = SpamToken(token=token, spam_count=0, ham_count=0)
            db.add(row)
            existing[token] = row
        if is_spam:
            row.spam_count = (row.spam_count or 0) + 1
        else:
            row.ham_count = (row.ham_count or 0) + 1

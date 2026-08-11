"""Stateless heuristics scoring a single submission on its content alone.

This is one layer of the screen. It cannot see how often an address has written
in, whether the same message just hit four other websites, or whether a human
already judged similar text — those live in the sibling modules and are combined
by ``spam.screen()``.

Returns a 0–100 score and human-readable reasons. Two thresholds drive the
quarantine flow: at/above SPAM_THRESHOLD -> spam; at/below CLEAN_THRESHOLD ->
released as a real lead (`new`); in between -> stays `quarantined` for review.
"""
import re

SPAM_THRESHOLD = 60
CLEAN_THRESHOLD = 25

# Common hidden honeypot field names — if a bot fills one, it's spam.
HONEYPOT_FIELDS = {"_gotcha", "honeypot", "_hp", "hp", "url_website", "website_url", "fax"}
DISPOSABLE_DOMAINS = {
    "mailinator.com", "tempmail.com", "10minutemail.com", "guerrillamail.com",
    "trashmail.com", "yopmail.com", "sharklasers.com", "getnada.com",
    "temp-mail.org", "throwawaymail.com", "maildrop.cc", "fakeinbox.com",
    "dispostable.com", "mailnesia.com", "spam4.me", "grr.la",
}
SPAM_WORDS = {
    "viagra", "casino", "porn", "bitcoin", "crypto", "forex", "loan", "seo",
    "backlink", "ranking", "cheap", "free money", "work from home", "weight loss",
    "click here", "limited offer", "earn $", "make money", "guest post",
    "link building", "web design offer", "increase traffic", "first page of google",
}
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_URL_RE = re.compile(r"https?://|www\.", re.IGNORECASE)
# Cyrillic only. Deliberately NOT a general "non-Latin" check: Arabic names and
# company names are entirely normal for this business, and flagging them would
# quarantine real customers.
_CYRILLIC_RE = re.compile(r"[Ѐ-ӿ]")
_CONSONANT_RUN_RE = re.compile(r"[bcdfghjklmnpqrstvwxz]{6,}", re.IGNORECASE)


def _word_pattern(word: str) -> str:
    """Match a spam term as a whole word.

    The old substring check flagged "seo" inside *Seoul* and "loan" inside
    *Sloane*, so ordinary enquiries were being quarantined. Boundaries are only
    applied at ends that are alphanumeric, so terms like "earn $" still match.
    """
    left = r"(?<!\w)" if word[:1].isalnum() else ""
    right = r"(?!\w)" if word[-1:].isalnum() else ""
    return left + re.escape(word) + right


_SPAM_WORD_RES = {w: re.compile(_word_pattern(w), re.IGNORECASE) for w in SPAM_WORDS}


def _looks_gibberish(text: str) -> bool:
    """Keyboard-mash detection for name-ish fields ("asdkjhqwe")."""
    for token in re.findall(r"[A-Za-z]{5,}", text or ""):
        if _CONSONANT_RUN_RE.search(token):
            return True
        if not re.search(r"[aeiouy]", token, re.IGNORECASE):
            return True
    return False


def score_submission(
    *,
    name: str | None,
    email: str | None,
    phone: str | None,
    subject: str | None,
    message: str | None,
    payload: dict | None,
    extra_words: set[str] | None = None,
    extra_domains: set[str] | None = None,
) -> tuple[int, list[str]]:
    score = 0
    reasons: list[str] = []

    payload = payload or {}
    for k, v in payload.items():
        if k.lower() in HONEYPOT_FIELDS and str(v).strip():
            return 100, ["Honeypot field filled (bot)"]

    text = " ".join(filter(None, [subject, message]))

    links = len(_URL_RE.findall(text))
    if links >= 3:
        score += 45
        reasons.append(f"{links} links in message")
    elif links == 2:
        score += 20
        reasons.append("Multiple links in message")

    # A URL in a name or company box is not something a person does.
    identity = " ".join(filter(None, [name, str(payload.get("company") or "")]))
    if _URL_RE.search(identity):
        score += 30
        reasons.append("Link in a name or company field")

    words = set(SPAM_WORDS) | set(extra_words or set())
    hits = sorted({
        w for w in words
        if (_SPAM_WORD_RES.get(w) or re.compile(_word_pattern(w), re.IGNORECASE)).search(text)
    })
    if hits:
        score += min(45, 15 * len(hits))
        reasons.append("Spam keywords: " + ", ".join(hits[:5]))

    if not (email and email.strip()) and not (phone and phone.strip()):
        score += 30
        reasons.append("No email or phone")
    elif email and not _EMAIL_RE.match(email.strip()):
        score += 25
        reasons.append("Invalid email format")

    if email and "@" in email:
        domain = email.split("@")[-1].strip().lower()
        if domain in (DISPOSABLE_DOMAINS | set(extra_domains or set())):
            score += 40
            reasons.append(f"Disposable email domain ({domain})")

    if phone and phone.strip():
        digits = re.sub(r"\D", "", phone)
        if len(digits) < 6:
            score += 10
            reasons.append("Implausible phone number")

    if message and len(message) > 40:
        letters = [c for c in message if c.isalpha()]
        if letters and sum(c.isupper() for c in letters) / len(letters) > 0.7:
            score += 10
            reasons.append("Mostly uppercase")

    if _CYRILLIC_RE.search(name or "") or _CYRILLIC_RE.search(text):
        score += 15
        reasons.append("Cyrillic text")

    if _looks_gibberish(name or ""):
        score += 15
        reasons.append("Name looks auto-generated")

    # Dumb bots paste the same string into every box they find.
    values = [
        str(v).strip().lower()
        for v in [name, email, phone, subject, message]
        if v and str(v).strip()
    ]
    if len(values) >= 3 and len(set(values)) == 1:
        score += 25
        reasons.append("Every field holds the same value")

    if not (name and name.strip()) and not (message and message.strip()):
        score += 20
        reasons.append("Empty name and message")

    return min(100, score), reasons


def status_for(
    score: int,
    spam_threshold: int | None = None,
    clean_threshold: int | None = None,
) -> str:
    spam_t = SPAM_THRESHOLD if spam_threshold is None else spam_threshold
    clean_t = CLEAN_THRESHOLD if clean_threshold is None else clean_threshold
    if score >= spam_t:
        return "spam"
    if score <= clean_t:
        return "new"
    return "quarantined"

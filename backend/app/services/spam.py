"""Heuristic spam screening for inbound submissions.

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
}
SPAM_WORDS = {
    "viagra", "casino", "porn", "bitcoin", "crypto", "forex", "loan", "seo",
    "backlink", "ranking", "cheap", "free money", "work from home", "weight loss",
    "click here", "limited offer", "earn $", "make money",
}
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_URL_RE = re.compile(r"https?://|www\.", re.IGNORECASE)


def score_submission(
    *,
    name: str | None,
    email: str | None,
    phone: str | None,
    subject: str | None,
    message: str | None,
    payload: dict | None,
) -> tuple[int, list[str]]:
    score = 0
    reasons: list[str] = []

    payload = payload or {}
    for k, v in payload.items():
        if k.lower() in HONEYPOT_FIELDS and str(v).strip():
            return 100, ["Honeypot field filled (bot)"]

    text = " ".join(filter(None, [subject, message]))
    low = text.lower()

    links = len(_URL_RE.findall(text))
    if links >= 3:
        score += 45
        reasons.append(f"{links} links in message")
    elif links == 2:
        score += 20
        reasons.append("Multiple links in message")

    hits = sorted({w for w in SPAM_WORDS if w in low})
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
        if domain in DISPOSABLE_DOMAINS:
            score += 40
            reasons.append(f"Disposable email domain ({domain})")

    if message and len(message) > 40:
        letters = [c for c in message if c.isalpha()]
        if letters and sum(c.isupper() for c in letters) / len(letters) > 0.7:
            score += 10
            reasons.append("Mostly uppercase")

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

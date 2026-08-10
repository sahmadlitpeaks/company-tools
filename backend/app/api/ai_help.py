import re

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.models.user import User
from app.models.workplace import KnowledgeArticle

router = APIRouter(prefix="/ai", tags=["ai-help"])

# Local providers often list embedding/utility models next to chat models.
_NON_CHAT_HINTS = (
    "embed",
    "embedding",
    "sentence-transformer",
    "rerank",
    "clip",
    "whisper",
    "tts",
    "stt",
)


class AskIn(BaseModel):
    question: str = Field(min_length=2)
    model: str | None = Field(default=None, max_length=256)


def _ai_ready() -> bool:
    return bool(settings.AI_BASE_URL and settings.AI_API_KEY)


def _api_root() -> str:
    base = settings.AI_BASE_URL.rstrip("/")
    if base.endswith("/chat/completions"):
        base = base[: -len("/chat/completions")]
    return base.rstrip("/")


def _auth_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {settings.AI_API_KEY}"}


def _looks_like_chat_model(model_id: str) -> bool:
    lowered = model_id.lower()
    return not any(hint in lowered for hint in _NON_CHAT_HINTS)


async def list_remote_models() -> list[str]:
    """Fetch model ids from the OpenAI-compatible /models endpoint (Jan, Ollama, etc.)."""
    if not _ai_ready():
        return []
    url = f"{_api_root()}/models"
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(url, headers=_auth_headers())
        r.raise_for_status()
        payload = r.json()
    raw = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(raw, list):
        return []
    ids: list[str] = []
    seen: set[str] = set()
    for item in raw:
        model_id = item.get("id") if isinstance(item, dict) else None
        if not model_id or not isinstance(model_id, str):
            continue
        model_id = model_id.strip()
        if not model_id or model_id in seen or not _looks_like_chat_model(model_id):
            continue
        seen.add(model_id)
        ids.append(model_id)
    return ids


async def call_model(messages: list[dict], model: str) -> str:
    url = f"{_api_root()}/chat/completions"
    # Prefer direct answers over hidden "thinking" tokens (Gemma 4 / Qwen etc.).
    # Jan's UI often feels faster because thinking is off or shorter there.
    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.2,
        "max_tokens": 400,
        # OpenAI-style + llama.cpp / Jan template knobs (ignored if unsupported).
        "reasoning_effort": "low",
        "chat_template_kwargs": {"enable_thinking": False},
        "enable_thinking": False,
    }
    async with httpx.AsyncClient(timeout=90) as client:
        r = await client.post(url, headers=_auth_headers(), json=payload)
        r.raise_for_status()
        message = r.json()["choices"][0]["message"]
        # Prefer final answer content; never surface hidden reasoning to the UI.
        content = message.get("content") or ""
        return content


def _question_terms(question: str) -> list[str]:
    return [
        w
        for w in re.findall(r"[A-Za-z0-9\u0600-\u06ff]+", question.lower())
        if len(w) >= 3
    ][:16]


async def _load_articles(db: AsyncSession, terms: list[str]) -> list[KnowledgeArticle]:
    published = KnowledgeArticle.is_published.is_(True)
    order = (KnowledgeArticle.pinned.desc(), KnowledgeArticle.updated_at.desc())

    if terms:
        clauses = [
            or_(
                KnowledgeArticle.title.ilike(f"%{w}%"),
                KnowledgeArticle.body.ilike(f"%{w}%"),
                KnowledgeArticle.category.ilike(f"%{w}%"),
            )
            for w in terms
        ]
        matched = (
            (
                await db.execute(
                    select(KnowledgeArticle)
                    .where(published, or_(*clauses))
                    .order_by(*order)
                    .limit(4)
                )
            )
            .scalars()
            .all()
        )
        if matched:
            return list(matched)

    # Fallback: a few recent articles only (smaller prompt = faster local inference).
    return list(
        (
            await db.execute(
                select(KnowledgeArticle).where(published).order_by(*order).limit(3)
            )
        )
        .scalars()
        .all()
    )


def _build_context(articles: list[KnowledgeArticle]) -> tuple[str, list[KnowledgeArticle]]:
    context = ""
    used: list[KnowledgeArticle] = []
    for article in articles:
        chunk = f"\n[ARTICLE {article.id}] {article.title}\n{article.body}\n"
        if len(context) + len(chunk) > settings.AI_MAX_CONTEXT_CHARS:
            break
        context += chunk
        used.append(article)
    return context, used


def _resolve_model(requested: str | None, available: list[str]) -> str:
    requested = (requested or "").strip()
    default = (settings.AI_MODEL or "").strip()
    if requested:
        return requested
    if default:
        return default
    if available:
        return available[0]
    raise HTTPException(422, "No AI model selected. Choose a model or set AI_MODEL.")


@router.get("/status")
async def status(_: User = Depends(get_current_user)):
    if not _ai_ready():
        return {
            "enabled": False,
            "model": None,
            "models": [],
            "reason": "AI credentials are not configured",
        }

    models: list[str] = []
    models_error: str | None = None
    try:
        models = await list_remote_models()
    except httpx.HTTPError as exc:
        models_error = f"Could not list local models: {exc}"

    default = (settings.AI_MODEL or "").strip()
    if default and default not in models:
        models = [default, *models]

    return {
        "enabled": True,
        "model": default or (models[0] if models else None),
        "models": models,
        "reason": models_error,
    }


@router.post("/ask")
async def ask(
    body: AskIn,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    if not _ai_ready():
        raise HTTPException(503, "AI help is disabled because credentials are not configured")

    question = body.question.strip()
    if len(question) > settings.AI_MAX_INPUT_CHARS:
        raise HTTPException(422, "Question is too long")

    try:
        available = await list_remote_models()
    except httpx.HTTPError:
        available = []
    model = _resolve_model(body.model, available)

    terms = _question_terms(question)
    articles = await _load_articles(db, terms)
    context, used = _build_context(articles)

    if used:
        system = (
            "Company AI help. Answer immediately — no chain-of-thought, no planning steps. "
            "Prefer the supplied knowledge articles. Keep it short (a few sentences or bullets). "
            "Use simple Markdown. If articles do not cover the question, answer briefly from "
            "general knowledge and start with: \"(Not from company knowledge base)\"."
        )
        user_content = f"Question: {question}\n\nPublished company articles:{context}"
    else:
        system = (
            "Company AI help. Answer immediately — no chain-of-thought. "
            "Keep it short. Use simple Markdown."
        )
        user_content = question

    try:
        answer = await call_model(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": user_content},
            ],
            model=model,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"Local AI model request failed: {exc}") from exc
    except (KeyError, IndexError, TypeError) as exc:
        raise HTTPException(502, "Local AI model returned an unexpected response") from exc

    answer = (answer or "").strip()
    if not answer:
        raise HTTPException(502, "Local AI model returned an empty answer")

    grounded = bool(used) and not answer.lower().startswith("(not from company knowledge base)")
    return {
        "answer": answer,
        "supported": grounded,
        "model": model,
        "citations": [
            {"id": str(a.id), "title": a.title, "href": f"/knowledge?open={a.id}"}
            for a in used
        ]
        if grounded
        else [],
    }

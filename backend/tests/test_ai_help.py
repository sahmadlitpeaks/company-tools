import pytest

pytestmark = pytest.mark.asyncio


async def test_ai_status_disabled_without_credentials(client, auth, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "AI_BASE_URL", "")
    monkeypatch.setattr(settings, "AI_API_KEY", "")
    monkeypatch.setattr(settings, "AI_MODEL", "")
    r = await client.get("/api/ai/status", headers=auth)
    assert r.json()["enabled"] is False and "credentials" in r.json()["reason"]
    assert (await client.post("/api/ai/ask", headers=auth, json={"question": "Policy?"})).status_code == 503


async def test_ai_uses_published_kb_and_can_answer_generally(client, auth, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "AI_BASE_URL", "https://ai.example")
    monkeypatch.setattr(settings, "AI_API_KEY", "secret")
    monkeypatch.setattr(settings, "AI_MODEL", "test-model")

    article = (
        await client.post(
            "/api/knowledge",
            headers=auth,
            json={
                "title": "Remote work policy",
                "body": "Employees may work remotely on Fridays with manager approval.",
                "category": "Policy",
                "is_published": True,
            },
        )
    ).json()

    async def supported(messages, model):
        assert model == "test-model"
        assert "Employees may work remotely" in messages[1]["content"]
        return "Remote work on Fridays requires manager approval."

    monkeypatch.setattr("app.api.ai_help.call_model", supported)
    monkeypatch.setattr("app.api.ai_help.list_remote_models", lambda: _async_models(["test-model", "other"]))

    r = await client.post(
        "/api/ai/ask",
        headers=auth,
        json={"question": "What is the remote work Friday policy?"},
    )
    assert r.status_code == 200 and r.json()["supported"] is True
    assert r.json()["model"] == "test-model"
    assert any(c["id"] == article["id"] for c in r.json()["citations"])

    async def general(messages, model):
        assert model == "other"
        assert "Question:" in messages[1]["content"]
        return "(Not from company knowledge base) Submarine propellers are specialized hardware."

    monkeypatch.setattr("app.api.ai_help.call_model", general)
    refusal = (
        await client.post(
            "/api/ai/ask",
            headers=auth,
            json={"question": "How do I repair a submarine propeller?", "model": "other"},
        )
    ).json()
    assert refusal["supported"] is False
    assert refusal["model"] == "other"
    assert "Submarine" in refusal["answer"]
    assert refusal["citations"] == []


async def test_ai_status_lists_models(client, auth, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "AI_BASE_URL", "https://ai.example/v1")
    monkeypatch.setattr(settings, "AI_API_KEY", "secret")
    monkeypatch.setattr(settings, "AI_MODEL", "default-model")
    monkeypatch.setattr(
        "app.api.ai_help.list_remote_models",
        lambda: _async_models(["Gemma-4-12B-It", "default-model", "sentence-transformer-mini"]),
    )
    # list_remote_models already filters non-chat, so return chat-only here.
    monkeypatch.setattr(
        "app.api.ai_help.list_remote_models",
        lambda: _async_models(["Gemma-4-12B-It", "default-model"]),
    )
    r = await client.get("/api/ai/status", headers=auth)
    body = r.json()
    assert body["enabled"] is True
    assert body["model"] == "default-model"
    assert body["models"] == ["Gemma-4-12B-It", "default-model"]


async def _async_models(models: list[str]):
    return models

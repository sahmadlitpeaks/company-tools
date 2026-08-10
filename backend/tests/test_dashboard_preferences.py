import pytest

from helpers import make_member

pytestmark = pytest.mark.asyncio


async def test_dashboard_preferences_persist_and_reset(client, auth):
    hdr, _ = await make_member(client, auth, "dash-pref@agholding.net")
    default = (await client.get("/api/me/dashboard-preferences", headers=hdr)).json()
    assert default["is_default"] is True
    assert default["widget_order"][0] == "clock"

    saved = await client.put(
        "/api/me/dashboard-preferences",
        headers=hdr,
        json={
            "widget_order": ["announcements", "clock", "unknown"],
            "hidden_widgets": ["leave", "unknown"],
        },
    )
    assert saved.status_code == 200
    assert saved.json()["widget_order"][:2] == ["announcements", "clock"]
    assert saved.json()["hidden_widgets"] == ["leave"]

    again = (await client.get("/api/me/dashboard-preferences", headers=hdr)).json()
    assert again["is_default"] is False
    assert again["widget_order"][:2] == ["announcements", "clock"]

    reset = (await client.delete("/api/me/dashboard-preferences", headers=hdr)).json()
    assert reset["is_default"] is True and reset["hidden_widgets"] == []

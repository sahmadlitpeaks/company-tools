import pytest

from helpers import make_member

pytestmark = pytest.mark.asyncio


async def test_enps_survey_flow(client, auth):
    emp1, _ = await make_member(client, auth, "eng-a@agholding.net")
    emp2, _ = await make_member(client, auth, "eng-b@agholding.net")

    # HR creates an eNPS survey (auto-seeds the nps + text questions).
    s = (await client.post("/api/engagement/surveys", headers=auth, json={
        "title": "Q2 eNPS", "kind": "enps", "anonymous": True,
    })).json()
    assert s["status"] == "draft"
    qs = s["questions"]
    nps_q = next(q for q in qs if q["qtype"] == "nps")
    text_q = next(q for q in qs if q["qtype"] == "text")

    # Not open yet → responding fails.
    r = await client.post(f"/api/engagement/surveys/{s['id']}/respond", headers=emp1, json={"answers": []})
    assert r.status_code == 409

    await client.patch(f"/api/engagement/surveys/{s['id']}", headers=auth, json={"status": "open"})
    # Members only see open surveys.
    visible = (await client.get("/api/engagement/surveys", headers=emp1)).json()
    assert any(x["id"] == s["id"] for x in visible)

    # Two responses: a promoter (10) and a detractor (3) → eNPS = 0.
    assert (await client.post(f"/api/engagement/surveys/{s['id']}/respond", headers=emp1, json={
        "answers": [{"question_id": nps_q["id"], "value_num": 10},
                    {"question_id": text_q["id"], "value_text": "Love it"}],
    })).status_code == 201
    assert (await client.post(f"/api/engagement/surveys/{s['id']}/respond", headers=emp2, json={
        "answers": [{"question_id": nps_q["id"], "value_num": 3}],
    })).status_code == 201

    res = (await client.get(f"/api/engagement/surveys/{s['id']}/results", headers=auth)).json()
    assert res["response_count"] == 2
    nps_result = next(q for q in res["questions"] if q["qtype"] == "nps")
    assert nps_result["enps"] == 0.0
    text_result = next(q for q in res["questions"] if q["qtype"] == "text")
    assert "Love it" in text_result["text_answers"]

    # Members can't view results.
    assert (await client.get(f"/api/engagement/surveys/{s['id']}/results", headers=emp1)).status_code == 403


async def test_non_anonymous_blocks_double_response(client, auth):
    emp, _ = await make_member(client, auth, "eng-c@agholding.net")
    s = (await client.post("/api/engagement/surveys", headers=auth, json={
        "title": "Named pulse", "kind": "custom", "anonymous": False,
        "questions": [{"text": "Rate today", "qtype": "scale"}],
    })).json()
    await client.patch(f"/api/engagement/surveys/{s['id']}", headers=auth, json={"status": "open"})
    qid = s["questions"][0]["id"]
    a = await client.post(f"/api/engagement/surveys/{s['id']}/respond", headers=emp, json={"answers": [{"question_id": qid, "value_num": 4}]})
    assert a.status_code == 201
    b = await client.post(f"/api/engagement/surveys/{s['id']}/respond", headers=emp, json={"answers": [{"question_id": qid, "value_num": 5}]})
    assert b.status_code == 409


async def test_kudos_flow(client, auth):
    giver, giver_id = await make_member(client, auth, "kudos-giver@agholding.net")
    _, receiver_id = await make_member(client, auth, "kudos-recv@agholding.net")

    # Can't kudos yourself.
    assert (await client.post("/api/engagement/kudos", headers=giver, json={
        "to_user_id": giver_id, "message": "me!",
    })).status_code == 422

    k = await client.post("/api/engagement/kudos", headers=giver, json={
        "to_user_id": receiver_id, "message": "Great work on the launch", "value_tag": "Ownership",
    })
    assert k.status_code == 201 and k.json()["to_name"] and k.json()["from_name"]

    feed = (await client.get("/api/engagement/kudos", headers=giver)).json()
    assert any(x["message"] == "Great work on the launch" for x in feed)
    mine = (await client.get(f"/api/engagement/kudos?user_id={receiver_id}", headers=giver)).json()
    assert len(mine) == 1

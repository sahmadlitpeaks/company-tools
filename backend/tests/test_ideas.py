import pytest
from helpers import make_member
pytestmark=pytest.mark.asyncio
async def test_idea_votes_comments_and_moderation(client,auth):
 member,_=await make_member(client,auth,"ideator@agholding.net")
 idea=(await client.post("/api/ideas",headers=member,json={"title":"Quiet room","description":"Add a quiet room","kind":"idea"})).json()
 assert idea["status"]=="submitted"
 assert (await client.post(f"/api/ideas/{idea['id']}/vote",headers=member)).json()["vote_count"]==1
 assert (await client.post(f"/api/ideas/{idea['id']}/vote",headers=member)).json()["vote_count"]==0
 assert (await client.post(f"/api/ideas/{idea['id']}/comments",headers=auth,json={"body":"Reviewing"})).status_code==201
 assert (await client.post(f"/api/ideas/{idea['id']}/status",headers=member,json={"status":"planned"})).status_code==403
 done=await client.post(f"/api/ideas/{idea['id']}/status",headers=auth,json={"status":"planned"})
 assert done.status_code==200 and done.json()["status"]=="planned"
 assert (await client.patch(f"/api/ideas/{idea['id']}",headers=member,json={"title":"Changed","description":"x","kind":"idea"})).status_code==403
 notes=(await client.get("/api/notifications",headers=member)).json()
 assert any(n["category"]=="idea" for n in notes)


async def test_idea_username_and_anonymous_privacy(client, auth):
 member,_=await make_member(client,auth,"private-ideator@agholding.net")
 named=await client.post(
  "/api/ideas",
  headers=member,
  json={
   "title":"Named idea",
   "description":"Show my chosen name",
   "kind":"idea",
   "username":"Workshop Fox",
   "anonymous":False,
  },
 )
 assert named.status_code==201
 assert named.json()["author_name"]=="Workshop Fox"
 assert named.json()["anonymous"] is False

 anonymous=await client.post(
  "/api/ideas",
  headers=member,
  json={
   "title":"Private issue",
   "description":"Do not expose my identity",
   "kind":"issue",
   "username":"Must not leak",
   "anonymous":True,
  },
 )
 assert anonymous.status_code==201
 body=anonymous.json()
 assert body["author_name"]=="Anonymous"
 assert body["author_id"] is None
 assert body["username"] is None
 assert body["anonymous"] is True

 listed=(await client.get("/api/ideas",headers=auth)).json()
 hidden=next(row for row in listed if row["id"]==body["id"])
 assert hidden["author_name"]=="Anonymous"
 assert hidden["author_id"] is None
 assert hidden["username"] is None

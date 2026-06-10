import pytest

from helpers import make_member

pytestmark = pytest.mark.asyncio


def _doc():
    return {"data": {"title": "Employment Contract", "category": "contract"},
            "files": {"file": ("c.pdf", b"%PDF-1.4 x", "application/pdf")}}


async def test_signature_request_and_sign(client, auth):
    hdr, emp = await make_member(client, auth, "sign-emp@agholding.net")
    doc = (await client.post(f"/api/hr-documents/by-user/{emp}", headers=auth, **_doc())).json()

    # HR requests a signature; employee gets a pending request.
    req = await client.post(f"/api/hr-documents/{doc['id']}/signature-requests", headers=auth)
    assert req.status_code == 201 and req.json()["status"] == "pending"
    rid = req.json()["id"]

    # Duplicate pending request is blocked.
    assert (await client.post(f"/api/hr-documents/{doc['id']}/signature-requests", headers=auth)).status_code == 409

    # Document list reflects the pending status for the employee.
    docs = (await client.get(f"/api/hr-documents/by-user/{emp}", headers=hdr)).json()
    assert docs[0]["signature_status"] == "pending" and docs[0]["signature_request_id"] == rid

    mine = (await client.get("/api/hr-documents/signatures/mine?pending_only=true", headers=hdr)).json()
    assert any(r["id"] == rid and r["document_title"] == "Employment Contract" for r in mine)

    # Someone else cannot sign it; consent is required.
    hdr_other, _ = await make_member(client, auth, "sign-other@agholding.net")
    assert (await client.post(f"/api/hr-documents/signatures/{rid}/sign", headers=hdr_other,
                              json={"typed_name": "Mallory", "consent": True})).status_code == 403
    assert (await client.post(f"/api/hr-documents/signatures/{rid}/sign", headers=hdr,
                              json={"typed_name": "Emp", "consent": False})).status_code == 422

    # The employee signs.
    signed = await client.post(f"/api/hr-documents/signatures/{rid}/sign", headers=hdr,
                               json={"typed_name": "Emp Loyee", "consent": True})
    assert signed.status_code == 200 and signed.json()["status"] == "signed"
    assert signed.json()["signed_at"]

    # Re-signing is rejected; doc now shows signed.
    assert (await client.post(f"/api/hr-documents/signatures/{rid}/sign", headers=hdr,
                              json={"typed_name": "Emp", "consent": True})).status_code == 409
    docs2 = (await client.get(f"/api/hr-documents/by-user/{emp}", headers=auth)).json()
    assert docs2[0]["signature_status"] == "signed"

    # Non-HR, non-signer cannot request signatures.
    assert (await client.post(f"/api/hr-documents/{doc['id']}/signature-requests", headers=hdr_other)).status_code == 403

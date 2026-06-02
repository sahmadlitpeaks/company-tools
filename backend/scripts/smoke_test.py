"""End-to-end smoke test across every module, run against the ASGI app.

Usage (from backend/, with DATABASE_URL pointing at a throwaway DB):
    python -m scripts.smoke_test
"""
import asyncio

import httpx
from httpx import ASGITransport

from app.core.database import Base, engine
import app.models  # noqa: F401
from app.main import app


async def reset_schema() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)


async def main() -> None:
    await reset_schema()
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test"
    ) as c:
        # ---- health ----
        assert (await c.get("/health")).json()["status"] == "ok"

        # ---- auth (dev-login) feature #1 ----
        r = await c.post("/api/auth/dev-login", params={"email": "amir@agholding.net"})
        assert r.status_code == 200, r.text
        token = r.json()["access_token"]
        h = {"Authorization": f"Bearer {token}"}

        me = (await c.get("/api/auth/me", headers=h)).json()
        assert me["is_admin"] is True
        print("auth OK — user:", me["email"])

        # ---- directory ----
        users = (await c.get("/api/users", headers=h)).json()
        assert any(u["email"] == "amir@agholding.net" for u in users)
        print("directory OK —", len(users), "user(s)")

        # ---- digital cards feature #2 ----
        card = (
            await c.post(
                "/api/cards",
                headers=h,
                json={"full_name": "Amir Khan", "title": "Director", "phone": "+9715"},
            )
        ).json()
        assert card["slug"]
        pub = (await c.get(f"/api/public/cards/{card['slug']}")).json()
        assert pub["full_name"] == "Amir Khan"
        lead = (
            await c.post(
                f"/api/public/cards/{card['slug']}/leads",
                json={"name": "Prospect", "email": "p@x.com"},
            )
        ).json()
        assert lead["status"] == "new"
        leads = (await c.get(f"/api/cards/{card['id']}/leads", headers=h)).json()
        assert len(leads) == 1
        qr = await c.get(f"/api/cards/{card['id']}/qr.png", headers=h)
        assert qr.headers["content-type"] == "image/png" and len(qr.content) > 100
        print("cards OK — slug:", card["slug"], "| lead captured | QR", len(qr.content), "bytes")

        # ---- assets / folders feature #3 ----
        folder = (
            await c.post("/api/assets/folders", headers=h, json={"name": "Campaigns"})
        ).json()
        up = await c.post(
            "/api/assets",
            headers=h,
            data={"folder_id": folder["id"]},
            files={"file": ("note.txt", b"hello world", "text/plain")},
        )
        assert up.status_code == 201, up.text
        dl = await c.get(f"/api/assets/{up.json()['id']}/download", headers=h)
        assert dl.content == b"hello world"
        print("assets OK — folder + upload + download")

        # ---- branding feature #4 ----
        kit = (
            await c.post(
                "/api/branding/kits",
                headers=h,
                json={"name": "AG Holding", "primary_colors": "[{\"hex\":\"#0b5cab\"}]"},
            )
        ).json()
        ba = await c.post(
            f"/api/branding/kits/{kit['id']}/assets",
            headers=h,
            data={"category": "logo"},
            files={"file": ("logo.svg", b"<svg/>", "image/svg+xml")},
        )
        assert ba.status_code == 201, ba.text
        print("branding OK — kit + asset")

        # ---- products / brochures feature #5 ----
        prod = (
            await c.post("/api/products", headers=h, json={"name": "Company Setup"})
        ).json()
        br = await c.post(
            f"/api/products/{prod['id']}/brochures",
            headers=h,
            data={"title": "Setup Guide"},
            files={"file": ("guide.pdf", b"%PDF-1.4 fake", "application/pdf")},
        )
        assert br.status_code == 201, br.text
        pubdl = await c.get(f"/api/public/brochures/{br.json()['id']}/download")
        assert pubdl.status_code == 200
        print("products OK — product + brochure + public download")

        # ---- QR codes feature #5 ----
        qrc = (
            await c.post(
                "/api/qrcodes",
                headers=h,
                json={"label": "Site", "target_url": "https://agholding.net"},
            )
        ).json()
        img = await c.get(f"/api/qrcodes/{qrc['id']}/image.png", headers=h)
        assert img.headers["content-type"] == "image/png"
        prev = await c.get(
            "/api/qrcodes/preview.png", headers=h, params={"data": "hi"}
        )
        assert prev.status_code == 200
        print("qrcodes OK — persisted + preview")

        # ---- landing pages feature #6 ----
        page = (
            await c.post(
                "/api/landing-pages",
                headers=h,
                json={"title": "Summer Promo", "status": "published"},
            )
        ).json()
        pp = await c.get(f"/api/public/landing-pages/{page['slug']}")
        assert pp.status_code == 200 and pp.json()["view_count"] == 1
        print("landing OK — slug:", page["slug"])

        # ---- email signatures feature #7 ----
        tmpl = (
            await c.post(
                "/api/signatures/templates",
                headers=h,
                json={"name": "Default", "html": "<b>{{ full_name }}</b> {{ title }}"},
            )
        ).json()
        sig = (
            await c.post(
                "/api/signatures/render",
                headers=h,
                json={"template_id": tmpl["id"], "data": {}},
            )
        ).json()
        assert "Amir" in (sig["rendered_html"] or "") or "amir" in (sig["rendered_html"] or "")
        print("signatures OK — rendered:", (sig["rendered_html"] or "")[:40])

        # ---- url shortener feature #8 ----
        link = (
            await c.post(
                "/api/short-links",
                headers=h,
                json={"target_url": "https://agholding.net/contact", "campaign": "q2"},
            )
        ).json()
        red = await c.get(f"/s/{link['code']}", follow_redirects=False)
        assert red.status_code == 302 and "agholding.net" in red.headers["location"]
        links = (await c.get("/api/short-links", headers=h)).json()
        assert links[0]["click_count"] == 1
        print("shortener OK — /s/%s -> 302, clicks tracked" % link["code"])

        # ---- secure transfers (encrypted, burn-after-download) ----
        secret = b"top secret contract bytes"
        tr = await c.post(
            "/api/transfers",
            headers=h,
            data={
                "recipient_email": "client@example.com",
                "message": "Here is the NDA.",
                "password": "hunter2",
                "one_time": "true",
                "expires_in_hours": "24",
            },
            files={"file": ("nda.pdf", secret, "application/pdf")},
        )
        assert tr.status_code == 201, tr.text
        body = tr.json()
        token = body["share_url"].rsplit("/", 1)[-1]
        assert body["has_password"] is True

        meta = (await c.get(f"/api/public/transfers/{token}/meta")).json()
        assert meta["status"] == "available" and meta["requires_password"] is True

        # Wrong password rejected.
        bad = await c.post(
            f"/api/public/transfers/{token}/download", json={"password": "nope"}
        )
        assert bad.status_code == 403, bad.text

        # Correct password downloads the decrypted bytes.
        good = await c.post(
            f"/api/public/transfers/{token}/download", json={"password": "hunter2"}
        )
        assert good.status_code == 200 and good.content == secret

        # Burn-after-download: second attempt is gone.
        again = await c.post(
            f"/api/public/transfers/{token}/download", json={"password": "hunter2"}
        )
        assert again.status_code == 410, again.text
        meta2 = (await c.get(f"/api/public/transfers/{token}/meta")).json()
        assert meta2["status"] == "consumed"
        print("transfers OK — encrypted, password-gated, burned after download")

    print("\nALL MODULES PASSED ✅")


if __name__ == "__main__":
    asyncio.run(main())

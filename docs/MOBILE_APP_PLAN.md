# Mobile App — Implementation Plan

> **Status:** in progress. Increments are listed in §4; each one ships on its own
> (models + migration + permission-gated API + tests + frontend, suite green,
> committed) in the same rhythm as the rest of the platform.

**Goal:** put this platform on people's phones. Not as a bookmark to a
desktop-shaped page, but as an installed app with push notifications, camera
capture and controls you can hit with a thumb.

This reverses the earlier scope decision in `HR_ROADMAP.md` — *"Mobile:
responsive web, no native app"*.

---

## 1. Why

A large share of the platform's highest-value workflows are things people do
**away from a desk**:

| Workflow | Where it actually happens |
|---|---|
| Routine Checks — daily IT / Facilities rounds with photo evidence | Walking a building, phone in hand |
| Service Desk — raising a ticket about a broken thing | Standing in front of the broken thing |
| Time Tracking — clock in / out | On arrival, before reaching a desk |
| Expenses — snapping a receipt | At the till, not three weeks later |
| Approvals — approve leave, expenses, sign-off | Between meetings |
| Directory — look someone up and call them | Anywhere |

Today all of these are reachable only through a browser page designed for a
1440px screen. Routine Checks in particular already assumes a phone — it opens
the camera directly (`capture="environment"`) — but everything around it is
desktop-shaped.

## 2. Approach

**Make the existing SPA an installable PWA, then wrap that same build with
Capacitor to produce real iOS/Android binaries.**

One codebase. No second app to maintain alongside 55 existing pages.

The alternative — a purpose-built React Native app — buys a slightly better feel
for a much larger permanent cost: a second UI to keep in sync with every feature
the platform adds. The platform is still growing weekly; a second codebase would
fall behind immediately.

The backend needs almost nothing to support this. It is already bearer-token
based (`Authorization: Bearer`, no cookies, no CSRF), so a native client can call
it today. The real gaps are **session lifetime**, **push** and **touch
ergonomics** — not the protocol.

## 3. What already exists

This plan is mostly wiring, because the foundations are in place:

| Thing | Where | Why it matters |
|---|---|---|
| Bearer-token auth, JSON login | `backend/app/auth/router.py` | Native clients work as-is; CORS is irrelevant to native |
| One notification funnel | `services/notify.py` → `services/dispatch.py` | 48 call sites. Hook push in once, every existing alert gets it |
| Attachment uploader with a `capture` prop | `frontend/src/components/Attachments.tsx` | Camera capture is a one-prop change per call site |
| One shared `Modal` | `frontend/src/components/ui.tsx` | Used by 39 pages — one bottom-sheet variant fixes all of them |
| Density tokens `--fs`, `--ctl-py` | `frontend/src/styles.css` | Touch-target sizing is one media query, not 55 page edits |
| Mobile drawer nav | `frontend/src/components/Layout.tsx` | Off-canvas sidebar already works below 1024px |
| Playwright `mobile` (Pixel 5) project | `frontend/playwright.config.ts` | Mobile regression harness already wired |
| QR asset labels + `?q=` deep-link | `frontend/src/pages/AssetTrackerPage.tsx` | Scanning already deep-links; only an in-app scanner is missing |

## 4. Increments

### 1 — Mobile sessions: refresh tokens

An 8-hour access token with no refresh path means a phone re-logins daily. This
blocks everything else, so it goes first.

A `RefreshToken` table (hash-only storage, mirroring `ApiToken`), rotating
`POST /api/auth/refresh`, and `POST /api/auth/logout` to revoke. `POST /api/auth/login`
gains an optional `device` field; **only when it is present is a refresh token
minted**, so the web flow is untouched.

MFA is verified once at login; refresh does not re-prompt. Revocation is the
control — killing a device kills the session.

### 2 — Push notifications

A `PushDevice` table and `/api/devices` register/list/revoke endpoints, plus a
push channel added to `deliver_notification`. Because every alert in the platform
goes through `notify_user`, this single integration gives push to approvals,
tickets, SLA breaches, late checklist runs, leave decisions and everything else
at once — with the existing per-user muted categories already respected.

Transport is **FCM HTTP v1 for all platforms** (Android natively, iOS via APNs
through FCM, web via FCM's Web Push): one credential, one code path. Off by
default (`PUSH_ENABLED=false`).

### 3 — PWA layer

`vite-plugin-pwa`, a manifest and icon set, and a service worker that precaches
the app shell and serves `/api` GETs NetworkFirst — so a backgrounded app opens
showing last-known data instead of a spinner.

Mutations are deliberately **never queued** in v1. Checklist submission enforces
cross-item validation server-side, so naive offline replay would surface
confusing late failures. v1 shows a clear offline state instead; a real outbox
with idempotency keys is a separate increment if it's wanted.

The client also gains silent token refresh: retry once on 401, and only sign out
if the refresh itself fails.

### 4 — Touch ergonomics

Centralised on purpose — most of this is CSS in one file:

- A coarse-pointer media block raising `--ctl-py` and `--fs`, so buttons clear
  44px and **iOS stops zooming on input focus**.
- Safe-area insets for notched devices.
- A **bottom-sheet variant** of the shared `Modal` — most workflows in this app
  happen inside a modal, and a centred 520px box is the wrong shape on a phone.
- A `.table-stack` pattern that turns table rows into cards on narrow screens,
  applied first to Approvals, Expenses, Service Desk and Leave. The remaining
  table pages keep today's horizontal scroll until converted — this is a pattern
  to repeat, not a big-bang rewrite.
- A **bottom tab bar** on narrow viewports, permission-filtered exactly like the
  sidebar.
- A touch-workable Tasks board: HTML5 drag-and-drop does not fire on touch, so
  coarse pointers get an explicit status control.

### 5 — Native-capability wins

Cheap and high-value: camera capture on expense receipts and ticket attachments,
`tel:` / WhatsApp links in the Directory, and an in-app QR scanner for the Asset
Tracker (native `BarcodeDetector` where available, falling back to today's
OS-camera + `/q/{id}` redirect).

Geolocation on clock-in is **deliberately not included** — tracking staff
location needs an explicit people-policy decision, and it adds a store privacy
declaration.

### 6 — Capacitor shell

iOS and Android projects wrapping the same `dist/` build.

The important decision here is **bundled assets plus a runtime-configurable
server address**. The platform is host-agnostic by design — it auto-derives its
public URLs from whatever host it's reached on — but a store binary can't be
rebuilt per host. So the app ships its web assets inside the binary and asks for
the server address on first run, persisting it. This also survives the platform
moving domains, and avoids Capacitor's remote-URL mode, which Apple treats as a
thin web wrapper.

Native SSO reuses the existing flow: open `/api/auth/login` in an in-app browser
and intercept the `#token=` callback. No backend change needed.

**Distribution is the long pole** and needs starting early: Apple Developer
membership and signing, Google Play console, and — for a login-walled internal
tool — **Apple Business Manager custom app distribution** and **Google Play
internal/managed distribution** rather than public store listings.

### 7 — Docs

`ARCHITECTURE.md`, `HR_ROADMAP.md` (the scope reversal), `README.md` and
`.env.example`.

## 5. Verification

```bash
cd backend && pytest
cd frontend && npm run typecheck && npm run build
docker compose up --build          # http://localhost:8080 must still work unchanged
cd frontend && npx playwright test --project=mobile
```

Plus: a Lighthouse installability audit, an offline-mode check, a forced-expiry
check that the client silently refreshes, `POST /api/notifications/test` arriving
as a real push, and one Routine Check walked end-to-end on a device with a camera
photo.

## 6. Deliberately out of scope

- **Offline mutations** — see increment 3.
- **Geolocation** — needs a policy decision.
- **All 55 modules on a phone.** The mobile experience prioritises field work,
  self-service HR, approvals and the directory. Admin surfaces (webhooks, API
  tokens, approval-workflow design, the landing-page builder) stay
  desktop-shaped; they degrade to horizontal scroll rather than getting a
  bespoke phone layout.

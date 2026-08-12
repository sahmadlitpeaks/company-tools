# Website forms → CRM (WordPress / Contact Form 7)

How leads from our WordPress sites reach this platform, how differing field
names are reconciled, how job applications are separated from sales enquiries,
and how bots are kept out.

This document is also the **contract the WordPress plugin is built against**.
The plugin lives in its own repository; if you change the payload shape here,
change it there too.

---

## Why it works this way

Contact Form 7 lets every site name its fields freely. One site posts
`your-name`/`your-email`, another posts `fullname`/`email-address`, and a form
edited last year posts `tel-123`/`menu-456`. There is no shape we can hardcode.

So the receiving side stores **the submitted body exactly as it arrived**, and
keeps a per-form mapping from those raw names onto the columns the CRM uses.
Because the original is retained, a mapping can be corrected later and replayed
over submissions already received — a mistake costs a re-map, never data.

Everything below is built on the existing intake pipeline
(`backend/app/api/intake.py`), not a parallel one.

---

## Endpoints

All three are public in the routing sense but require the site's API token.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/intake/ingest` | One form submission |
| `POST` | `/api/intake/ingest/schema` | A form's field definitions, pushed when the site owner saves the form |
| `GET` | `/api/intake/ingest/ping` | Connectivity check for the plugin's settings screen |

They deliberately return ids and counts only. A valid token is not an admin
session, so no endpoint here reveals another site's data, a form catalogue, or
any secret.

### Authentication

```
Authorization: Bearer <site key>      (or  X-API-Key: <site key>)
X-Timestamp:   <unix seconds>
X-Signature:   sha256=<hex HMAC-SHA256 of "{timestamp}.{raw body}">
```

The key identifies the site; the signature proves the request was not forged or
replayed. Signing covers the **exact bytes sent**, so a retry must resend the
stored body rather than re-encode it.

- The signing secret is optional per source, but recommended for every site.
- When `X-Timestamp` is present it must be within `signature_ttl_sec`
  (default 300s), which is what stops a captured request being replayed later.
- The older body-only signature (no timestamp) is still accepted, so existing
  integrations keep working. Set **Require timestamp** on the source to close
  that off once a site's plugin is up to date.
- Secrets are shown once on creation and stored encrypted; there is no way to
  read one back.

### Payload — `POST /api/intake/ingest`

```json
{
  "v": 2,
  "external_id": "0f2b8c1e-…",
  "type": "lead",
  "site":  { "url": "https://acme.com", "name": "Acme" },
  "form":  {
    "key": "cf7:17",
    "name": "Contact form 1",
    "provider": "cf7",
    "fields": [
      { "name": "your-name",  "basetype": "text",   "label": "Your name", "required": true },
      { "name": "menu-789",   "basetype": "select", "label": "Budget range",
        "options": ["<10k", "10k+"] }
    ]
  },
  "fields": {
    "your-name": "Jane Roe",
    "your-email": "jane@acme.com",
    "tel-123": "+971 50 123 4567",
    "checkbox-2": ["Sales", "Support"]
  },
  "files": [
    { "field": "cv", "name": "jane-roe.pdf", "mime": "application/pdf",
      "data": "<base64>" }
  ],
  "meta": {
    "page_url": "https://acme.com/contact/",
    "referrer": "https://google.com/",
    "ip": "1.2.3.4",
    "user_agent": "Mozilla/5.0 …",
    "utm": { "utm_source": "google", "utm_campaign": "spring" },
    "elapsed_ms": 8400,
    "captcha_token": "…",
    "spam": false
  }
}
```

Notes on individual keys:

- **`form.key`** must be stable for the life of the form — the mapping hangs off
  it. `cf7:<post id>` is the convention.
- **`form.fields`** is the field *schema*. Sending it on every submission means
  the mapping editor shows real labels and types, which is the difference
  between an admin seeing `tel-123` and seeing "Phone".
- **`external_id`** makes retries safe. A second POST with the same id returns
  `{"deduped": true}` and the original id instead of creating a duplicate.
- **`fields`** holds the raw submitted values. Lists are fine — a checkbox group
  is joined when it feeds a single column and kept as a list otherwise.
- **`files`** carries CVs inline, base64-encoded. See *Job applications* below.
- **`meta.elapsed_ms`** is the time between the form rendering and submitting.
  Under 3 seconds is treated as automated.
- **`meta.spam`** relays the site's own verdict (Akismet, reCAPTCHA). It is
  weighed as evidence, never obeyed — a flagged submission is held for review,
  not discarded.

Anything the request omits simply carries less signal; nothing here is required
except a form key for per-form mapping to apply.

**The older flat shape still works** and is unchanged:

```json
{ "name": "Jane", "email": "jane@acme.com", "message": "Hello", "budget": "10k" }
```

The envelope is recognised by `v` or a `form` block, so a flat body follows
exactly the path it always did.

### Response

```json
{ "ok": true, "id": "…", "status": "new", "spam_score": 5,
  "mapping_status": "mapped", "form_id": "…" }
```

`status` is `new` (in the inbox), `quarantined` (held for review) or `spam`.
Other outcomes: `{"deduped": true}` for a duplicate, `403` for a blocked
submission, `413` over 256 KB, `429` over the rate limit.

---

## Field mapping

Each form carries a mapping document — a list of ordered rules:

```json
{ "version": 1, "extras": "keep", "rules": [
  { "sources": ["first-name", "last-name"], "target": "name",
    "combine": "join", "join": " ", "transform": ["trim"] },
  { "sources": ["tel-123"], "target": "phone", "transform": ["digits"] }
]}
```

- **`sources`** — one or more raw field names. With `combine: "first"` the first
  non-empty one wins, which gives fallback chains; with `"join"` they are
  concatenated.
- **`target`** — `name`, `email`, `phone`, `company`, `subject`, `message`,
  `page_url`, `type`, or `extra` (keep it out of the columns but in the record).
- **`transform`** — `trim`, `lower`, `upper`, `title`, `digits`, `strip_html`,
  `join_array`, `first_line`, `email_only`.

Edit this at **Web Inbox → Forms → (a form)**. The editor shows each discovered
field with a sample value, because `tel-123` is meaningless without one. Samples
are masked (`j***@acme.com`) so the catalogue does not accumulate contact
details.

### What happens to a form nobody has mapped

1. On first sight, a mapping is **guessed** from the field names, labels and
   declared types. CF7 defaults (`your-name`, `your-email`, `tel-*`, …) and
   common variants (`fullname`, `mobile-number`, `organisation`) are recognised.
   Genuinely ambiguous names — a bare `text-874` or `menu-456` — are
   deliberately **not** guessed: silently mis-filing an answer is worse than
   leaving it for a human.
2. Anything still unmapped is **recovered by shape** — a value that looks like an
   email becomes the email, a run of digits becomes the phone, the longest text
   becomes the message.
3. The result is marked `partial` and shown as "needs review", and every
   recovered field is noted on the submission.

So a brand-new form produces a usable lead on its first submission, and says so.

### Fixing a mapping after the fact

**Preview** runs the draft against real stored submissions and shows the result
plus the resulting spam score. It writes nothing.

**Re-apply mapping** replays the saved mapping over submissions already
received, reading each one's original payload. Triage state — status, assignee,
whether it was converted — is never overwritten. Optionally it also refreshes
contact details on leads already created, leaving owner, value and status alone.

Submissions received before this feature shipped have no stored original and are
skipped.

---

## Routing: job applications vs sales enquiries

A careers form and a contact form arrive identically. Which is which is decided
here, at **Web Inbox → Routing & Filtering**, so nobody has to touch WordPress
when the business changes its mind.

Rules are ordered; the first match wins. A rule tests the page URL, the form key
or name, any submitted field, the subject/message, or the type — and sets what
the submission *is* and where it goes.

```
When Page URL contains "/careers"  →  Create a recruiting candidate, as job application
When field "enquiry-type" is exactly "Careers"  →  Create a recruiting candidate
```

Destinations are `crm_lead`, `candidate`, `ticket` and `inbox_only`. A form also
has its own default destination for the simple case where one form is always one
thing.

### Job applications

Applications become **`Candidate` records in Recruiting**, never CRM leads —
enforced on the automatic path and on manual conversion alike. That keeps the
sales pipeline meaningful, and because the `recruiting` module is not granted to
managers by default, it is also what keeps applicant data and CVs away from the
sales team.

`Candidate.job_id` is mandatory, so the opening is resolved in order:

1. a `job_id` set on the matching rule, or pinned on the form;
2. a field named by `job_from_field` (e.g. "Position applied for") matched
   against open job titles;
3. a **General Applications** opening, created once if it does not exist.

An application is never rejected because we could not work out the role.

**CVs** arrive inline as base64 (PDF, Word, RTF, ODT or text, up to 10 MB) and
are stored against the candidate. CF7 deletes its own upload temp files right
after mail is sent, which is why the file travels with the submission rather
than as a link. If a CV is too large or an unaccepted type, the application
still lands and the reason is recorded on the candidate — losing an applicant
over an attachment would be the worst possible failure here.

---

## Bot defence

The previous screen read each message on its own: honeypot, link count, a small
English keyword list, disposable domains. A bot filling in a plausible name, a
real address and "I am interested in your services" scored **zero** and was
auto-released as a genuine lead. That is the gap these layers close.

| Layer | What it sees | Outcome |
| --- | --- | --- |
| Blocklist | Operator decisions: IP, range, address, domain, keyword, country, message fingerprint | The only hard reject. Nothing is stored. `allow` always beats `block`. |
| Captcha | A token minted in the visitor's browser, verified server-side | Rejects on failure when `required`; a provider outage quarantines rather than drops |
| Content | The message alone | Score |
| Correlation | The same IP or the same message across **all** our sites, and this sender's history | Score |
| Learning | What the team judged last time it saw wording like this | Score |
| Timing | How long the form took to fill in | Score |

Scores resolve through the existing thresholds: high → `spam`, low → `new`,
in between → `quarantined`. Every contributing signal is written to the
submission's reasons, so the inbox can always explain *why* something was held.
A filter whose decisions cannot be explained gets switched off the first time it
catches a real customer.

Two deliberate choices worth knowing about:

- **Only Cyrillic is treated as a foreign-script signal.** Arabic names and
  company names are entirely normal for this business; flagging them would
  quarantine real customers.
- **Spam terms match as whole words.** The old substring check flagged "seo"
  inside *Seoul* and "loan" inside *Sloane*.

### The learning loop

Releasing a submission from quarantine records "this was real"; marking one as
spam records the opposite. Both update word statistics that feed later scoring,
so the filter adapts to the junk these particular sites attract. A word needs
several sightings before it can move a score, and the total influence is
capped — one mislabelled message cannot poison the pipeline.

### Captcha setup

**Settings → Captcha**: choose Cloudflare Turnstile, reCAPTCHA v3 or hCaptcha,
and paste the secret (stored encrypted, never returned to a browser). Then set
each site's **captcha mode**:

- `off` — ignore any token
- `score` — weigh the verdict into the spam score
- `required` — reject submissions that fail verification

The site key goes in the WordPress plugin; the plugin forwards the resulting
token as `meta.captcha_token`. This is the single most effective layer, but it
needs cooperation from each website — everything else works without touching
WordPress at all.

---

## Connecting a website

1. **Web Inbox → Connected websites → Add**. Give it the site name and URL.
2. Copy the API key. Generate a signing secret and copy it — it is shown once.
3. Install the plugin on the WordPress site and paste the endpoint URL, key and
   secret. Prefer `wp-config.php` constants for the credentials.
4. Press **Test connection** (hits `/ingest/ping`).
5. Submit the form once. It appears under **Forms** with a guessed mapping.
6. Open the form, check each field against its sample value, **Preview**, then
   **Save mapping**. If earlier submissions were mis-mapped, **Re-apply**.
7. Add routing rules if the site has a careers form.
8. Turn on **Auto-convert** once you trust the mapping.

### Plugin implementation notes

For whoever maintains the plugin repository:

- **Capture on `wpcf7_before_send_mail`**, which runs *before* `WPCF7_Mail::send()`.
  `wpcf7_mail_sent` only fires when mail succeeds — on exactly the SMTP failure
  this project exists to replace, the lead would be lost. `wpcf7_mail_failed`
  is useful afterwards to flag `meta.mail_sent`, but must never be the capture
  path.
- Read data from `WPCF7_Submission::get_instance()` — `get_posted_data()`,
  `get_uploaded_files()`, `get_meta('url'|'remote_ip'|'user_agent')`.
- Build `form.fields` from `$contact_form->scan_form_tags()`; CF7 tags carry no
  label, so recover labels by scanning the form template for
  `<label>…[tag-name]…</label>`.
- Push the schema on `wpcf7_after_save` so mapping can be configured before the
  first real enquiry.
- **Queue failures in a real database table**, not an option (options race), and
  drain on WP-Cron with backoff. Store the serialized body, not the array — the
  signature must cover the exact bytes, and re-encoding could reorder keys.
- Use a short timeout (~5s) on the live request so a slow CRM never stalls a
  visitor.

---

## Limits

| Thing | Limit |
| --- | --- |
| Request body | 256 KB (`413` above) |
| Fields per submission | 200 |
| Characters per value | 8 000 |
| Stored original payload | 64 KB (truncated, and marked as such) |
| Forms per website | 100 |
| Attachments | 10 MB |
| Per-source rate | `rate_limit_per_min`, default 60 |
| Per-IP rate | 30/minute across all sites |

---

## Permissions

- Seeing forms, submissions and routing rules needs the **`crm`** module.
- Changing anything that alters how data is interpreted — mappings, rules, the
  blocklist, site credentials — is **admin only**.
- Converting a submission into a candidate needs the **`recruiting`** module.
  CRM access is not access to applicants.

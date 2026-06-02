/**
 * Professional, ready-to-paste email-signature designs.
 *
 * Each renders table-based HTML with **inline styles only** — the format Outlook
 * and Gmail actually accept when you paste a signature into their settings.
 * Rendering is done client-side from the user's directory data + overrides, so
 * the preview is instant and the "Copy HTML" output is exactly what gets pasted.
 */
export interface SigData {
  full_name: string;
  title: string;
  department: string;
  email: string;
  phone: string;
  website: string;
  company: string;
  accent: string;
}

export interface SignatureDesign {
  id: string;
  name: string;
  description: string;
  render: (d: SigData) => string;
}

function esc(s: string): string {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function initials(name: string): string {
  const p = (name || "?").trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "AG";
}

function host(url: string): string {
  if (!url) return "";
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function href(url: string): string {
  if (!url) return "#";
  return /^https?:\/\//.test(url) ? url : `https://${url}`;
}

const FONT = "Arial, Helvetica, sans-serif";

/* ---- Classic: vertical divider, labelled contact column ---- */
const classic: SignatureDesign = {
  id: "classic",
  name: "Classic",
  description: "Two columns with a brand divider",
  render: (d) => `
<table cellpadding="0" cellspacing="0" border="0" style="font-family:${FONT};color:#1a2230;font-size:13px;line-height:1.5">
  <tr>
    <td style="padding-right:18px;border-right:3px solid ${d.accent};vertical-align:top">
      <div style="font-size:17px;font-weight:bold;color:${d.accent}">${esc(d.full_name)}</div>
      <div style="color:#475569;font-size:13px">${esc(d.title)}</div>
      ${d.department ? `<div style="color:#94a3b8;font-size:12px">${esc(d.department)}</div>` : ""}
    </td>
    <td style="padding-left:18px;vertical-align:top">
      <div style="font-weight:bold;margin-bottom:4px">${esc(d.company)}</div>
      ${d.phone ? `<div style="color:#475569">📞 ${esc(d.phone)}</div>` : ""}
      ${d.email ? `<div>✉&nbsp;<a href="mailto:${esc(d.email)}" style="color:#1a2230;text-decoration:none">${esc(d.email)}</a></div>` : ""}
      ${d.website ? `<div>🌐&nbsp;<a href="${esc(href(d.website))}" style="color:${d.accent};text-decoration:none">${esc(host(d.website))}</a></div>` : ""}
    </td>
  </tr>
</table>`.trim(),
};

/* ---- Modern: initials avatar + inline contact row ---- */
const modern: SignatureDesign = {
  id: "modern",
  name: "Modern",
  description: "Avatar badge with an inline contact row",
  render: (d) => `
<table cellpadding="0" cellspacing="0" border="0" style="font-family:${FONT};color:#1a2230;font-size:13px;line-height:1.5">
  <tr>
    <td style="vertical-align:middle;padding-right:16px">
      <div style="width:62px;height:62px;border-radius:50%;background:${d.accent};color:#ffffff;text-align:center;font-size:24px;font-weight:bold;line-height:62px;font-family:${FONT}">${esc(initials(d.full_name))}</div>
    </td>
    <td style="vertical-align:middle">
      <div style="font-size:18px;font-weight:bold">${esc(d.full_name)}</div>
      <div style="color:${d.accent};font-weight:bold;font-size:13px">${esc(d.title)}${d.department ? ` · ${esc(d.department)}` : ""}</div>
      <div style="color:#475569;margin-top:3px">${esc(d.company)}</div>
      <div style="margin-top:7px;font-size:12px;color:#475569">
        ${[
          d.phone ? esc(d.phone) : "",
          d.email ? `<a href="mailto:${esc(d.email)}" style="color:#475569;text-decoration:none">${esc(d.email)}</a>` : "",
          d.website ? `<a href="${esc(href(d.website))}" style="color:${d.accent};text-decoration:none">${esc(host(d.website))}</a>` : "",
        ].filter(Boolean).join(' &nbsp;<span style="color:#cbd5e1">|</span>&nbsp; ')}
      </div>
    </td>
  </tr>
</table>`.trim(),
};

/* ---- Minimal: compact two lines + accent underline ---- */
const minimal: SignatureDesign = {
  id: "minimal",
  name: "Minimal",
  description: "Compact, single block with an accent rule",
  render: (d) => `
<table cellpadding="0" cellspacing="0" border="0" style="font-family:${FONT};color:#1a2230;font-size:13px;line-height:1.5">
  <tr><td>
    <div style="font-size:15px;font-weight:bold">${esc(d.full_name)}</div>
    <div style="color:#64748b;margin-bottom:6px">${esc(d.title)}${d.company ? `, ${esc(d.company)}` : ""}</div>
    <div style="font-size:12px;color:#475569">
      ${[
        d.phone ? esc(d.phone) : "",
        d.email ? `<a href="mailto:${esc(d.email)}" style="color:${d.accent};text-decoration:none">${esc(d.email)}</a>` : "",
        d.website ? `<a href="${esc(href(d.website))}" style="color:${d.accent};text-decoration:none">${esc(host(d.website))}</a>` : "",
      ].filter(Boolean).join(" &nbsp;·&nbsp; ")}
    </div>
    <div style="height:3px;width:64px;background:${d.accent};margin-top:8px"></div>
  </td></tr>
</table>`.trim(),
};

/* ---- Banner: bordered card with a coloured company bar ---- */
const banner: SignatureDesign = {
  id: "banner",
  name: "Banner",
  description: "Bordered card with a branded header bar",
  render: (d) => `
<table cellpadding="0" cellspacing="0" border="0" style="font-family:${FONT};color:#1a2230;font-size:13px;line-height:1.5;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
  <tr><td style="background:${d.accent};padding:9px 16px;color:#ffffff;font-weight:bold;letter-spacing:.02em">${esc(d.company)}</td></tr>
  <tr><td style="padding:14px 16px">
    <div style="font-size:16px;font-weight:bold">${esc(d.full_name)}</div>
    <div style="color:#64748b">${esc(d.title)}${d.department ? ` · ${esc(d.department)}` : ""}</div>
    <div style="margin-top:9px;font-size:12px;color:#475569">
      ${d.email ? `✉&nbsp;<a href="mailto:${esc(d.email)}" style="color:#475569;text-decoration:none">${esc(d.email)}</a><br>` : ""}
      ${d.phone ? `📞&nbsp;${esc(d.phone)}<br>` : ""}
      ${d.website ? `🌐&nbsp;<a href="${esc(href(d.website))}" style="color:${d.accent};text-decoration:none">${esc(host(d.website))}</a>` : ""}
    </div>
  </td></tr>
</table>`.trim(),
};

export const SIGNATURE_DESIGNS: SignatureDesign[] = [classic, modern, minimal, banner];

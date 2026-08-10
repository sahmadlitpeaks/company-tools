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
  logo_url: string;
  address: string;
  linkedin: string;
  facebook: string;
  instagram: string;
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

function brandAccent(accent: string): string {
  return accent || "#facc15";
}

function contactRow(label: string, value: string, url: string, accent: string): string {
  if (!value) return "";
  const content = url
    ? `<a href="${esc(url)}" style="color:#6b7280;text-decoration:none">${esc(value)}</a>`
    : esc(value);
  return `<tr height="22"><td width="24" style="vertical-align:middle"><span style="display:inline-block;width:14px;color:${brandAccent(accent)};font-size:10px;font-weight:bold">${label}</span></td><td style="padding:0;color:#6b7280;font-size:12px">${content}</td></tr>`;
}

/* ---- Company profile: logo/social column and employee contact details ---- */
const companyProfile: SignatureDesign = {
  id: "company-profile",
  name: "Company profile",
  description: "Official logo, social links, and contact details",
  render: (d) => `
<table cellpadding="0" cellspacing="0" border="0" style="width:530px;max-width:100%;font-family:${FONT};color:#111111;font-size:13px;line-height:1.45">
  <tr>
    <td style="width:150px;padding-right:20px;vertical-align:top;text-align:center">
      ${d.logo_url ? `<img src="${esc(d.logo_url)}" alt="${esc(d.company)}" width="140" style="display:block;max-width:140px;max-height:110px;object-fit:contain;margin:0 auto">` : `<div style="width:140px;height:72px;line-height:72px;background:#f3f4f6;color:${brandAccent(d.accent)};font-size:20px;font-weight:bold;text-align:center">${esc(initials(d.company))}</div>`}
      ${(d.linkedin || d.facebook || d.instagram) ? `<div style="margin-top:12px;color:#6b7280;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:.08em">Follow us</div><div style="margin-top:5px">${[
        d.linkedin ? `<a href="${esc(d.linkedin)}" style="display:inline-block;margin:0 3px;color:${brandAccent(d.accent)};font-size:11px;font-weight:bold;text-decoration:none">in</a>` : "",
        d.facebook ? `<a href="${esc(d.facebook)}" style="display:inline-block;margin:0 3px;color:${brandAccent(d.accent)};font-size:11px;font-weight:bold;text-decoration:none">f</a>` : "",
        d.instagram ? `<a href="${esc(d.instagram)}" style="display:inline-block;margin:0 3px;color:${brandAccent(d.accent)};font-size:11px;font-weight:bold;text-decoration:none">ig</a>` : "",
      ].filter(Boolean).join("")}</div>` : ""}
    </td>
    <td style="border-left:2px solid ${brandAccent(d.accent)};padding-left:20px;vertical-align:middle">
      <div style="margin:0;color:${brandAccent(d.accent)};font-size:24px;font-weight:bold;line-height:1.2">${esc(d.full_name)}</div>
      <div style="margin:4px 0 8px;color:#1f2937;font-size:14px;font-weight:bold">${esc(d.title)}${d.department ? `, ${esc(d.department)}` : ""}</div>
      <table cellpadding="0" cellspacing="0" border="0" style="font-family:${FONT}">
        ${contactRow("T", d.phone, d.phone ? `tel:${d.phone}` : "", d.accent)}
        ${contactRow("E", d.email, d.email ? `mailto:${d.email}` : "", d.accent)}
        ${contactRow("W", host(d.website), d.website ? href(d.website) : "", d.accent)}
        ${contactRow("A", d.address, "", d.accent)}
      </table>
    </td>
  </tr>
</table>`.trim(),
};

function accentForeground(accent: string): string {
  const hex = accent.trim().replace(/^#/, "");
  const value = hex.length === 3
    ? hex.split("").map((digit) => digit + digit).join("")
    : hex;
  if (!/^[0-9a-f]{6}$/i.test(value)) return "#111111";
  const red = parseInt(value.slice(0, 2), 16);
  const green = parseInt(value.slice(2, 4), 16);
  const blue = parseInt(value.slice(4, 6), 16);
  return (red * 299 + green * 587 + blue * 114) / 1000 >= 150
    ? "#111111"
    : "#ffffff";
}

/* ---- Classic: vertical divider, labelled contact column ---- */
const classic: SignatureDesign = {
  id: "classic",
  name: "Classic",
  description: "Two columns with a brand divider",
  render: (d) => `
<table cellpadding="0" cellspacing="0" border="0" style="font-family:${FONT};color:#111111;font-size:13px;line-height:1.5">
  <tr>
    <td style="padding-right:18px;border-right:3px solid ${brandAccent(d.accent)};vertical-align:top">
      <div style="font-size:17px;font-weight:bold;color:${brandAccent(d.accent)}">${esc(d.full_name)}</div>
      <div style="color:#555555;font-size:13px">${esc(d.title)}</div>
      ${d.department ? `<div style="color:#777777;font-size:12px">${esc(d.department)}</div>` : ""}
    </td>
    <td style="padding-left:18px;vertical-align:top">
      <div style="font-weight:bold;margin-bottom:4px">${esc(d.company)}</div>
      ${d.phone ? `<div style="color:#555555"><span aria-label="Phone">T</span>&nbsp;${esc(d.phone)}</div>` : ""}
      ${d.email ? `<div><span aria-label="Email">E</span>&nbsp;<a href="mailto:${esc(d.email)}" style="color:#111111;text-decoration:none">${esc(d.email)}</a></div>` : ""}
      ${d.website ? `<div><span aria-label="Web">W</span>&nbsp;<a href="${esc(href(d.website))}" style="color:${brandAccent(d.accent)};text-decoration:none">${esc(host(d.website))}</a></div>` : ""}
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
<table cellpadding="0" cellspacing="0" border="0" style="font-family:${FONT};color:#111111;font-size:13px;line-height:1.5">
  <tr>
    <td style="vertical-align:middle;padding-right:16px">
      <div style="width:62px;height:62px;background:${brandAccent(d.accent)};color:${accentForeground(brandAccent(d.accent))};text-align:center;font-size:24px;font-weight:bold;line-height:62px;font-family:${FONT}">${esc(initials(d.full_name))}</div>
    </td>
    <td style="vertical-align:middle">
      <div style="font-size:18px;font-weight:bold">${esc(d.full_name)}</div>
      <div style="color:${brandAccent(d.accent)};font-weight:bold;font-size:13px">${esc(d.title)}${d.department ? ` · ${esc(d.department)}` : ""}</div>
      <div style="color:#555555;margin-top:3px">${esc(d.company)}</div>
      <div style="margin-top:7px;font-size:12px;color:#555555">
        ${[
          d.phone ? esc(d.phone) : "",
          d.email ? `<a href="mailto:${esc(d.email)}" style="color:#555555;text-decoration:none">${esc(d.email)}</a>` : "",
          d.website ? `<a href="${esc(href(d.website))}" style="color:${brandAccent(d.accent)};text-decoration:none">${esc(host(d.website))}</a>` : "",
        ].filter(Boolean).join(' &nbsp;<span style="color:#cccccc">|</span>&nbsp; ')}
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
<table cellpadding="0" cellspacing="0" border="0" style="font-family:${FONT};color:#111111;font-size:13px;line-height:1.5">
  <tr><td>
    <div style="font-size:15px;font-weight:bold">${esc(d.full_name)}</div>
    <div style="color:#666666;margin-bottom:6px">${esc(d.title)}${d.company ? `, ${esc(d.company)}` : ""}</div>
    <div style="font-size:12px;color:#555555">
      ${[
        d.phone ? esc(d.phone) : "",
        d.email ? `<a href="mailto:${esc(d.email)}" style="color:${brandAccent(d.accent)};text-decoration:none">${esc(d.email)}</a>` : "",
        d.website ? `<a href="${esc(href(d.website))}" style="color:${brandAccent(d.accent)};text-decoration:none">${esc(host(d.website))}</a>` : "",
      ].filter(Boolean).join(" &nbsp;·&nbsp; ")}
    </div>
    <div style="height:3px;width:64px;background:${brandAccent(d.accent)};margin-top:8px"></div>
  </td></tr>
</table>`.trim(),
};

/* ---- Banner: bordered card with a coloured company bar ---- */
const banner: SignatureDesign = {
  id: "banner",
  name: "Banner",
  description: "Bordered card with a branded header bar",
  render: (d) => `
<table cellpadding="0" cellspacing="0" border="0" style="font-family:${FONT};color:#111111;font-size:13px;line-height:1.5;border:1px solid #dddddd">
  <tr><td style="background:${brandAccent(d.accent)};padding:9px 16px;color:${accentForeground(brandAccent(d.accent))};font-weight:bold;letter-spacing:.02em">${esc(d.company)}</td></tr>
  <tr><td style="padding:14px 16px">
    <div style="font-size:16px;font-weight:bold">${esc(d.full_name)}</div>
    <div style="color:#666666">${esc(d.title)}${d.department ? ` · ${esc(d.department)}` : ""}</div>
    <div style="margin-top:9px;font-size:12px;color:#555555">
      ${d.email ? `<span aria-label="Email">E</span>&nbsp;<a href="mailto:${esc(d.email)}" style="color:#555555;text-decoration:none">${esc(d.email)}</a><br>` : ""}
      ${d.phone ? `<span aria-label="Phone">T</span>&nbsp;${esc(d.phone)}<br>` : ""}
      ${d.website ? `<span aria-label="Web">W</span>&nbsp;<a href="${esc(href(d.website))}" style="color:${brandAccent(d.accent)};text-decoration:none">${esc(host(d.website))}</a>` : ""}
    </div>
  </td></tr>
</table>`.trim(),
};

export const SIGNATURE_DESIGNS: SignatureDesign[] = [companyProfile, classic, modern, minimal, banner];

/**

 * Plain + HTML email bodies with Tech Jump signature and optional Calendly link.

 */

const crypto = require("crypto");



const TJ_SIGNATURE_PHONE = "+1 407-279-0894";

const TJ_SIGNATURE_LOCATION = "Orlando, FL";

const TJ_SIGNATURE_LOGO_URL =

  process.env.EMAIL_SIGNATURE_LOGO_URL ||

  "https://tech-jump-outreach.web.app/assets/tech-jump-logo.png";



/**

 * @param {unknown} s

 * @returns {string}

 */

function escapeHtml(s) {

  return String(s == null ? "" : s)

    .replace(/&/g, "&amp;")

    .replace(/</g, "&lt;")

    .replace(/>/g, "&gt;")

    .replace(/"/g, "&quot;")

    .replace(/'/g, "&#39;");

}



/**

 * Returns a stable 8-char hex ref when a Calendly link exists.

 * @param {unknown} prevRef

 * @param {boolean} hasCalendlyLink

 * @returns {string | null}

 */

function nextCalendlyRef(prevRef, hasCalendlyLink) {

  if (!hasCalendlyLink) {

    return null;

  }

  const p = String(prevRef == null ? "" : prevRef)

    .trim()

    .toUpperCase();

  if (/^[A-F0-9]{8}$/.test(p)) {

    return p;

  }

  return crypto.randomBytes(4).toString("hex").toUpperCase();

}



/**

 * @param {string} plain

 * @returns {string}

 */

function plainBodyToHtml(plain) {

  const normalized = String(plain == null ? "" : plain)

    .replace(/\r\n/g, "\n")

    .replace(/\s+$/u, "");

  if (!normalized) {

    return "";

  }

  const esc = escapeHtml(normalized);

  const paragraphs = esc.split(/\n{2,}/);

  return paragraphs

    .map((p) => "<p style=\"margin:0 0 12px 0\">" + p.replace(/\n/g, "<br/>") + "</p>")

    .join("\n");

}



/**

 * @param {string} url

 * @returns {string}

 */

function normaliseHref(url) {

  const s = String(url == null ? "" : url).trim();

  if (!s) {

    return "";

  }

  if (/^https?:\/\//i.test(s)) {

    return s;

  }

  return "https://" + s.replace(/^\/+/, "");

}



/**

 * Remove trailing sign-off blocks so send-time signature is the single source of truth.

 * @param {string} bodyPlain

 * @returns {string}

 */

function stripTrailingSignOff(bodyPlain) {

  let s = String(bodyPlain == null ? "" : bodyPlain).replace(/\r\n/g, "\n");

  const closingRe =

    /(?:\n\n|\n)(?:best regards|kind regards|warm regards|sincerely|yours truly|thanks,?|thank you,?|cheers,?|regards,)[^\n]*(?:\n[^\n]+){0,4}$/i;

  for (let i = 0; i < 3; i++) {

    const next = s.replace(closingRe, "").replace(/\s+$/u, "");

    if (next === s) break;

    s = next;

  }

  if (/the tech jump team/i.test(s.slice(-120))) {

    s = s

      .replace(/\n*best regards,?\n*the tech jump team\s*$/i, "")

      .replace(/\n*the tech jump team\s*$/i, "")

      .replace(/\s+$/u, "");

  }

  return s;

}



/**

 * @param {{ senderName?: string, senderTitle?: string, senderEmail?: string }} opts

 * @returns {{ name: string, title: string }}

 */

function resolveSenderFields(opts) {

  const o = opts && typeof opts === "object" ? opts : {};

  let name = String(o.senderName || "").trim();

  const title = String(o.senderTitle || "").trim() || "Account Lead";

  const email = String(o.senderEmail || "").trim().toLowerCase();

  if (!name && email && email.includes("@")) {

    const local = email.split("@")[0].replace(/[._+-]+/g, " ");

    name = local

      .split(/\s+/)

      .filter(Boolean)

      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))

      .join(" ");

  }

  if (!name) {

    name = "Tech Jump team";

  }

  return {name, title};

}



/**

 * @param {string} url

 * @returns {string | null} normalised https URL or null if invalid

 */

function validateCalendlyUrl(url) {

  const href = normaliseHref(url);

  if (!href) return null;

  let parsed;

  try {

    parsed = new URL(href);

  } catch (_) {

    return null;

  }

  if (parsed.protocol !== "https:") return null;

  const host = parsed.hostname.toLowerCase();

  if (host === "calendly.com" || host.endsWith(".calendly.com")) {

    return parsed.toString();

  }

  return null;

}



/**

 * @param {{ senderName?: string, senderTitle?: string, senderEmail?: string }} opts

 * @param {string} [calendlyUrl]

 * @returns {{ text: string, html: string }}

 */

function buildOutlookSignature(opts, calendlyUrl) {

  const {name, title} = resolveSenderFields(opts);

  const href = validateCalendlyUrl(calendlyUrl);

  const bookingLabel = "Book a Calendly meeting with " + name;



  const textLines = [

    "Regards,",

    "",

    name + " | " + title,

    "Office: " + TJ_SIGNATURE_PHONE,

    TJ_SIGNATURE_LOCATION,

  ];

  if (href) {

    textLines.push(bookingLabel + ": " + href);

  }

  const text = textLines.join("\n");



  const bookingHtml = href

    ? '<p style="margin:6px 0 0;font-size:13px">' +

      '<a href="' +

      escapeHtml(href) +

      '" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:underline">' +

      "Book a <strong>Calendly</strong> meeting with " +

      escapeHtml(name) +

      "</a></p>"

    : "";



  const html =

    '<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-top:20px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111;line-height:1.45">' +

    "<tr><td>" +

    '<p style="margin:0 0 10px 0;color:#374151">Regards,</p>' +

    '<p style="margin:0;font-size:15px;color:#111827">' +

    "<strong>" +

    escapeHtml(name) +

    "</strong> | " +

    escapeHtml(title) +

    "</p>" +

    '<p style="margin:4px 0 0;font-size:13px;color:#374151">Office: ' +

    escapeHtml(TJ_SIGNATURE_PHONE) +

    "</p>" +

    '<p style="margin:2px 0 0;font-size:13px;color:#374151">' +

    escapeHtml(TJ_SIGNATURE_LOCATION) +

    "</p>" +

    bookingHtml +

    '<p style="margin:12px 0 0">' +

    '<img src="' +

    escapeHtml(TJ_SIGNATURE_LOGO_URL) +

    '" alt="Tech Jump" width="56" style="display:block;border:0;max-width:56px;height:auto">' +

    "</p>" +

    "</td></tr></table>";



  return {text, html};

}



/**

 * Build text + HTML with stripped body, one Tech Jump signature, optional Calendly link inline.

 *

 * @param {string} bodyPlain

 * @param {string} calendlyUrl

 * @param {string | null} ref

 * @param {{ senderName?: string, senderTitle?: string, senderEmail?: string }} [senderOpts]

 * @returns {{ text: string, html: string }}

 */

function buildCalendlyBlocks(bodyPlain, calendlyUrl, ref, senderOpts) {

  const stripped = stripTrailingSignOff(bodyPlain);

  const href = validateCalendlyUrl(calendlyUrl);

  const sig = buildOutlookSignature(senderOpts || {}, href || "");

  const baseHtml = plainBodyToHtml(stripped) || "<p style=\"margin:0 0 12px 0\"></p>";



  const text = stripped.replace(/\s+$/u, "") + "\n\n" + sig.text;

  const html =

    "<div style=\"font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111;line-height:1.5\">" +

    baseHtml +

    sig.html +

    "</div>";



  return {text, html};

}



/**

 * @param {object | null | undefined} record — target doc or kickoff body

 * @returns {{ senderName: string, senderTitle: string, senderEmail: string }}

 */

function senderOptsFromRecord(record) {

  const r = record && typeof record === "object" ? record : {};

  return {

    senderName: String(r.outreachSenderName || r.senderName || "").trim(),

    senderTitle: String(r.outreachSenderTitle || r.senderTitle || "").trim() || "Account Lead",

    senderEmail: String(r.kickoffAuthorEmail || r.senderEmail || "").trim().toLowerCase(),

  };

}



module.exports = {

  escapeHtml,

  plainBodyToHtml,

  nextCalendlyRef,

  stripTrailingSignOff,

  buildOutlookSignature,

  validateCalendlyUrl,

  buildCalendlyBlocks,

  senderOptsFromRecord,

};



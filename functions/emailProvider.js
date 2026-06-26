/**
 * Outbound email: SendGrid when SENDGRID_API_KEY is set, otherwise EMAIL_DRY_RUN or missing key logs only.
 */
const logger = require("firebase-functions/logger");
const {buildTargetReplyTo} = require("./inboundReplyTo");

/**
 * Wrap a Message-Id-ish string in angle brackets if it isn't already.
 * @param {unknown} v
 */
function normalizeMessageIdHeader(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return "";
  if (s.charAt(0) === "<" && s.charAt(s.length - 1) === ">") return s;
  return "<" + s.replace(/[<>]/g, "") + ">";
}

/**
 * @param {{
 *   to: string,
 *   subject: string,
 *   text: string,
 *   html?: string,
 *   from?: string,
 *   fromName?: string,
 *   replyTo?: string,
 *   targetId?: string,
 *   inReplyTo?: string,
 *   references?: string | string[]
 * }} opts
 * @returns {Promise<{ messageId?: string, dryRun?: boolean }>}
 */
async function sendOutreachMail(opts) {
  const to = (opts.to || "").trim();
  const subject = (opts.subject || "").trim();
  const text = opts.text != null ? String(opts.text) : "";
  const html = opts.html != null ? String(opts.html) : "";
  const from =
    (opts.from || process.env.SENDGRID_FROM_EMAIL || "").trim() || "noreply@example.com";
  const fromName = (opts.fromName || process.env.SENDGRID_FROM_NAME || "").trim() || "Tech Jump";
  // Per-target Reply-To (reply+targetId@inbound-domain) routes replies to Inbound Parse.
  const replyTo =
    (opts.replyTo || "").trim() ||
    (opts.targetId ? buildTargetReplyTo(opts.targetId) : "") ||
    (process.env.INBOUND_REPLY_TO_EMAIL || "").trim();

  const inReplyTo = normalizeMessageIdHeader(opts.inReplyTo);
  const referencesRaw = opts.references;
  let referencesHeader = "";
  if (Array.isArray(referencesRaw)) {
    referencesHeader = referencesRaw
      .map(normalizeMessageIdHeader)
      .filter(Boolean)
      .join(" ");
  } else if (referencesRaw != null && String(referencesRaw).trim()) {
    referencesHeader = String(referencesRaw)
      .split(/\s+/)
      .map(normalizeMessageIdHeader)
      .filter(Boolean)
      .join(" ");
  }
  if (inReplyTo && !referencesHeader) {
    referencesHeader = inReplyTo;
  }

  const key = (process.env.SENDGRID_API_KEY || "").trim();
  const dry =
    process.env.EMAIL_DRY_RUN === "1" ||
    process.env.EMAIL_DRY_RUN === "true" ||
    !key;

  if (dry) {
    logger.info("email_dry_run", {
      to,
      subject: subject.slice(0, 80),
      textBytes: text.length,
      htmlBytes: html.length,
      replyTo: replyTo || undefined,
      inReplyTo: inReplyTo || undefined,
      references: referencesHeader || undefined,
    });
    return {dryRun: true};
  }

  try {
    const sg = require("@sendgrid/mail");
    sg.setApiKey(key);
    const msg = {
      to,
      from: {email: from, name: fromName},
      subject,
      text,
    };
    if (replyTo) {
      msg.replyTo = {email: replyTo, name: fromName};
    }
    if (html) {
      msg.html = html;
    }
    if (inReplyTo || referencesHeader) {
      msg.headers = {};
      if (inReplyTo) msg.headers["In-Reply-To"] = inReplyTo;
      if (referencesHeader) msg.headers["References"] = referencesHeader;
    }
    const [resp] = await sg.send(msg);
    const messageId = resp && resp.headers && resp.headers["x-message-id"];
    return {messageId: messageId || "sent"};
  } catch (e) {
    logger.error("sendgrid_error", {err: e && e.message ? e.message : e});
    throw e;
  }
}

module.exports = {sendOutreachMail};

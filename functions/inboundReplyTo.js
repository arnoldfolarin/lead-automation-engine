/**
 * Per-target Reply-To for SendGrid Inbound Parse: reply+{targetId}@inbound-domain
 */

/**
 * Domain for plus-address replies (from INBOUND_REPLY_TO_EMAIL or INBOUND_REPLY_DOMAIN).
 * @returns {string}
 */
function getInboundReplyDomain() {
  const explicit = String(process.env.INBOUND_REPLY_DOMAIN || "").trim().toLowerCase();
  if (explicit) return explicit;
  const base = String(process.env.INBOUND_REPLY_TO_EMAIL || "").trim().toLowerCase();
  const at = base.indexOf("@");
  if (at > 0) return base.slice(at + 1);
  return "";
}

/**
 * Build Reply-To for a Firestore target doc id.
 * @param {string} targetId
 * @returns {string}
 */
function buildTargetReplyTo(targetId) {
  // Optional override: route ALL replies to one mailbox (e.g. the Gmail inbox a
  // Zapier "New Email" trigger watches). This skips per-target plus-addressing, so
  // inbound matching falls back to the sender address (handled by findTargetForReply).
  //   REPLY_TO_OVERRIDE_EMAIL=autoemailer@tech-jump.com   (explicit), or
  //   REPLY_TO_USE_FROM_EMAIL=true                        (reuse SENDGRID_FROM_EMAIL)
  const override = String(process.env.REPLY_TO_OVERRIDE_EMAIL || "").trim();
  if (override) return override;
  const useFrom = String(process.env.REPLY_TO_USE_FROM_EMAIL || "").trim().toLowerCase();
  if (useFrom === "1" || useFrom === "true" || useFrom === "yes" || useFrom === "on") {
    const fromEmail = String(process.env.SENDGRID_FROM_EMAIL || "").trim();
    if (fromEmail) return fromEmail;
  }

  const id = String(targetId || "").trim();
  if (!id) {
    return String(process.env.INBOUND_REPLY_TO_EMAIL || "").trim();
  }
  const domain = getInboundReplyDomain();
  if (!domain) {
    return String(process.env.INBOUND_REPLY_TO_EMAIL || "").trim();
  }
  return `reply+${id}@${domain}`;
}

/**
 * Extract target doc id from reply+{targetId}@domain (case-insensitive local part).
 * @param {string} addr — full email or local part
 * @returns {string}
 */
function parseTargetIdFromReplyAddress(addr) {
  const raw = String(addr || "").trim().toLowerCase();
  if (!raw) return "";
  const at = raw.indexOf("@");
  const local = at > 0 ? raw.slice(0, at) : raw;
  const plus = local.indexOf("+");
  if (plus < 0) return "";
  const tag = local.slice(plus + 1).trim();
  if (!tag || !/^[a-z0-9_-]{1,1500}$/i.test(tag)) return "";
  return tag;
}

module.exports = {
  getInboundReplyDomain,
  buildTargetReplyTo,
  parseTargetIdFromReplyAddress,
};

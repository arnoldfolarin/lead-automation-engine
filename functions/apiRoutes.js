/**
 * Express routes for the Lead Automation API (mounted at /api/*).
 */
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const multer = require("multer");
const {computeNextStageSendAt, getStageBySequenceIndex} = require("./sequenceSchedule");
const {sendOutreachMail} = require("./emailProvider");
const {parseTargetIdFromReplyAddress} = require("./inboundReplyTo");
const {buildCalendlyBlocks, nextCalendlyRef, validateCalendlyUrl, senderOptsFromRecord} = require("./emailCalendly");
const {
  normalizeKickoffBody,
  resolveFirstNameForTarget,
  fillOutreachTemplate,
  defaultIceBreakerFallback,
} = require("./greetingTemplate");
const {
  pickIcebreakerTemplate,
  pickPainPoint,
  icebreakerTemplates,
  DEFAULT_OUTREACH_VIBE,
  DEFAULT_CALENDLY_LINK,
  getOutreachSetupCatalog,
  heuristicOutreachSetup,
} = require("./outreachCopy");
const {draftInboundAiReply, draftKickoffEmail, suggestOutreachSetup} = require("./sequencePrompts");
const {kickoffTouchSnapshot, maxFollowupStagesFromTarget, followupTouchSnapshot} = require("./touchSnapshot");
const {chatWithCoach} = require("./coachPrompts");

const FieldValue = admin.firestore.FieldValue;

/**
 * @param {unknown} v
 * @returns {string}
 */
function trimOutreachVibe(v) {
  return String(v == null ? "" : v).trim().slice(0, 500);
}

/**
 * @param {unknown} v
 * @returns {string}
 */
function trimCalendlyLink(v) {
  return String(v == null ? "" : v).trim().slice(0, 500);
}

/**
 * Run follow-up immediately if due now, or wait up to ~115s in-request for near-term due times (GMass-like quick follow-up).
 * Longer delays rely on sequenceWorkerTick (every minute).
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} tenantId
 * @param {FirebaseFirestore.DocumentReference} targetRef
 */
async function maybeKickFollowUpSoon(db, tenantId, targetRef) {
  const {processOneTarget} = require("./sequenceWorker");
  const snap = await targetRef.get();
  const d = snap.data();
  if (!d || d.sequenceStatus !== "active" || !d.nextSequenceSendAt) {
    return;
  }
  const due = d.nextSequenceSendAt.toMillis();
  const now = Date.now();
  const MAX_INLINE_WAIT_MS = 115000;

  if (due <= now) {
    await processOneTarget(db, tenantId, targetRef.id, targetRef, d);
    return;
  }

  const waitMs = due - now;
  if (waitMs > MAX_INLINE_WAIT_MS) {
    return;
  }

  await new Promise((r) => setTimeout(r, waitMs));
  const snap2 = await targetRef.get();
  const d2 = snap2.data();
  if (
    d2 &&
    d2.sequenceStatus === "active" &&
    d2.nextSequenceSendAt &&
    d2.nextSequenceSendAt.toMillis() <= Date.now()
  ) {
    await processOneTarget(db, tenantId, targetRef.id, targetRef, d2);
  }
}

/**
 * @param {unknown} val
 */
function deepSerialize(val) {
  if (val == null) {
    return val;
  }
  if (typeof val.toDate === "function") {
    try {
      return val.toDate().toISOString();
    } catch {
      return null;
    }
  }
  if (Array.isArray(val)) {
    return val.map(deepSerialize);
  }
  if (typeof val === "object") {
    const o = {};
    for (const k of Object.keys(val)) {
      o[k] = deepSerialize(val[k]);
    }
    return o;
  }
  return val;
}

/**
 * @param {string} id
 * @param {FirebaseFirestore.DocumentData} data
 */
function serializeDoc(id, data) {
  const d = deepSerialize(data || {});
  d.id = id;
  return d;
}

function normEmail(v) {
  return String(v || "")
    .trim()
    .toLowerCase();
}

/**
 * Coerce ANYTHING a multipart parser might return (string, Buffer, array of strings,
 * `{value: ...}`, undefined, null) into a single trimmed string. Never throws.
 * @param {unknown} v
 */
function safeStr(v) {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v).trim();
  if (Buffer.isBuffer(v)) {
    try {
      return v.toString("utf8").trim();
    } catch {
      return "";
    }
  }
  if (Array.isArray(v)) {
    for (const item of v) {
      const s = safeStr(item);
      if (s) return s;
    }
    return "";
  }
  if (typeof v === "object") {
    if (typeof v.value === "string") return v.value.trim();
    if (typeof v.text === "string") return v.text.trim();
    try {
      return JSON.stringify(v).slice(0, 500);
    } catch {
      return "";
    }
  }
  try {
    return String(v).trim();
  } catch {
    return "";
  }
}

/**
 * Pick the first non-empty value among any number of fields (handles multipart aliasing
 * where SendGrid may send `from` or `From` or both, and where multer may give arrays).
 * @param {Record<string, unknown>} b
 * @param  {...string} keys
 */
function pickField(b, ...keys) {
  const src = b || {};
  for (const k of keys) {
    const s = safeStr(src[k]);
    if (s) return s;
  }
  return "";
}

/** "Name <user@host>" or bare address → normalized email local-part@domain */
function extractEmailFromAddr(v) {
  const s = safeStr(v);
  if (!s) return "";
  const m = s.match(/<([^>\s]+)>/);
  if (m && m[1]) return normEmail(m[1]);
  // Fallback: pick the first @-token if address is wrapped in noise (e.g. "Name foo@bar.com (alias)").
  const bare = s.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (bare && bare[0]) return normEmail(bare[0]);
  return normEmail(s);
}

/**
 * SendGrid Inbound Parse often sends `envelope` as JSON: {"to":["inbox@..."],"from":"lead@..."}.
 * Robust to envelope being a Buffer/array/{value} as well.
 * @param {Record<string, unknown>} b
 */
function mergeSendGridEnvelope(b) {
  const out = Object.assign({}, b || {});
  try {
    const raw = safeStr(out.envelope);
    if (!raw) return out;
    const env = JSON.parse(raw);
    if (!env || typeof env !== "object") return out;
    if (!safeStr(out.from) && env.from) out.from = env.from;
    if (!safeStr(out.to)) {
      const t = env.to;
      if (Array.isArray(t) && t[0]) out.to = t[0];
      else if (typeof t === "string") out.to = t;
    }
  } catch {
    /* ignore bad envelope */
  }
  return out;
}

/**
 * Recursively strip values that Firestore rejects (undefined, NaN, Infinity, functions).
 * Returns a new object/array. Top-level `FieldValue` sentinels are preserved as-is.
 * @param {unknown} val
 */
function sanitizeForFirestore(val) {
  if (val === undefined) return null;
  if (val === null) return null;
  if (typeof val === "number") return Number.isFinite(val) ? val : null;
  if (typeof val === "function") return null;
  if (typeof val !== "object") return val;
  // Preserve FieldValue / Timestamp / GeoPoint / DocumentReference instances.
  if (val && typeof val === "object" && (
    typeof val.toMillis === "function" ||
    typeof val.isEqual === "function" ||
    val.constructor && (val.constructor.name === "FieldValue" || val.constructor.name === "Timestamp")
  )) {
    return val;
  }
  if (Array.isArray(val)) {
    return val.map((item) => sanitizeForFirestore(item)).filter((item) => item !== undefined);
  }
  const out = {};
  for (const k of Object.keys(val)) {
    const v = sanitizeForFirestore(val[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function envTruthy(name) {
  const v = String(process.env[name] || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function extractFirstIsoDate(v) {
  if (!v) return "";
  const t = new Date(String(v));
  return Number.isNaN(t.getTime()) ? "" : t.toISOString();
}

function firstHeaderValue(rawHeaders, key) {
  const src = safeStr(rawHeaders);
  if (!src) return "";
  const re = new RegExp("^" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*:\\s*(.+)$", "im");
  const m = src.match(re);
  return m && m[1] ? String(m[1]).trim() : "";
}

function pickInboundMessageId(body) {
  const b = body || {};
  const direct = pickField(b, "messageId", "message_id", "sg_message_id", "sgMessageId", "Message-Id", "Message-ID");
  if (direct) return direct.slice(0, 500);
  const headers = pickField(b, "headers", "email_headers");
  const fromHdr = firstHeaderValue(headers, "Message-Id") || firstHeaderValue(headers, "Message-ID");
  if (fromHdr) return fromHdr.slice(0, 500);
  const fallback =
    extractEmailFromAddr(pickField(b, "from", "From")) +
    "|" +
    extractEmailFromAddr(pickField(b, "to", "To")) +
    "|" +
    pickField(b, "subject", "Subject").slice(0, 120) +
    "|" +
    pickField(b, "text", "plain", "html").slice(0, 200);
  return fallback.slice(0, 500);
}

/**
 * Build a deduped list of Message-Id headers (already wrapped in <>) to use as `References`.
 * Order: oldest known first, newest last (per RFC 5322 expectation).
 * @param {unknown} prevInbound
 * @param {unknown} prevOutbound
 * @param {unknown} priorList
 */
function collectThreadRefs(prevInbound, prevOutbound, priorList) {
  const out = [];
  const seen = new Set();
  /** @param {unknown} v */
  function push(v) {
    const s = String(v == null ? "" : v).trim();
    if (!s) return;
    const wrapped = s.charAt(0) === "<" && s.charAt(s.length - 1) === ">" ? s : "<" + s.replace(/[<>]/g, "") + ">";
    if (seen.has(wrapped)) return;
    seen.add(wrapped);
    out.push(wrapped);
  }
  if (Array.isArray(priorList)) {
    for (const v of priorList) push(v);
  } else if (priorList != null && String(priorList).trim()) {
    String(priorList)
      .split(/\s+/)
      .forEach(push);
  }
  push(prevOutbound);
  push(prevInbound);
  return out;
}

/** Append the latest inbound Message-Id to the references list (deduped). */
function mergeThreadRefs(refs, latestInbound) {
  const arr = Array.isArray(refs) ? refs.slice() : [];
  const s = String(latestInbound == null ? "" : latestInbound).trim();
  if (!s) return arr;
  const wrapped = s.charAt(0) === "<" && s.charAt(s.length - 1) === ">" ? s : "<" + s.replace(/[<>]/g, "") + ">";
  if (arr.indexOf(wrapped) === -1) arr.push(wrapped);
  return arr;
}

function normalizeEmailSubject(s) {
  return String(s || "")
    .replace(/^(re|fwd?):\s*/gi, "")
    .trim()
    .toLowerCase();
}

function isOutboundTouch(t) {
  if (!t || typeof t !== "object") return false;
  const kind = String(t.kind || "");
  if (kind === "kickoff" || kind === "ai_followup") return true;
  if (kind && kind.indexOf("inbound") >= 0) return false;
  return !!(t.sentAt && t.subject);
}

function touchContextFrom(t, target) {
  return {
    campaignName: String(
      t.campaignName || (target && (target.lastCampaignName || target.campaignName)) || ""
    ).trim(),
    touchKind: String(t.kind || ""),
    touchSubject: String(t.subject || "").slice(0, 500),
    sentAt: t.sentAt ? String(t.sentAt) : "",
  };
}

/**
 * Guess which outbound touch the inbound reply belongs to (for campaign context in Pipeline UI).
 * @param {object} target
 * @param {string} inboundSubject
 */
function resolveRepliedToTouch(target, inboundSubject) {
  const hist = Array.isArray(target && target.touchHistory) ? target.touchHistory : [];
  const inNorm = normalizeEmailSubject(inboundSubject);
  if (inNorm) {
    for (let i = hist.length - 1; i >= 0; i--) {
      const t = hist[i];
      if (!isOutboundTouch(t)) continue;
      if (normalizeEmailSubject(t.subject) === inNorm) {
        return touchContextFrom(t, target);
      }
    }
  }
  for (let i = hist.length - 1; i >= 0; i--) {
    const t = hist[i];
    if (isOutboundTouch(t) && t.sentAt) {
      return touchContextFrom(t, target);
    }
  }
  return {
    campaignName: String((target && (target.lastCampaignName || target.campaignName)) || "").trim(),
    touchKind: "",
    touchSubject: "",
    sentAt: "",
  };
}

function contactDisplayNameFromTarget(target) {
  if (!target || typeof target !== "object") return "";
  const hint = String(target.greetingNameHint || "").trim();
  if (hint) return hint.slice(0, 120);
  const dn = String(target.directorName || "").trim();
  if (dn) return dn.slice(0, 120);
  const c = target.contact && typeof target.contact === "object" ? target.contact : {};
  const fn = String(c.firstName || "").trim();
  const ln = String(c.lastName || "").trim();
  const joined = (fn + " " + ln).trim();
  if (joined) return joined.slice(0, 120);
  return "";
}

/**
 * Write an in-app notification doc. Read by /api/notifications (server filters by user.uid),
 * so this is safe to call even when the user has notifications turned off in their prefs —
 * the read path will hide all rows for users with `notifyInApp` disabled.
 *
 * Path: tenants/{tenantId}/notifications/{auto-id}
 * Required: { uid, kind, targetId }
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} tenantId
 * @param {{
 *   uid: string,
 *   kind: "inbound_pending" | "inbound_auto_sent",
 *   targetId: string,
 *   pendingId?: string,
 *   company?: string,
 *   subject?: string,
 *   snippet?: string,
 *   sentiment?: string,
 *   intent?: string,
 *   confidence?: number,
 *   riskFlags?: string[],
 * }} payload
 */
async function createInAppNotification(db, tenantId, payload) {
  if (!payload || !payload.uid || !payload.kind || !payload.targetId) return;
  try {
    const ref = db.collection("tenants").doc(tenantId).collection("notifications").doc();
    await ref.set({
      uid: String(payload.uid),
      kind: String(payload.kind),
      targetId: String(payload.targetId),
      pendingId: payload.pendingId ? String(payload.pendingId) : null,
      company: payload.company ? String(payload.company).slice(0, 160) : "",
      subject: payload.subject ? String(payload.subject).slice(0, 160) : "",
      snippet: payload.snippet ? String(payload.snippet).slice(0, 280) : "",
      campaignName: payload.campaignName ? String(payload.campaignName).slice(0, 200) : "",
      contactName: payload.contactName ? String(payload.contactName).slice(0, 120) : "",
      sentiment: payload.sentiment ? String(payload.sentiment) : "neutral",
      intent: payload.intent ? String(payload.intent) : "other",
      confidence: typeof payload.confidence === "number" ? payload.confidence : null,
      riskFlags: Array.isArray(payload.riskFlags) ? payload.riskFlags.slice(0, 8) : [],
      read: false,
      viewed: false,
      viewedAt: null,
      createdAt: FieldValue.serverTimestamp(),
      createdAtIso: new Date().toISOString(),
    });
  } catch (e) {
    logger.warn("notification_write_failed", {err: e && e.message ? e.message : e});
  }
}

function makePendingLink(tenantId, pendingId, targetId) {
  const q = [
    "view=pipeline",
    "tenantId=" + encodeURIComponent(String(tenantId || "default")),
    "inboundPending=" + encodeURIComponent(String(pendingId || "")),
    "targetId=" + encodeURIComponent(String(targetId || "")),
  ].join("&");
  return "/leads.html?" + q;
}

/**
 * @param {import("express").Express} app
 * @param {{ db: FirebaseFirestore.Firestore; requireUser: (req: import("express").Request, res: import("express").Response) => Promise<import("firebase-admin/auth").DecodedIdToken | null> }} ctx
 */
function attachApiRoutes(app, ctx) {
  const {db, requireUser} = ctx;

  /**
   * Optional inbound review notifications:
   * - INBOUND_WEBHOOK_SECRET secures inbound parse endpoint
   * - NOTIFY_EMAIL_ON_INBOUND_REVIEW toggles internal alert email
   * - SLACK_INBOUND_WEBHOOK_URL toggles Slack ping
   * - OPENAI_API_KEY and SENDGRID_* are reused for draft/send
   */
  async function notifyInboundReviewRequired(target, pendingDoc, tenantId) {
    const notifyEmail = String(target.kickoffAuthorEmail || "").trim();
    const pendingId = pendingDoc.id;
    const targetId = String(target.id || target.targetId || "");
    const company = String(target.companyName || "Lead").trim() || "Lead";
    const link = makePendingLink(tenantId, pendingId, targetId);
    const snippet = String(pendingDoc.inboundSnippet || "").trim().slice(0, 300);

    if (notifyEmail && envTruthy("NOTIFY_EMAIL_ON_INBOUND_REVIEW")) {
      try {
        await sendOutreachMail({
          to: notifyEmail,
          subject: `Reply needs review: ${company}`.slice(0, 120),
          text:
            "A recipient replied and the server flagged this for human review.\n\n" +
            `Company: ${company}\n` +
            (snippet ? `Snippet: ${snippet}\n` : "") +
            `Open review: ${link}`,
        });
      } catch (e) {
        logger.warn("inbound_review_notify_email_failed", {err: e && e.message ? e.message : e});
      }
    }

    const slackWebhook = String(process.env.SLACK_INBOUND_WEBHOOK_URL || "").trim();
    if (slackWebhook) {
      try {
        const payload = {
          text:
            `Inbound reply needs review for ${company}. ` +
            (snippet ? `"${snippet}" ` : "") +
            `Open: ${link}`,
        };
        const out = await fetch(slackWebhook, {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify(payload),
        });
        if (!out.ok) {
          logger.warn("inbound_review_notify_slack_bad_status", {status: out.status});
        }
      } catch (e) {
        logger.warn("inbound_review_notify_slack_failed", {err: e && e.message ? e.message : e});
      }
    }
  }

  async function buildOutreachDocument(entry, user, tenantId, clientLocalId) {
    const base = JSON.parse(JSON.stringify(entry || {}));
    delete base.id;
    if (clientLocalId) {
      base.clientLocalId = String(clientLocalId).slice(0, 120);
    }
    base.tenantId = String(tenantId);
    base.authorUid = user.uid;
    if (user.email) {
      base.authorEmail = String(user.email);
    }
    base.savedAt = FieldValue.serverTimestamp();
    return base;
  }

  app.post("/api/outreach-sends", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) {
      return;
    }
    const b = req.body;
    if (!b || typeof b !== "object") {
      return res.status(400).json({error: "Expected JSON body"});
    }
    const tenantId = b.tenantId != null ? String(b.tenantId).trim() : "";
    if (!tenantId) {
      return res.status(400).json({error: "tenantId is required"});
    }
    if (!b.entry || typeof b.entry !== "object") {
      return res.status(400).json({error: "entry object is required"});
    }
    const clientLocalId =
      b.clientLocalId != null
        ? String(b.clientLocalId).trim().slice(0, 120)
        : b.entry && b.entry.id != null
          ? String(b.entry.id).trim().slice(0, 120)
          : null;
    const toSave = buildOutreachDocument(b.entry, user, tenantId, clientLocalId);
    if (!toSave.recordedAt) {
      toSave.recordedAt = new Date().toISOString();
    }
    try {
      const col = db.collection("tenants").doc(tenantId).collection("outreachSends");
      const ref = await col.add(toSave);
      return res.status(201).json({id: ref.id, ok: true});
    } catch (e) {
      logger.error("outreachSends add failed", {err: e && e.message ? e.message : e});
      return res.status(500).json({error: "Failed to save outreach log"});
    }
  });

  app.get("/api/outreach-sends", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) {
      return;
    }
    const tenantId = req.query.tenantId != null ? String(req.query.tenantId).trim() : "";
    if (!tenantId) {
      return res.status(400).json({error: "tenantId query is required"});
    }
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || "100"), 10) || 100));
    try {
      const snap = await db
        .collection("tenants")
        .doc(tenantId)
        .collection("outreachSends")
        .orderBy("recordedAt", "desc")
        .limit(limit)
        .get();
      const items = snap.docs.map((d) => Object.assign({}, d.data() || {}, {id: d.id}));
      return res.json({items});
    } catch (e) {
      logger.error("outreachSends list failed", {err: e && e.message ? e.message : e});
      return res.status(500).json({error: "Failed to list outreach log", code: (e && e.code) || ""});
    }
  });

  app.get("/api/outreach-sends/:sendId", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) {
      return;
    }
    const tenantId = req.query.tenantId != null ? String(req.query.tenantId).trim() : "";
    const sendId = (req.params.sendId != null ? String(req.params.sendId) : "").trim();
    if (!tenantId || !sendId) {
      return res.status(400).json({error: "tenantId query and sendId path are required"});
    }
    try {
      const dref = db.collection("tenants").doc(tenantId).collection("outreachSends").doc(sendId);
      const d = await dref.get();
      if (!d.exists) {
        return res.status(404).json({error: "Not found"});
      }
      return res.json({item: Object.assign({}, d.data() || {}, {id: d.id})});
    } catch (e) {
      logger.error("outreachSends get failed", {err: e && e.message ? e.message : e});
      return res.status(500).json({error: "Failed to read outreach log"});
    }
  });

  app.get("/api/leads", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) {
      return;
    }
    const tenantId = req.query.tenantId != null ? String(req.query.tenantId).trim() : "";
    if (!tenantId) {
      return res.status(400).json({error: "tenantId is required"});
    }
    try {
      const snap = await db.collection("tenants").doc(tenantId).collection("leads").limit(500).get();
      const leads = snap.docs.map((d) => serializeDoc(d.id, d.data()));
      return res.json({leads, count: leads.length});
    } catch (e) {
      logger.error("leads_list_failed", {err: e && e.message ? e.message : e});
      return res.status(500).json({error: "Failed to list leads"});
    }
  });

  app.get("/api/targets", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) {
      return;
    }
    const tenantId = req.query.tenantId != null ? String(req.query.tenantId).trim() : "";
    if (!tenantId) {
      return res.status(400).json({error: "tenantId is required"});
    }
    const contactEmail = req.query.contactEmail != null ? normEmail(req.query.contactEmail) : "";
    try {
      let q = db.collection("tenants").doc(tenantId).collection("targets");
      if (contactEmail) {
        q = q.where("contactEmail", "==", contactEmail).limit(25);
      } else {
        q = q.limit(500);
      }
      const snap = await q.get();
      const targets = snap.docs.map((d) => serializeDoc(d.id, d.data()));
      let replyWebhookTrace = null;
      try {
        const traceSnap = await db
            .collection("tenants")
            .doc(tenantId)
            .collection("_system")
            .doc("replyWebhookTrace")
            .get();
        if (traceSnap.exists) {
          replyWebhookTrace = traceSnap.data() || null;
        }
      } catch (_) { /* best-effort debug trace */ }
      return res.json({targets, count: targets.length, replyWebhookTrace});
    } catch (e) {
      logger.error("targets_list_failed", {err: e && e.message ? e.message : e});
      return res.status(500).json({error: "Failed to list targets"});
    }
  });

  app.patch("/api/targets/:tenantId/:targetId", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) {
      return;
    }
    const tenantId = (req.params.tenantId || "").trim();
    const targetId = (req.params.targetId || "").trim();
    if (!tenantId || !targetId) {
      return res.status(400).json({error: "tenantId and targetId required"});
    }
    const patch = req.body && typeof req.body === "object" ? req.body : {};
    const allowed = [
      "companyName",
      "contactEmail",
      "email",
      "directorName",
      "firstName",
      "lastName",
      "title",
      "city",
      "phone",
      "notes",
      "outreachVibe",
      "pipelineStatus",
      "lastReplyAt",
    ];
    const update = {};
    for (const k of allowed) {
      if (Object.prototype.hasOwnProperty.call(patch, k)) {
        update[k] = patch[k];
      }
    }
    if (update.email && !update.contactEmail) {
      update.contactEmail = normEmail(update.email);
    }
    if (Object.keys(update).length === 0) {
      return res.status(400).json({error: "No allowed fields to update"});
    }
    try {
      const ref = db.collection("tenants").doc(tenantId).collection("targets").doc(targetId);
      const cur = await ref.get();
      if (!cur.exists) {
        return res.status(404).json({error: "Target not found"});
      }
      await ref.update(update);
      return res.json({ok: true});
    } catch (e) {
      logger.error("target_patch_failed", {err: e && e.message ? e.message : e});
      return res.status(500).json({error: "Patch failed"});
    }
  });

  app.get("/api/ai-sequence/pending", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) {
      return;
    }
    const tenantId = req.query.tenantId != null ? String(req.query.tenantId).trim() : "";
    if (!tenantId) {
      return res.status(400).json({error: "tenantId is required"});
    }
    try {
      const snap = await db
        .collection("tenants")
        .doc(tenantId)
        .collection("aiSequencePending")
        .where("status", "==", "pending")
        .limit(50)
        .get();
      const items = snap.docs.map((d) => {
        const data = d.data() || {};
        return {
          id: d.id,
          targetId: data.targetId,
          pendingAiDraft: deepSerialize(data.pendingAiDraft || {}),
        };
      });
      return res.json({items});
    } catch (e) {
      logger.error("ai_sequence_pending_failed", {err: e && e.message ? e.message : e});
      return res.json({items: []});
    }
  });

  /** SendGrid Inbound Parse: multipart/form-data with optional attachment parts. */
  const inboundParseMulter = multer({
    storage: multer.memoryStorage(),
    limits: {fieldSize: 10 * 1024 * 1024, fields: 200, fileSize: 25 * 1024 * 1024},
  }).any();

  /**
   * Multer wrapper that never breaks the request: parse errors are logged and we
   * continue with whatever was parsed (possibly empty req.body) so the handler can
   * decide what to return. Prevents bare 500s on odd multipart payloads.
   */
  function safeInboundParse(req, res, next) {
    inboundParseMulter(req, res, function (err) {
      if (err) {
        logger.warn("inbound_multer_parse_failed", {
          err: err && err.message ? err.message : String(err),
          code: err && err.code ? err.code : undefined,
        });
        req.body = req.body || {};
      }
      next();
    });
  }

  /**
   * Collect all recipient addresses from inbound parse payload (To header + envelope.to[]).
   * @param {Record<string, unknown>} b
   * @param {Record<string, unknown>} rawBody
   * @returns {string[]}
   */
  function collectInboundToAddresses(b, rawBody) {
    const out = [];
    const seen = new Set();
    /** @param {unknown} v */
    function add(v) {
      const e = extractEmailFromAddr(v);
      if (e && !seen.has(e)) {
        seen.add(e);
        out.push(e);
      }
    }
    add(pickField(b, "to", "To", "recipient", "Recipient"));
    try {
      const envStr = safeStr(rawBody && rawBody.envelope);
      if (envStr) {
        const env = JSON.parse(envStr);
        const t = env && env.to;
        if (Array.isArray(t)) {
          for (const item of t) add(item);
        } else if (t) {
          add(t);
        }
      }
    } catch {
      /* ignore */
    }
    return out;
  }

  /**
   * Best-effort trace for reply-detection debugging (shown on GET /api/targets).
   * @param {string} tenantId
   * @param {{source: string, from: string, matched: boolean, targetId?: string, stage?: string}} evt
   */
  async function recordReplyWebhookTrace(tenantId, evt) {
    try {
      const tid = String(tenantId || "default").trim() || "default";
      await db
          .collection("tenants")
          .doc(tid)
          .collection("_system")
          .doc("replyWebhookTrace")
          .set(
              sanitizeForFirestore({
                lastAt: new Date().toISOString(),
                source: String(evt.source || "").slice(0, 40),
                from: normEmail(evt.from || ""),
                matched: !!evt.matched,
                targetId: String(evt.targetId || "").slice(0, 200),
                stage: String(evt.stage || "").slice(0, 80),
              }),
              {merge: true},
          );
    } catch (_) { /* ignore */ }
  }

  /**
   * Find a target for an inbound reply. Tries (in order):
   *   1. `reply+{targetId}@…` on To / envelope.to (per-target Reply-To)
   *   2. Exact `contactEmail == from`
   *   3. `contact.email == from`
   *   4. SendGrid envelope `from` (when display-name parsing differed)
   * @returns {Promise<FirebaseFirestore.QueryDocumentSnapshot|null>}
   */
  async function findTargetForReply(tenantId, fromPrimary, fromEnvelope, toAddresses) {
    const targetsCol = db.collection("tenants").doc(tenantId).collection("targets");

    const toList = Array.isArray(toAddresses) ? toAddresses : [];
    const triedTargetIds = new Set();
    for (const addr of toList) {
      const targetId = parseTargetIdFromReplyAddress(addr);
      if (!targetId || triedTargetIds.has(targetId)) continue;
      triedTargetIds.add(targetId);
      const snap = await targetsCol.doc(targetId).get();
      if (snap.exists) return snap;
    }

    const seen = new Set();
    /** @param {string} addr */
    async function tryExact(addr) {
      const e = normEmail(addr);
      if (!e || seen.has(e)) return null;
      seen.add(e);
      const q = await targetsCol.where("contactEmail", "==", e).limit(1).get();
      if (!q.empty) return q.docs[0];
      const q2 = await targetsCol.where("contact.email", "==", e).limit(1).get();
      if (!q2.empty) return q2.docs[0];
      return null;
    }

    let doc = await tryExact(fromPrimary);
    if (doc) return doc;
    doc = await tryExact(fromEnvelope);
    if (doc) return doc;
    return null;
  }

  /**
   * SendGrid Inbound Parse posts `multipart/form-data` (fields: from, to, subject, text, html,
   * headers, envelope JSON, charsets JSON; optional attachment file parts). JSON/urlencoded
   * still work via express.json / express.urlencoded when testing without SendGrid.
   *
   * Design: do the cheapest, most important Firestore work first (mark the lead as
   * replied), and treat AI drafts / notifications / auto-send as best-effort. A failure
   * in any of those must NOT cause the webhook to return 500 — that just causes SendGrid
   * to retry and the Pipeline UI to stay red.
   */
  app.post("/api/inbound/email-parse", safeInboundParse, async (req, res) => {
    const startedAt = Date.now();
    let stage = "init";
    try {
      const tokenExpected = String(process.env.INBOUND_WEBHOOK_SECRET || "").trim();
      const tokenGot = String(req.query.token || req.headers["x-inbound-secret"] || "").trim();
      if (!tokenExpected || tokenGot !== tokenExpected) {
        return res.status(401).json({error: "Unauthorized inbound webhook"});
      }

      stage = "parse_body";
      const rawBody = req.body || {};
      const b = mergeSendGridEnvelope(rawBody);
      const fromRaw = pickField(b, "from", "From", "sender", "Sender");
      const toRaw = pickField(b, "to", "To", "recipient", "Recipient");
      const from = extractEmailFromAddr(fromRaw);
      const to = extractEmailFromAddr(toRaw);
      const subject = pickField(b, "subject", "Subject");
      const text = pickField(b, "text", "plain", "Text");
      const html = pickField(b, "html", "Html", "HTML");
      const inboundBody = text || html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

      if (!from) {
        logger.warn("inbound_parse_missing_from", {keys: Object.keys(rawBody).slice(0, 20)});
        return res.status(200).json({ok: true, matched: false, skipped: "missing_from"});
      }

      stage = "tenant";
      const tenantIdRaw = pickField(b, "tenantId", "tenant_id") || "default";
      const tenantId = tenantIdRaw.toLowerCase();
      const messageId = pickInboundMessageId(b);

      stage = "find_target";
      // Envelope-from for fallback matching (sometimes differs from header From).
      let envelopeFrom = "";
      try {
        const envStr = safeStr(rawBody.envelope);
        if (envStr) {
          const env = JSON.parse(envStr);
          envelopeFrom = extractEmailFromAddr(env && env.from);
        }
      } catch { /* ignore */ }

      const toAddresses = collectInboundToAddresses(b, rawBody);
      const targetDoc = await findTargetForReply(tenantId, from, envelopeFrom, toAddresses);
      if (!targetDoc) {
        logger.info("inbound_parse_target_not_found", {
          tenantId,
          from,
          envelopeFrom,
          to,
          toAddresses,
        });
        await recordReplyWebhookTrace(tenantId, {
          source: "inbound_parse",
          from,
          matched: false,
          stage: "target_not_found",
        });
        return res.json({ok: true, matched: false});
      }

      const targetRef = targetDoc.ref;
      const target = Object.assign({id: targetDoc.id}, targetDoc.data() || {});

      stage = "dedupe";
      const inboundCol = targetRef.collection("inboundReplies");
      try {
        const dedupe = await inboundCol.where("inboundMessageId", "==", messageId).limit(1).get();
        if (!dedupe.empty) {
          return res.json({ok: true, matched: true, deduped: true});
        }
      } catch (e) {
        logger.warn("inbound_dedupe_query_failed", {err: e && e.message ? e.message : e});
      }

      stage = "write_inbound";
      const nowIso = new Date().toISOString();
      const snippet = inboundBody.slice(0, 500);
      const inboundRef = inboundCol.doc();
      const inboundDoc = sanitizeForFirestore({
        tenantId,
        targetId: targetDoc.id,
        from,
        to,
        subject: subject.slice(0, 998),
        bodyPlain: text.slice(0, 100000),
        bodyHtml: html.slice(0, 200000),
        inboundSnippet: snippet,
        inboundMessageId: messageId,
        receivedAt: nowIso,
        createdAt: FieldValue.serverTimestamp(),
      });
      try {
        await inboundRef.set(inboundDoc);
      } catch (e) {
        logger.warn("inbound_reply_write_failed", {err: e && e.message ? e.message : e, targetId: targetDoc.id});
      }

      // ----- CORE: mark the target as replied FIRST. Everything below is best-effort. -----
      stage = "core_target_update";
      const inboundMessageIdHeader = messageId;
      const priorThreadRefs = collectThreadRefs(
        target.lastInboundMessageId,
        target.lastOutboundMessageId,
        target.threadReferences,
      );
      const threadReferences = mergeThreadRefs(priorThreadRefs, inboundMessageIdHeader);
      const replyContext = resolveRepliedToTouch(target, subject);
      const contactName = contactDisplayNameFromTarget(target);
      const contactEmail = String(
        target.contactEmail || (target.contact && target.contact.email) || from || ""
      )
        .trim()
        .toLowerCase();

      const coreUpdate = sanitizeForFirestore({
        lastReplyAt: nowIso,
        lastInboundMessageId: inboundMessageIdHeader,
        threadReferences,
        lastReplyCampaignName: replyContext.campaignName || "",
        pipelineStatus: "waiting_on_us",
        replyState: "pending_review",
        sequenceStatus: "cancelled",
        nextSequenceSendAt: FieldValue.delete(),
        sequenceWorkerNote: "cancelled: reply detected",
        awaitingAiReview: false,
        updatedAt: FieldValue.serverTimestamp(),
      });
      try {
        await targetRef.update(coreUpdate);
      } catch (e) {
        logger.error("inbound_core_target_update_failed", {
          err: e && e.message ? e.message : e,
          stack: e && e.stack ? String(e.stack).slice(0, 1200) : undefined,
          tenantId,
          targetId: targetDoc.id,
        });
        // The Pipeline yellow light is the headline outcome — if even this fails, surface 500.
        return res.status(500).json({error: "Inbound parse failed", stage: "core_target_update"});
      }

      // ----- BEST-EFFORT: AI draft, notifications, optional auto-send. Wrapped so any
      // failure here still leaves the Pipeline in "they replied" state. -----
      const notifyUid = String(target.kickoffAuthorUid || "").trim() || null;
      const notifyEmail = String(target.kickoffAuthorEmail || "").trim() || null;
      const threadAssist =
        target.inboundThreadAssist && typeof target.inboundThreadAssist === "object"
          ? target.inboundThreadAssist
          : {};
      const aiEnabled = !!threadAssist.enabled;
      let aiSubject = `Re: ${subject || (target.lastEmailSubject || "your message")}`.slice(0, 120);
      let aiBody =
        "Hi,\n\nThanks for the reply. I got your note and will follow up shortly.";
      let confidence = 0;
      let riskFlags = [];
      let sentiment = "neutral";
      let intent = "other";

      stage = "ai_draft";
      if (aiEnabled && (process.env.OPENAI_API_KEY || "").trim()) {
        try {
          const OpenAIMod = require("openai");
          const OpenAI = OpenAIMod.default || OpenAIMod;
          const client = new OpenAI({apiKey: String(process.env.OPENAI_API_KEY || "").trim()});
          const ai = await draftInboundAiReply(client, target, {
            inboundFrom: from,
            inboundSubject: subject,
            inboundBody,
          });
          aiSubject = ai.subject || aiSubject;
          aiBody = ai.bodyPlain || aiBody;
          confidence = Number.isFinite(Number(ai.confidence)) ? Number(ai.confidence) : 0;
          riskFlags = Array.isArray(ai.riskFlags) ? ai.riskFlags : [];
          sentiment = ai.sentiment || "neutral";
          intent = ai.intent || "other";
        } catch (e) {
          logger.warn("inbound_ai_draft_failed", {err: e && e.message ? e.message : e});
          confidence = 0.5;
          riskFlags = ["ai_draft_failed"];
          sentiment = "neutral";
          intent = "other";
        }
      }

      // Update sentiment/intent on the target (separate from the core write so an
      // unexpected schema issue here can't mask the Pipeline-yellow update).
      try {
        await targetRef.update(sanitizeForFirestore({
          replySentiment: sentiment,
          replyIntent: intent,
        }));
      } catch (e) {
        logger.warn("inbound_sentiment_update_failed", {err: e && e.message ? e.message : e});
      }

      // Auto-send requires explicit opt-in (`inboundThreadAssist.autoSend: true`).
      // Enabling AI (`inboundThreadAssist.enabled`) only turns on AI *drafting* — it
      // still routes to pending_review so the user can review before anything is sent.
      // This means Pipeline always stays yellow ("waiting_on_us") after a reply is
      // detected, regardless of the AI setting.
      const autoSendEnabled = !!threadAssist.autoSend;
      const requireHuman = !!threadAssist.requireHumanOnLowConfidence;
      const negativeIntents = ["unsubscribe", "not_interested", "wrong_person", "negative"];
      const intentRequiresHuman = negativeIntents.indexOf(intent) >= 0;
      let needsHuman;
      if (!aiEnabled || !autoSendEnabled) {
        // No AI, or AI is on but auto-send not explicitly enabled → always draft for review.
        needsHuman = true;
      } else if (requireHuman) {
        needsHuman = confidence < 0.75 || riskFlags.length > 0 || sentiment !== "positive" || intentRequiresHuman;
      } else {
        needsHuman =
          sentiment !== "positive" ||
          confidence < 0.7 ||
          riskFlags.length > 0 ||
          intentRequiresHuman;
      }

      stage = "pending_or_send";
      if (needsHuman) {
        let pendingId = null;
        try {
          const pendingRef = db.collection("tenants").doc(tenantId).collection("inboundReplyPending").doc();
          const pendingPayload = sanitizeForFirestore({
            tenantId,
            targetId: targetDoc.id,
            status: "pending",
            inboundReplyId: inboundRef.id,
            inboundMessageId: messageId,
            inboundSnippet: snippet,
            inboundSubject: subject.slice(0, 998),
            campaignName: replyContext.campaignName || "",
            contactEmail,
            contactName,
            pendingDraft: {subject: aiSubject, bodyPlain: aiBody},
            notifyUid,
            notifyEmail,
            confidence,
            riskFlags,
            sentiment,
            intent,
            threadReferences,
            createdAt: FieldValue.serverTimestamp(),
            createdAtIso: nowIso,
          });
          await pendingRef.set(pendingPayload);
          pendingId = pendingRef.id;

          if (notifyUid) {
            await createInAppNotification(db, tenantId, {
              uid: notifyUid,
              kind: "inbound_pending",
              targetId: targetDoc.id,
              pendingId: pendingRef.id,
              company: String(target.companyName || target.name || "Lead").trim() || "Lead",
              snippet,
              campaignName: replyContext.campaignName || "",
              contactName,
              sentiment,
              intent,
              confidence,
              riskFlags,
            });
          }
          try {
            await notifyInboundReviewRequired(target, Object.assign({id: pendingRef.id}, pendingPayload), tenantId);
          } catch (e) {
            logger.warn("inbound_notify_review_failed", {err: e && e.message ? e.message : e});
          }
        } catch (e) {
          logger.warn("inbound_pending_write_failed", {err: e && e.message ? e.message : e});
        }
        return res.json({
          ok: true,
          matched: true,
          pendingId,
          mode: "pending_review",
          sentiment,
          intent,
          elapsedMs: Date.now() - startedAt,
        });
      }

      // Auto-send path (best-effort, only reached when autoSend is explicitly enabled).
      // Never append Calendly to inbound auto-replies — Calendly is for outbound only.
      const toSend = normEmail(target.contactEmail || (target.contact && target.contact.email) || from);
      const inboundSenderOpts = senderOptsFromRecord(target);
      const {text: sendText, html: sendHtml} = buildCalendlyBlocks(aiBody, "", null, inboundSenderOpts);
      try {
        await sendOutreachMail({
          to: toSend,
          subject: aiSubject,
          text: sendText,
          html: sendHtml,
          targetId: targetDoc.id,
          fromName: inboundSenderOpts.senderName,
          inReplyTo: inboundMessageIdHeader,
          references: threadReferences,
        });
      } catch (e) {
        logger.warn("inbound_auto_send_failed", {err: e && e.message ? e.message : e});
        // Auto-send failed → leave as pending_review (already set in coreUpdate).
        return res.json({
          ok: true,
          matched: true,
          mode: "auto_send_failed_kept_pending",
          sentiment,
          intent,
          elapsedMs: Date.now() - startedAt,
        });
      }

      try {
        const touchHistory = Array.isArray(target.touchHistory) ? target.touchHistory.slice() : [];
        touchHistory.push({
          kind: "inbound_ai_reply",
          stage: target.sequenceNextStageIndex || 0,
          subject: aiSubject,
          bodyPlain: sendText,
          sentAt: nowIso,
          sentiment,
          intent,
        });
        // Keep pipelineStatus: "waiting_on_us" (yellow) even after auto-send.
        // The lead replied — it stays on "their turn" (us) until YOU manually reply
        // and click "Mark I replied". Do NOT flip to waiting_on_them here.
        const update = sanitizeForFirestore({
          replyState: "ai_sent",
          touchHistory,
          lastEmailSubject: aiSubject,
          lastEmailSentAt: nowIso,
          pipelineStatus: "waiting_on_us",
        });
        await targetRef.update(update);
      } catch (e) {
        logger.warn("inbound_post_send_update_failed", {err: e && e.message ? e.message : e});
      }

      if (notifyUid) {
        try {
          await createInAppNotification(db, tenantId, {
            uid: notifyUid,
            kind: "inbound_auto_sent",
            targetId: targetDoc.id,
            company: String(target.companyName || target.name || "Lead").trim() || "Lead",
            snippet,
            sentiment,
            intent,
            confidence,
            subject: aiSubject,
          });
        } catch (e) {
          logger.warn("inbound_auto_sent_notification_failed", {err: e && e.message ? e.message : e});
        }
      }

      return res.json({
        ok: true,
        matched: true,
        mode: "auto_sent",
        sentiment,
        intent,
        elapsedMs: Date.now() - startedAt,
      });
    } catch (e) {
      logger.error("inbound_email_parse_failed", {
        stage,
        err: e && e.message ? e.message : String(e),
        stack: e && e.stack ? String(e.stack).slice(0, 1500) : undefined,
        elapsedMs: Date.now() - startedAt,
      });
      return res.status(500).json({error: "Inbound parse failed", stage});
    }
  });

  /**
   * Zapier-friendly reply webhook (JSON). Use when a Gmail "New Email" Zap fires:
   *   POST /api/webhooks/reply?token=REPLY_WEBHOOK_SECRET
   *   { "tenantId": "default", "from": "lead@acme.com", "subject": "...", "body": "..." }
   *
   * Unlike /api/inbound/email-parse this takes plain JSON (no multipart), does NOT
   * require a logged-in user, and matches the lead purely by sender address (`from`).
   * It does the one job that matters — flip the Pipeline to "they replied" (yellow) —
   * and treats everything else (storing the body, notifying) as best-effort.
   */
  app.post("/api/webhooks/reply", async (req, res) => {
    const startedAt = Date.now();
    try {
      const tokenExpected = String(process.env.REPLY_WEBHOOK_SECRET || "").trim();
      const tokenGot = String(req.query.token || req.headers["x-reply-secret"] || "").trim();
      if (!tokenExpected || tokenGot !== tokenExpected) {
        return res.status(401).json({error: "Unauthorized reply webhook"});
      }

      const b = req.body && typeof req.body === "object" ? req.body : {};
      const tenantId =
        (String(b.tenantId || b.tenant_id || "default").trim() || "default").toLowerCase();
      const from = extractEmailFromAddr(pickField(b, "from", "From", "sender", "Sender"));
      const subject = pickField(b, "subject", "Subject").slice(0, 998);
      const body = pickField(b, "body", "text", "plain", "snippet", "Body", "html");

      if (!from) {
        return res.status(200).json({ok: true, matched: false, skipped: "missing_from"});
      }

      // Match by sender only (no per-target plus-address available from a generic
      // Gmail Zap), but reuse the same lookup so contactEmail / contact.email both work.
      const targetDoc = await findTargetForReply(tenantId, from, "", []);
      if (!targetDoc) {
        logger.info("reply_webhook_target_not_found", {tenantId, from});
        await recordReplyWebhookTrace(tenantId, {
          source: "zapier_webhook",
          from,
          matched: false,
          stage: "target_not_found",
        });
        return res.json({ok: true, matched: false});
      }

      const targetRef = targetDoc.ref;
      const target = Object.assign({id: targetDoc.id}, targetDoc.data() || {});
      const nowIso = new Date().toISOString();
      const snippet = body.slice(0, 500);

      try {
        await targetRef.collection("inboundReplies").doc().set(sanitizeForFirestore({
          tenantId,
          targetId: targetDoc.id,
          from,
          subject,
          bodyPlain: body.slice(0, 100000),
          inboundSnippet: snippet,
          source: "zapier_webhook",
          receivedAt: nowIso,
          createdAt: FieldValue.serverTimestamp(),
        }));
      } catch (e) {
        logger.warn("reply_webhook_inbound_write_failed", {
          err: e && e.message ? e.message : e,
          targetId: targetDoc.id,
        });
      }

      const replyContext = resolveRepliedToTouch(target, subject);
      const contactName = contactDisplayNameFromTarget(target);

      // ----- CORE: flip Pipeline to "they replied" (yellow). -----
      const coreUpdate = sanitizeForFirestore({
        lastReplyAt: nowIso,
        lastReplyCampaignName: replyContext.campaignName || "",
        pipelineStatus: "waiting_on_us",
        replyState: "pending_review",
        sequenceStatus: "cancelled",
        nextSequenceSendAt: FieldValue.delete(),
        sequenceWorkerNote: "cancelled: reply detected (zapier)",
        awaitingAiReview: false,
        updatedAt: FieldValue.serverTimestamp(),
      });
      try {
        await targetRef.update(coreUpdate);
      } catch (e) {
        logger.error("reply_webhook_core_update_failed", {
          err: e && e.message ? e.message : e,
          tenantId,
          targetId: targetDoc.id,
        });
        return res.status(500).json({error: "Reply webhook failed", stage: "core_target_update"});
      }

      // Best-effort in-app notification for the lead's owner.
      const notifyUid = String(target.kickoffAuthorUid || "").trim() || null;
      if (notifyUid) {
        try {
          await createInAppNotification(db, tenantId, {
            uid: notifyUid,
            kind: "inbound_pending",
            targetId: targetDoc.id,
            company: String(target.companyName || target.name || "Lead").trim() || "Lead",
            subject,
            snippet,
            campaignName: replyContext.campaignName || "",
            contactName,
          });
        } catch (e) {
          logger.warn("reply_webhook_notify_failed", {err: e && e.message ? e.message : e});
        }
      }

      await recordReplyWebhookTrace(tenantId, {
        source: "zapier_webhook",
        from,
        matched: true,
        targetId: targetDoc.id,
        stage: "core_update_ok",
      });

      return res.json({
        ok: true,
        matched: true,
        targetId: targetDoc.id,
        company: String(target.companyName || target.name || "").trim(),
        elapsedMs: Date.now() - startedAt,
      });
    } catch (e) {
      logger.error("reply_webhook_failed", {
        err: e && e.message ? e.message : String(e),
        stack: e && e.stack ? String(e.stack).slice(0, 1200) : undefined,
      });
      return res.status(500).json({error: "Reply webhook failed"});
    }
  });

  app.get("/api/inbound-replies/pending", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) {
      return;
    }
    const tenantId = req.query.tenantId != null ? String(req.query.tenantId).trim() : "";
    const targetIdFilter = req.query.targetId != null ? String(req.query.targetId).trim() : "";
    if (!tenantId) {
      return res.status(400).json({error: "tenantId is required"});
    }
    try {
      let q = db
        .collection("tenants")
        .doc(tenantId)
        .collection("inboundReplyPending")
        .where("status", "==", "pending");
      if (targetIdFilter) {
        q = q.where("targetId", "==", targetIdFilter);
      }
      const snap = await q.limit(60).get();
      const items = snap.docs.map((d) => {
        const data = d.data() || {};
        return {
          id: d.id,
          targetId: data.targetId,
          inboundSnippet: String(data.inboundSnippet || ""),
          inboundSubject: String(data.inboundSubject || ""),
          campaignName: String(data.campaignName || ""),
          contactEmail: String(data.contactEmail || ""),
          contactName: String(data.contactName || ""),
          confidence: data.confidence != null ? Number(data.confidence) : null,
          riskFlags: Array.isArray(data.riskFlags) ? data.riskFlags : [],
          sentiment: data.sentiment ? String(data.sentiment) : "neutral",
          intent: data.intent ? String(data.intent) : "other",
          pendingDraft: deepSerialize(data.pendingDraft || {}),
          createdAtIso: extractFirstIsoDate(data.createdAtIso || data.createdAt),
        };
      });
      return res.json({items});
    } catch (e) {
      logger.error("inbound_pending_list_failed", {err: e && e.message ? e.message : e});
      return res.status(500).json({items: []});
    }
  });

  app.post("/api/inbound-replies/approve", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) {
      return;
    }
    const b = req.body || {};
    const tenantId = String(b.tenantId || "").trim();
    const pendingId = String(b.pendingId || "").trim();
    const subject = String(b.subject || "").trim();
    const text = String(b.text || "").trim();
    if (!tenantId || !pendingId || !subject || !text) {
      return res.status(400).json({error: "tenantId, pendingId, subject, and text are required"});
    }
    try {
      const pendingRef = db.collection("tenants").doc(tenantId).collection("inboundReplyPending").doc(pendingId);
      const pendingDoc = await pendingRef.get();
      if (!pendingDoc.exists) {
        return res.status(404).json({error: "Pending item not found"});
      }
      const pending = pendingDoc.data() || {};
      if (String(pending.status || "") !== "pending") {
        return res.status(409).json({error: "Pending item already resolved"});
      }
      if (String(pending.notifyUid || "") !== user.uid) {
        return res.status(403).json({error: "Not allowed"});
      }
      const targetId = String(pending.targetId || "").trim();
      if (!targetId) {
        return res.status(400).json({error: "Pending item missing targetId"});
      }
      const targetRef = db.collection("tenants").doc(tenantId).collection("targets").doc(targetId);
      const targetDoc = await targetRef.get();
      if (!targetDoc.exists) {
        return res.status(404).json({error: "Target not found"});
      }
      const target = targetDoc.data() || {};
      const to = normEmail(target.contactEmail || (target.contact && target.contact.email) || "");
      if (!to) {
        return res.status(400).json({error: "Target has no email"});
      }
      const calendlyLinkRaw = String(target.calendlyLink || "").trim();
      const calendlyLink = validateCalendlyUrl(calendlyLinkRaw) || "";
      const calendlyRef = nextCalendlyRef(target.calendlyRef, !!calendlyLink);
      const approveSenderOpts = senderOptsFromRecord(target);
      const {text: sentText, html: sentHtml} = buildCalendlyBlocks(text, calendlyLink, calendlyRef, approveSenderOpts);
      // Use the inbound Message-Id from the pending doc (or fallback to the target's lastInboundMessageId)
      // so approved replies thread the same way auto-sends do.
      const inReplyToHeader =
        String(pending.inboundMessageId || target.lastInboundMessageId || "").trim();
      const referencesHeader = Array.isArray(pending.threadReferences) && pending.threadReferences.length
        ? pending.threadReferences
        : Array.isArray(target.threadReferences)
          ? target.threadReferences
          : "";
      await sendOutreachMail({
        to,
        subject,
        text: sentText,
        html: sentHtml,
        targetId,
        fromName: approveSenderOpts.senderName,
        inReplyTo: inReplyToHeader,
        references: referencesHeader,
      });

      const sentAt = new Date().toISOString();
      const hist = Array.isArray(target.touchHistory) ? target.touchHistory.slice() : [];
      hist.push({
        kind: "inbound_ai_reply_approved",
        stage: target.sequenceNextStageIndex || 0,
        subject,
        bodyPlain: sentText,
        sentAt,
      });
      const targetUpdate = {
        touchHistory: hist,
        lastEmailSubject: subject,
        lastEmailSentAt: sentAt,
        pipelineStatus: "waiting_on_them",
        replyState: "ai_sent",
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (calendlyRef && calendlyRef !== target.calendlyRef) {
        targetUpdate.calendlyRef = calendlyRef;
      }
      await targetRef.update(targetUpdate);
      await pendingRef.update({
        status: "approved",
        resolvedAt: FieldValue.serverTimestamp(),
        resolvedByUid: user.uid,
      });
      return res.json({ok: true});
    } catch (e) {
      logger.error("inbound_pending_approve_failed", {err: e && e.message ? e.message : e});
      return res.status(500).json({error: "Approve failed"});
    }
  });

  app.post("/api/inbound-replies/discard", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) {
      return;
    }
    const b = req.body || {};
    const tenantId = String(b.tenantId || "").trim();
    const pendingId = String(b.pendingId || "").trim();
    if (!tenantId || !pendingId) {
      return res.status(400).json({error: "tenantId and pendingId are required"});
    }
    try {
      const pendingRef = db.collection("tenants").doc(tenantId).collection("inboundReplyPending").doc(pendingId);
      const pendingDoc = await pendingRef.get();
      if (!pendingDoc.exists) {
        return res.status(404).json({error: "Pending item not found"});
      }
      const pending = pendingDoc.data() || {};
      if (String(pending.notifyUid || "") !== user.uid) {
        return res.status(403).json({error: "Not allowed"});
      }
      await pendingRef.update({
        status: "discarded",
        resolvedAt: FieldValue.serverTimestamp(),
        resolvedByUid: user.uid,
      });
      return res.json({ok: true});
    } catch (e) {
      logger.error("inbound_pending_discard_failed", {err: e && e.message ? e.message : e});
      return res.status(500).json({error: "Discard failed"});
    }
  });

  app.post("/api/ai-sequence/approve", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) {
      return;
    }
    const b = req.body || {};
    const tenantId = String(b.tenantId || "").trim();
    const targetId = String(b.targetId || "").trim();
    const subject = String(b.subject || "").trim();
    const text = String(b.text || "").trim();
    if (!tenantId || !targetId || !subject || !text) {
      return res.status(400).json({error: "tenantId, targetId, subject, and text are required"});
    }
    try {
      const ref = db.collection("tenants").doc(tenantId).collection("targets").doc(targetId);
      const doc = await ref.get();
      if (!doc.exists) {
        return res.status(404).json({error: "Target not found"});
      }
      const target = doc.data() || {};
      const to = normEmail(target.contactEmail || (target.contact && target.contact.email) || "");
      if (!to) {
        return res.status(400).json({error: "Target has no email"});
      }

      const calendlyLinkRaw = String(target.calendlyLink || "").trim();
      const calendlyLink = validateCalendlyUrl(calendlyLinkRaw) || "";
      const calendlyRef = nextCalendlyRef(target.calendlyRef, !!calendlyLink);
      const seqSenderOpts = senderOptsFromRecord(target);
      const fillOpts = {email: to};
      const subjectForSend = fillOutreachTemplate(subject, target, fillOpts);
      const textForSend = fillOutreachTemplate(text, target, fillOpts);
      const {text: sentText, html: sentHtml} = buildCalendlyBlocks(textForSend, calendlyLink, calendlyRef, seqSenderOpts);

      await sendOutreachMail({
        to,
        subject: subjectForSend,
        text: sentText,
        html: sentHtml,
        targetId,
        fromName: seqSenderOpts.senderName,
      });

      const sentAt = new Date().toISOString();
      const stages = target.aiFollowupStages || [];
      const schedule = target.schedule || {};
      const approvedStageIdx = parseInt(String(target.sequenceNextStageIndex || 1), 10) || 1;
      const stageUsed = getStageBySequenceIndex(stages, approvedStageIdx);
      const maxStages = maxFollowupStagesFromTarget(target, stages);
      const nextIdx = approvedStageIdx + 1;
      const nextStage = getStageBySequenceIndex(stages, nextIdx);
      let nextSequenceSendAtIso = null;
      let nextSend = FieldValue.delete();
      let status = "complete";
      if (nextStage && nextIdx <= maxStages) {
        const nextIso = computeNextStageSendAt(sentAt, nextStage, schedule);
        nextSequenceSendAtIso = nextIso;
        nextSend = admin.firestore.Timestamp.fromDate(new Date(nextIso));
        status = "active";
      }

      const touch = Object.assign(
        {
          kind: "ai_followup_approved",
          stage: approvedStageIdx,
          subject: subjectForSend,
          bodyPlain: sentText,
          sentAt,
        },
        followupTouchSnapshot(target, stageUsed, approvedStageIdx, maxStages, nextSequenceSendAtIso)
      );
      const prevHist = Array.isArray(target.touchHistory) ? target.touchHistory.slice() : [];
      prevHist.push(touch);

      const approveUpdate = {
        touchHistory: prevHist,
        lastEmailSubject: subjectForSend,
        lastEmailSentAt: sentAt,
        sequenceNextStageIndex: nextIdx,
        sequenceStatus: status,
        nextSequenceSendAt: nextSend,
        awaitingAiReview: false,
        pipelineStatus: "waiting_on_them",
      };
      if (calendlyRef && calendlyRef !== target.calendlyRef) {
        approveUpdate.calendlyRef = calendlyRef;
      }
      await ref.update(approveUpdate);

      const pendSnap = await db
        .collection("tenants")
        .doc(tenantId)
        .collection("aiSequencePending")
        .where("targetId", "==", targetId)
        .where("status", "==", "pending")
        .get();
      const batch = db.batch();
      pendSnap.docs.forEach((d) => batch.update(d.ref, {status: "approved", resolvedAt: FieldValue.serverTimestamp()}));
      await batch.commit();

      return res.json({ok: true});
    } catch (e) {
      logger.error("ai_sequence_approve_failed", {err: e && e.message ? e.message : e});
      return res.status(500).json({error: "Approve failed"});
    }
  });

  app.post("/api/ai-sequence/discard", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) {
      return;
    }
    const b = req.body || {};
    const tenantId = String(b.tenantId || "").trim();
    const targetId = String(b.targetId || "").trim();
    const action = String(b.action || "").trim();
    if (!tenantId || !targetId) {
      return res.status(400).json({error: "tenantId and targetId are required"});
    }
    try {
      const ref = db.collection("tenants").doc(tenantId).collection("targets").doc(targetId);
      const pendSnap = await db
        .collection("tenants")
        .doc(tenantId)
        .collection("aiSequencePending")
        .where("targetId", "==", targetId)
        .where("status", "==", "pending")
        .get();
      const batch = db.batch();
      pendSnap.docs.forEach((d) =>
        batch.update(d.ref, {status: action === "stop_sequence" ? "stopped" : "skipped", resolvedAt: FieldValue.serverTimestamp()})
      );

      if (action === "stop_sequence") {
        batch.update(ref, {
          sequenceStatus: "cancelled",
          nextSequenceSendAt: FieldValue.delete(),
          awaitingAiReview: false,
        });
      } else {
        const doc = await ref.get();
        const target = doc.data() || {};
        const stages = target.aiFollowupStages || [];
        const schedule = target.schedule || {};
        const idx = parseInt(String(target.sequenceNextStageIndex || 1), 10) || 1;
        const stage = getStageBySequenceIndex(stages, idx);
        const bump = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
        const nextIso = stage ? computeNextStageSendAt(bump, stage, schedule) : bump;
        batch.update(ref, {
          nextSequenceSendAt: admin.firestore.Timestamp.fromDate(new Date(nextIso)),
          awaitingAiReview: false,
          sequenceStatus: "active",
        });
      }
      await batch.commit();
      return res.json({ok: true});
    } catch (e) {
      logger.error("ai_sequence_discard_failed", {err: e && e.message ? e.message : e});
      return res.status(500).json({error: "Discard failed"});
    }
  });

  app.post("/api/targets/bulk-import", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) {
      return;
    }
    const b = req.body || {};
    const tenantId = String(b.tenantId || "default").trim() || "default";
    const contacts = Array.isArray(b.contacts) ? b.contacts : [];
    let created = 0;
    const batch = db.batch();
    const slice = contacts.slice(0, 400);
    for (let i = 0; i < slice.length; i++) {
      const c = slice[i] || {};
      const email = normEmail(c.email || c.contactEmail);
      if (!email || email.indexOf("@") < 1) {
        continue;
      }
      const ref = db.collection("tenants").doc(tenantId).collection("targets").doc();
      const company = String(c.company || c.companyName || "").trim() || email.split("@")[1] || "Imported";
      const doc = {
        tenantId,
        companyName: company.slice(0, 200),
        contactEmail: email,
        contact: {
          email,
          firstName: String(c.firstName || "").trim().slice(0, 80),
          lastName: String(c.lastName || "").trim().slice(0, 80),
          name: [c.firstName, c.lastName].filter(Boolean).join(" ").trim().slice(0, 120),
        },
        pipelineStatus: "need_send",
        createdAt: FieldValue.serverTimestamp(),
      };
      const vibe = trimOutreachVibe(c.outreachVibe);
      if (vibe) {
        doc.outreachVibe = vibe;
      }
      batch.set(ref, doc);
      created++;
    }
    try {
      await batch.commit();
      return res.json({created, ok: true});
    } catch (e) {
      logger.error("bulk_import_targets_failed", {err: e && e.message ? e.message : e});
      return res.status(500).json({error: "Bulk import failed"});
    }
  });

  app.post("/api/leads/bulk-import", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) {
      return;
    }
    const b = req.body || {};
    const tenantId = String(b.tenantId || "default").trim() || "default";
    const contacts = Array.isArray(b.contacts) ? b.contacts : [];
    let created = 0;
    const batch = db.batch();
    const slice = contacts.slice(0, 400);
    for (let i = 0; i < slice.length; i++) {
      const c = slice[i] || {};
      const email = normEmail(c.email || "");
      const phone = String(c.phone || "").trim();
      if (!email && !phone) {
        continue;
      }
      const ref = db.collection("tenants").doc(tenantId).collection("leads").doc();
      const name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || "Lead";
      batch.set(ref, {
        tenantId,
        contact: {
          name: name.slice(0, 120),
          email: email || "",
          phone: phone.slice(0, 40),
        },
        status: "new",
        source: {provider: "import"},
        createdAt: FieldValue.serverTimestamp(),
      });
      created++;
    }
    try {
      await batch.commit();
      return res.json({created, ok: true});
    } catch (e) {
      logger.error("bulk_import_leads_failed", {err: e && e.message ? e.message : e});
      return res.status(500).json({error: "Bulk import failed"});
    }
  });

  app.post("/api/targets/:tenantId/:targetId/mark-booked", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) {
      return;
    }
    const tenantId = (req.params.tenantId || "").trim();
    const targetId = (req.params.targetId || "").trim();
    if (!tenantId || !targetId) {
      return res.status(400).json({error: "tenantId and targetId required"});
    }
    try {
      const ref = db.collection("tenants").doc(tenantId).collection("targets").doc(targetId);
      const snap = await ref.get();
      if (!snap.exists) {
        return res.status(404).json({error: "Target not found"});
      }
      const target = snap.data() || {};
      const prevHist = Array.isArray(target.touchHistory) ? target.touchHistory.slice() : [];
      prevHist.push({kind: "meeting_booked", sentAt: new Date().toISOString()});
      await ref.update({
        pipelineStatus: "booked",
        sequenceStatus: "cancelled",
        nextSequenceSendAt: FieldValue.delete(),
        awaitingAiReview: false,
        sequenceWorkerNote: "cancelled: meeting booked",
        touchHistory: prevHist,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return res.json({ok: true});
    } catch (e) {
      logger.error("mark_booked_failed", {err: e && e.message ? e.message : e});
      return res.status(500).json({error: "mark-booked failed"});
    }
  });

  app.post("/api/targets/:tenantId/:targetId/mark-replied", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) {
      return;
    }
    const tenantId = (req.params.tenantId || "").trim();
    const targetId = (req.params.targetId || "").trim();
    if (!tenantId || !targetId) {
      return res.status(400).json({error: "tenantId and targetId required"});
    }
    try {
      const ref = db.collection("tenants").doc(tenantId).collection("targets").doc(targetId);
      const snap = await ref.get();
      if (!snap.exists) {
        return res.status(404).json({error: "Target not found"});
      }
      const target = snap.data() || {};
      const prevHist = Array.isArray(target.touchHistory) ? target.touchHistory.slice() : [];
      const replyAt = new Date().toISOString();
      prevHist.push({kind: "mark_replied", sentAt: replyAt});
      await ref.update({
        lastReplyAt: replyAt,
        pipelineStatus: "waiting_on_us",
        sequenceStatus: "cancelled",
        nextSequenceSendAt: FieldValue.delete(),
        awaitingAiReview: false,
        sequenceWorkerNote: "cancelled: reply detected",
        touchHistory: prevHist,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return res.json({ok: true});
    } catch (e) {
      logger.error("mark_replied_failed", {err: e && e.message ? e.message : e});
      return res.status(500).json({error: "mark-replied failed"});
    }
  });

  app.post("/api/targets/:tenantId/:targetId/mark-i-replied", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) {
      return;
    }
    const tenantId = (req.params.tenantId || "").trim();
    const targetId = (req.params.targetId || "").trim();
    if (!tenantId || !targetId) {
      return res.status(400).json({error: "tenantId and targetId required"});
    }
    try {
      const ref = db.collection("tenants").doc(tenantId).collection("targets").doc(targetId);
      const snap = await ref.get();
      if (!snap.exists) {
        return res.status(404).json({error: "Target not found"});
      }
      await ref.update({
        pipelineStatus: "waiting_on_them",
        updatedAt: FieldValue.serverTimestamp(),
      });
      return res.json({ok: true});
    } catch (e) {
      logger.error("mark_i_replied_failed", {err: e && e.message ? e.message : e});
      return res.status(500).json({error: "mark-i-replied failed"});
    }
  });

  app.post("/api/targets/:tenantId/:targetId/stop-followups", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) {
      return;
    }
    const tenantId = (req.params.tenantId || "").trim();
    const targetId = (req.params.targetId || "").trim();
    if (!tenantId || !targetId) {
      return res.status(400).json({error: "tenantId and targetId required"});
    }
    try {
      const ref = db.collection("tenants").doc(tenantId).collection("targets").doc(targetId);
      const snap = await ref.get();
      if (!snap.exists) {
        return res.status(404).json({error: "Target not found"});
      }
      await ref.update({
        sequenceStatus: "cancelled",
        nextSequenceSendAt: FieldValue.delete(),
        awaitingAiReview: false,
        followupsPaused: true,
        followupsStoppedAt: new Date().toISOString(),
        sequenceWorkerNote: "cancelled: manually stopped",
        updatedAt: FieldValue.serverTimestamp(),
      });
      return res.json({ok: true});
    } catch (e) {
      logger.error("stop_followups_failed", {err: e && e.message ? e.message : e});
      return res.status(500).json({error: "stop-followups failed"});
    }
  });

  app.delete("/api/targets/:tenantId/:targetId", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) {
      return;
    }
    const tenantId = (req.params.tenantId || "").trim();
    const targetId = (req.params.targetId || "").trim();
    if (!tenantId || !targetId) {
      return res.status(400).json({error: "tenantId and targetId required"});
    }
    try {
      await db.collection("tenants").doc(tenantId).collection("targets").doc(targetId).delete();
      return res.json({ok: true});
    } catch (e) {
      logger.error("target_delete_failed", {err: e && e.message ? e.message : e});
      return res.status(500).json({error: "Delete failed"});
    }
  });

  app.delete("/api/leads/:tenantId/:leadId", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) {
      return;
    }
    const tenantId = (req.params.tenantId || "").trim();
    const leadId = (req.params.leadId || "").trim();
    if (!tenantId || !leadId) {
      return res.status(400).json({error: "tenantId and leadId required"});
    }
    try {
      await db.collection("tenants").doc(tenantId).collection("leads").doc(leadId).delete();
      return res.json({ok: true});
    } catch (e) {
      logger.error("lead_delete_failed", {err: e && e.message ? e.message : e});
      return res.status(500).json({error: "Delete failed"});
    }
  });

  app.get("/api/email/delivery-status", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    const key = (process.env.SENDGRID_API_KEY || "").trim();
    const dry =
      process.env.EMAIL_DRY_RUN === "1" ||
      process.env.EMAIL_DRY_RUN === "true" ||
      !key;
    return res.json({
      deliveryMode: dry ? "dry_run" : "sendgrid",
      hasSendGridKey: !!key,
      fromEmail: (process.env.SENDGRID_FROM_EMAIL || "").trim() || "noreply@example.com",
    });
  });

  app.post("/api/email/preview", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) {
      return;
    }
    const b = req.body || {};
    const tenantId = String(b.tenantId || "default").trim() || "default";
    const to = normEmail(b.to || "");
    const subject = String(b.subject || "").trim();
    const rawBody = String(b.text || "");
    if (!to) {
      return res.status(400).json({error: "Recipient to is required"});
    }
    if (!subject) {
      return res.status(400).json({error: "Subject is required"});
    }
    const outreachSenderName = String(b.outreachSenderName || "").trim().slice(0, 120);
    if (!outreachSenderName) {
      return res.status(400).json({error: "Your name is required — it appears in the email signature.", sent: false});
    }
    const outreachSenderTitle = String(b.outreachSenderTitle || "Account Lead").trim().slice(0, 120);

    const targetsCol = db.collection("tenants").doc(tenantId).collection("targets");
    let targetRef;
    let targetCreated = false;
    let targetUpdated = false;
    const existingId = b.targetId ? String(b.targetId).trim() : "";

    if (existingId) {
      targetRef = targetsCol.doc(existingId);
      const ex = await targetRef.get();
      if (!ex.exists) {
        return res.status(404).json({error: "targetId not found", sent: false});
      }
      targetUpdated = true;
    } else {
      const q = await targetsCol.where("contactEmail", "==", to).limit(1).get();
      if (!q.empty) {
        targetRef = q.docs[0].ref;
        targetUpdated = true;
      } else {
        targetRef = targetsCol.doc();
        targetCreated = true;
      }
    }

    const prev = (await targetRef.get()).data() || {};

    const calendlyLinkRaw = String(b.calendlyLink || prev.calendlyLink || "").trim().slice(0, 500);
    const calendlyLink = validateCalendlyUrl(calendlyLinkRaw) || "";
    const calendlyRef = nextCalendlyRef(prev.calendlyRef, !!calendlyLink);
    const kickoffSenderOpts = {
      senderName: outreachSenderName,
      senderTitle: outreachSenderTitle,
      senderEmail: user.email ? String(user.email).trim().toLowerCase() : "",
    };
    const iceBreakerHint = String(b.iceBreakerHint || "").trim();
    const cityFromPayload = String(b.city || prev.city || "").trim();
    const companyFromPayload =
      String(b.companyName || prev.companyName || "").trim() ||
      (to.includes("@") ? to.split("@")[1] : "");
    const greetingCtx = Object.assign({}, prev, {
      contactEmail: to,
      greetingNameHint: String(b.greetingNameHint || prev.greetingNameHint || "").trim(),
      city: cityFromPayload,
      companyName: companyFromPayload,
      iceBreakerHint,
      outreachSenderName,
      outreachSenderTitle,
      campaignName: String(b.campaignName || prev.campaignName || "").trim(),
      contact: Object.assign({}, prev.contact || {}, {email: to}),
    });
    const fillOpts = {
      email: to,
      outreachSenderName,
      outreachSenderTitle,
      iceBreakerHint,
      city: cityFromPayload,
      companyName: companyFromPayload,
      campaignName: greetingCtx.campaignName,
    };
    const subjectForSend = fillOutreachTemplate(subject, greetingCtx, fillOpts);
    const bodyFilled = fillOutreachTemplate(rawBody, greetingCtx, fillOpts);
    const bodyForSend = normalizeKickoffBody(bodyFilled, greetingCtx, fillOpts);
    const {text: sentText, html: sentHtml} = buildCalendlyBlocks(bodyForSend, calendlyLink, calendlyRef, kickoffSenderOpts);

    let dryRun = false;
    let hasSendGridKey = !!(process.env.SENDGRID_API_KEY || "").trim();
    let sendMessageId = "";
    try {
      const sendResult = await sendOutreachMail({
        to,
        subject: subjectForSend,
        text: sentText,
        html: sentHtml,
        targetId: targetRef.id,
        fromName: outreachSenderName,
      });
      dryRun = !!(sendResult && sendResult.dryRun);
      hasSendGridKey = !!(process.env.SENDGRID_API_KEY || "").trim();
      sendMessageId = sendResult && sendResult.messageId ? String(sendResult.messageId) : "";
      if (dryRun) {
        return res.status(503).json({
          error:
            "Email was not sent — the server is in dry-run mode (SendGrid API key not available at runtime). Contact an admin to bind SENDGRID_API_KEY to Cloud Functions.",
          sent: false,
          dryRun: true,
          deliveryMode: "dry_run",
          hasSendGridKey,
        });
      }
    } catch (e) {
      logger.error("kickoff_send_failed", {err: e && e.message ? e.message : e});
      return res.status(502).json({error: "Failed to send email", sent: false});
    }

    const sentAt = new Date().toISOString();
    const stages = Array.isArray(b.aiFollowupStages) ? b.aiFollowupStages : [];
    const aiOn = b.aiSequence === true;
    const safeAiSendMode = String(b.aiSequenceSendMode || "manual_review").trim().toLowerCase() === "automatic"
      ? "automatic"
      : "manual_review";
    const inboundAssistRaw = b.inboundThreadAssist && typeof b.inboundThreadAssist === "object" ? b.inboundThreadAssist : {};
    const inboundAssist = {
      enabled: inboundAssistRaw.enabled === true,
      autoSend: inboundAssistRaw.enabled === true && inboundAssistRaw.autoSend === true,
      requireHumanOnLowConfidence:
        inboundAssistRaw.enabled === true &&
        (inboundAssistRaw.autoSend === true ? inboundAssistRaw.requireHumanOnLowConfidence === true : false),
    };
    const schedule = b.schedule && typeof b.schedule === "object" ? b.schedule : {};
    const firstStage = aiOn && stages.length ? getStageBySequenceIndex(stages, 1) : null;
    let nextIso = null;
    if (firstStage) {
      nextIso = computeNextStageSendAt(sentAt, firstStage, schedule);
    }

    const maxFollow = maxFollowupStagesFromTarget(prev, stages);
    const cname = String(b.campaignName || prev.campaignName || "").trim().slice(0, 200);
    const touch = Object.assign(
      {
        kind: "kickoff",
        stage: 0,
        subject: subjectForSend,
        bodyPlain: sentText,
        sentAt,
      },
      kickoffTouchSnapshot(prev, cname, stages, maxFollow, nextIso, safeAiSendMode)
    );

    const prevHist = Array.isArray(prev.touchHistory) ? prev.touchHistory.slice() : [];
    prevHist.push(touch);

    const companyName = companyFromPayload || "Unknown company";

    const greetingHint = String(b.greetingNameHint || "").trim();
    const resolvedFirstName = greetingHint.split(/\s+/)[0] || resolveFirstNameForTarget(greetingCtx, {email: to}) || "";
    const nextSendTs =
      aiOn && stages.length && nextIso ? admin.firestore.Timestamp.fromDate(new Date(nextIso)) : null;
    const seqStatus = aiOn && stages.length ? "active" : "none";

    const update = {
      tenantId,
      companyName,
      contactEmail: to,
      contact: Object.assign({}, prev.contact || {}, {
        email: to,
        firstName: resolvedFirstName || (prev.contact && prev.contact.firstName) || "",
      }),
      campaignName: String(b.campaignName || prev.campaignName || "").slice(0, 200),
      lastCampaignName: String(cname || prev.lastCampaignName || "").slice(0, 200),
      calendlyLink: calendlyLink || calendlyLinkRaw.slice(0, 500),
      outreachSenderName,
      outreachSenderTitle,
      lastEmailSentAt: sentAt,
      lastEmailSubject: subjectForSend,
      lastKickoffSubject: subjectForSend,
      lastKickoffBodyPreview: sentText.slice(0, 900),
      touchHistory: prevHist,
      pipelineStatus: "waiting_on_them",
      aiSequence: aiOn,
      aiSequenceSendMode: safeAiSendMode,
      aiFollowupStages: stages,
      maxFollowupStages: parseInt(String(b.maxFollowupStages || stages.length), 10) || stages.length,
      schedule,
      inboundThreadAssist: inboundAssist,
      kickoffAuthorUid: String(user.uid || ""),
      kickoffAuthorEmail: user.email ? String(user.email).trim().toLowerCase() : "",
      sequenceNextStageIndex: 1,
      sequenceStatus: seqStatus,
      awaitingAiReview: false,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (calendlyRef) {
      update.calendlyRef = calendlyRef;
    } else {
      update.calendlyRef = FieldValue.delete();
    }
    if (greetingHint) {
      update.greetingNameHint = greetingHint;
    } else if (resolvedFirstName) {
      update.greetingNameHint = resolvedFirstName;
    }
    if (cityFromPayload) {
      update.city = cityFromPayload;
    }
    if (iceBreakerHint) {
      update.iceBreakerHint = iceBreakerHint;
    }
    const outreachVibeFromPayload = trimOutreachVibe(b.outreachVibe);
    if (outreachVibeFromPayload) {
      update.outreachVibe = outreachVibeFromPayload;
    }
      if (nextSendTs) {
      update.nextSequenceSendAt = nextSendTs;
    } else {
      update.nextSequenceSendAt = FieldValue.delete();
    }

    update.lastSendDeliveryMode = "sendgrid";
    if (sendMessageId) {
      update.lastSendMessageId = sendMessageId.slice(0, 200);
    }

    await targetRef.set(update, {merge: true});

    try {
      await maybeKickFollowUpSoon(db, tenantId, targetRef);
    } catch (e) {
      logger.warn("followup_kick_failed", {err: e && e.message ? e.message : e});
    }

    return res.json({
      sent: true,
      dryRun: false,
      deliveryMode: "sendgrid",
      hasSendGridKey,
      messageId: sendMessageId,
      to,
      subject: subjectForSend,
      tenantId,
      targetId: targetRef.id,
      targetCreated,
      targetUpdated,
      followupHint:
        aiOn && stages.length
          ? `Next follow-up at ${nextIso || "n/a"} UTC. If within ~2 minutes, the server may send during this request; otherwise the worker runs every minute. Use “minutes after prior email” for GMass-style quick delays.`
          : "",
    });
  });

  // -----------------------------------------------------------------
  // In-app notifications (per-user) + user prefs
  //
  // Preference path: tenants/{tenantId}/userPrefs/{uid}
  // Notification path: tenants/{tenantId}/notifications/{notifId}
  //   - uid (string)              owner of the notification
  //   - kind ("inbound_pending" | "inbound_auto_sent")
  //   - targetId (string)         lead/target this is about
  //   - pendingId (string|null)   pending review id when applicable
  //   - viewed (boolean)          seen in notifications center
  //   - read (boolean)            explicitly acknowledged / handled
  //   - createdAt (Timestamp), createdAtIso (string)
  //
  // The list endpoint always filters by user.uid AND tenantId, so a user
  // never sees notifications targeting another user.
  // -----------------------------------------------------------------

  app.get("/api/notifications", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    const tenantId = req.query.tenantId != null ? String(req.query.tenantId).trim().toLowerCase() : "";
    if (!tenantId) return res.status(400).json({error: "tenantId is required"});
    try {
      // Read pref first; if user opted out, return zeros (don't leak unread count).
      const prefSnap = await db
        .collection("tenants").doc(tenantId)
        .collection("userPrefs").doc(user.uid)
        .get();
      const prefs = prefSnap.exists ? prefSnap.data() || {} : {};
      const notifyInApp = prefs.notifyInApp === true;
      if (!notifyInApp) {
        return res.json({optedIn: false, unread: 0, items: []});
      }
      const snap = await db
        .collection("tenants").doc(tenantId)
        .collection("notifications")
        .where("uid", "==", user.uid)
        .orderBy("createdAt", "desc")
        .limit(50)
        .get();
      const items = [];
      let unread = 0;
      let unviewed = 0;
      snap.docs.forEach((d) => {
        const data = d.data() || {};
        if (data.viewed !== true) unviewed++;
        if (data.read !== true) unread++;
        items.push({
          id: d.id,
          kind: String(data.kind || ""),
          targetId: String(data.targetId || ""),
          pendingId: data.pendingId != null ? String(data.pendingId) : null,
          company: String(data.company || ""),
          subject: String(data.subject || ""),
          snippet: String(data.snippet || ""),
          campaignName: String(data.campaignName || ""),
          contactName: String(data.contactName || ""),
          sentiment: String(data.sentiment || "neutral"),
          intent: String(data.intent || "other"),
          confidence: typeof data.confidence === "number" ? data.confidence : null,
          riskFlags: Array.isArray(data.riskFlags) ? data.riskFlags : [],
          viewed: data.viewed === true,
          read: data.read === true,
          createdAtIso: extractFirstIsoDate(data.createdAtIso || data.createdAt),
        });
      });
      return res.json({optedIn: true, unread, unviewed, items});
    } catch (e) {
      logger.error("notifications_list_failed", {err: e && e.message ? e.message : e});
      return res.status(500).json({optedIn: true, unread: 0, unviewed: 0, items: []});
    }
  });

  app.post("/api/notifications/mark-viewed", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    const b = req.body || {};
    const tenantId = String(b.tenantId || "").trim().toLowerCase();
    if (!tenantId) return res.status(400).json({error: "tenantId is required"});
    try {
      const snap = await db
        .collection("tenants").doc(tenantId)
        .collection("notifications")
        .where("uid", "==", user.uid)
        .limit(200)
        .get();
      if (snap.empty) return res.json({ok: true, updated: 0});
      const batch = db.batch();
      let touched = 0;
      snap.docs.forEach((d) => {
        const data = d.data() || {};
        if (data.viewed === true) return;
        batch.update(d.ref, {viewed: true, viewedAt: FieldValue.serverTimestamp()});
        touched++;
      });
      if (!touched) return res.json({ok: true, updated: 0});
      await batch.commit();
      return res.json({ok: true, updated: touched});
    } catch (e) {
      logger.error("notifications_mark_viewed_failed", {err: e && e.message ? e.message : e});
      return res.status(500).json({error: "mark-viewed failed"});
    }
  });

  app.post("/api/notifications/mark-read", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    const b = req.body || {};
    const tenantId = String(b.tenantId || "").trim().toLowerCase();
    if (!tenantId) return res.status(400).json({error: "tenantId is required"});
    const idsRaw = Array.isArray(b.ids) ? b.ids : [];
    const all = b.all === true;
    try {
      if (all) {
        const snap = await db
          .collection("tenants").doc(tenantId)
          .collection("notifications")
          .where("uid", "==", user.uid)
          .where("read", "==", false)
          .limit(200)
          .get();
        if (snap.empty) return res.json({ok: true, updated: 0});
        const batch = db.batch();
        snap.docs.forEach((d) => batch.update(d.ref, {read: true, readAt: FieldValue.serverTimestamp(), viewed: true, viewedAt: FieldValue.serverTimestamp()}));
        await batch.commit();
        return res.json({ok: true, updated: snap.size});
      }
      const ids = idsRaw
        .map((x) => String(x || "").trim())
        .filter(Boolean)
        .slice(0, 200);
      if (!ids.length) return res.status(400).json({error: "ids[] or all=true required"});
      const batch = db.batch();
      let touched = 0;
      for (const id of ids) {
        const ref = db.collection("tenants").doc(tenantId).collection("notifications").doc(id);
        const doc = await ref.get();
        if (!doc.exists) continue;
        if (String((doc.data() || {}).uid || "") !== user.uid) continue;
        batch.update(ref, {read: true, readAt: FieldValue.serverTimestamp(), viewed: true, viewedAt: FieldValue.serverTimestamp()});
        touched++;
      }
      if (touched) await batch.commit();
      return res.json({ok: true, updated: touched});
    } catch (e) {
      logger.error("notifications_mark_read_failed", {err: e && e.message ? e.message : e});
      return res.status(500).json({error: "mark-read failed"});
    }
  });

  app.get("/api/user-prefs", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    const tenantId = req.query.tenantId != null ? String(req.query.tenantId).trim().toLowerCase() : "";
    if (!tenantId) return res.status(400).json({error: "tenantId is required"});
    try {
      const ref = db.collection("tenants").doc(tenantId).collection("userPrefs").doc(user.uid);
      const snap = await ref.get();
      const data = snap.exists ? snap.data() || {} : {};
      return res.json({
        notifyInApp: data.notifyInApp === true,
        notifyOnAutoSent: data.notifyOnAutoSent !== false,
        outreachSenderName: String(data.outreachSenderName || ""),
        outreachSenderTitle: String(data.outreachSenderTitle || ""),
        defaultOutreachVibe: String(data.defaultOutreachVibe || ""),
        defaultCalendlyLink: String(data.defaultCalendlyLink || ""),
        updatedAtIso: extractFirstIsoDate(data.updatedAtIso || data.updatedAt),
      });
    } catch (e) {
      logger.error("user_prefs_get_failed", {err: e && e.message ? e.message : e});
      return res.status(500).json({error: "user prefs read failed"});
    }
  });

  app.post("/api/user-prefs", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    const b = req.body || {};
    const tenantId = String(b.tenantId || "").trim().toLowerCase();
    if (!tenantId) return res.status(400).json({error: "tenantId is required"});
    try {
      const ref = db.collection("tenants").doc(tenantId).collection("userPrefs").doc(user.uid);
      const update = {
        uid: user.uid,
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtIso: new Date().toISOString(),
      };
      if (Object.prototype.hasOwnProperty.call(b, "notifyInApp")) {
        update.notifyInApp = b.notifyInApp === true;
      }
      if (Object.prototype.hasOwnProperty.call(b, "notifyOnAutoSent")) {
        update.notifyOnAutoSent = b.notifyOnAutoSent === true;
      }
      if (Object.prototype.hasOwnProperty.call(b, "outreachSenderName")) {
        update.outreachSenderName = String(b.outreachSenderName || "").trim().slice(0, 120);
      }
      if (Object.prototype.hasOwnProperty.call(b, "outreachSenderTitle")) {
        update.outreachSenderTitle = String(b.outreachSenderTitle || "").trim().slice(0, 120);
      }
      if (Object.prototype.hasOwnProperty.call(b, "defaultOutreachVibe")) {
        update.defaultOutreachVibe = trimOutreachVibe(b.defaultOutreachVibe);
      }
      if (Object.prototype.hasOwnProperty.call(b, "defaultCalendlyLink")) {
        update.defaultCalendlyLink = trimCalendlyLink(b.defaultCalendlyLink);
      }
      await ref.set(update, {merge: true});
      const snap = await ref.get();
      const data = snap.data() || {};
      return res.json({
        ok: true,
        notifyInApp: data.notifyInApp === true,
        notifyOnAutoSent: data.notifyOnAutoSent !== false,
        outreachSenderName: String(data.outreachSenderName || ""),
        outreachSenderTitle: String(data.outreachSenderTitle || ""),
        defaultOutreachVibe: String(data.defaultOutreachVibe || ""),
        defaultCalendlyLink: String(data.defaultCalendlyLink || ""),
      });
    } catch (e) {
      logger.error("user_prefs_set_failed", {err: e && e.message ? e.message : e});
      return res.status(500).json({error: "user prefs save failed"});
    }
  });

  /** Per-uid rate limit for coach chat (~20 req/min). */
  const coachRateLimit = new Map();
  const COACH_RATE_MAX = 20;
  const COACH_RATE_WINDOW_MS = 60 * 1000;

  /**
   * @param {string} uid
   */
  function coachRateLimitOk(uid) {
    const now = Date.now();
    const entry = coachRateLimit.get(uid);
    if (!entry || now - entry.windowStart > COACH_RATE_WINDOW_MS) {
      coachRateLimit.set(uid, {windowStart: now, count: 1});
      return true;
    }
    if (entry.count >= COACH_RATE_MAX) return false;
    entry.count += 1;
    return true;
  }

  app.post("/api/ai/suggest-outreach-setup", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) {
      return;
    }
    const b = req.body || {};
    const companyName = String(b.companyName || "").trim();
    const city = String(b.city || "").trim();
    const directorFirstName = String(b.directorFirstName || "").trim();
    const campaignName = String(b.campaignName || "").trim();
    const email = normEmail(b.email || "");
    const existingVibe = trimOutreachVibe(b.existingVibe || b.outreachVibe || "");
    const catalog = getOutreachSetupCatalog();
    const baseOpts = {companyName, city, directorFirstName, campaignName, email, existingVibe};

    const openaiKey = String(process.env.OPENAI_API_KEY || "").trim();
    if (!openaiKey) {
      return res.json(heuristicOutreachSetup(baseOpts));
    }

    try {
      const OpenAIMod = require("openai");
      const OpenAI = OpenAIMod.default || OpenAIMod;
      const client = new OpenAI({apiKey: openaiKey});
      const result = await suggestOutreachSetup(client, catalog, baseOpts);
      const merged = Object.assign({}, heuristicOutreachSetup(baseOpts), result);
      if (!merged.outreachVibe) {
        merged.outreachVibe = heuristicOutreachSetup(baseOpts).outreachVibe;
      }
      if (!merged.painPoint) {
        merged.painPoint = pickPainPoint(email || companyName || "default");
      }
      return res.json(merged);
    } catch (e) {
      logger.error("suggest_outreach_setup_failed", {err: e && e.message ? e.message : e});
      return res.json(heuristicOutreachSetup(baseOpts));
    }
  });

  app.post("/api/ai/compose-kickoff-email", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) {
      return;
    }
    const b = req.body || {};
    const companyName = String(b.companyName || "").trim();
    const directorFirstName = String(b.directorFirstName || "").trim();
    const city = String(b.city || "").trim();
    const painPoint = String(b.painPoint || b.painPointHint || "").trim();
    const userBrief = trimOutreachVibe(b.userBrief || b.outreachVibe) || DEFAULT_OUTREACH_VIBE;
    const outreachVibe = userBrief;
    const campaignName = String(b.campaignName || "").trim();
    const variant = Math.max(0, parseInt(String(b.variant || 0), 10) || 0);
    const emailLength = String(b.emailLength || "medium").trim().toLowerCase();
    const subjectTemplateRef = String(b.subjectTemplateRef || "").trim();
    const bodyTemplateRef = String(b.bodyTemplateRef || "").trim();
    const subjectTemplateSkeleton = String(b.subjectTemplateSkeleton || "").trim();
    const bodyTemplateSkeleton = String(b.bodyTemplateSkeleton || "").trim();
    const subjectTemplateId = String(b.subjectTemplateId || "").trim();
    const bodyTemplateId = String(b.bodyTemplateId || "").trim();
    const icebreakerTemplateId = String(b.icebreakerTemplateId || "").trim();
    const iceBreaker = String(b.iceBreaker || "").trim();

    const openaiKey = String(process.env.OPENAI_API_KEY || "").trim();
    if (!openaiKey) {
      return res.status(503).json({error: "OpenAI not configured", text: "", subject: ""});
    }

    try {
      const OpenAIMod = require("openai");
      const OpenAI = OpenAIMod.default || OpenAIMod;
      const client = new OpenAI({apiKey: openaiKey});
      const draft = await draftKickoffEmail(client, {
        companyName,
        directorFirstName,
        city,
        painPoint,
        outreachVibe,
        userBrief,
        emailLength,
        subjectTemplateRef,
        bodyTemplateRef,
        subjectTemplateSkeleton,
        bodyTemplateSkeleton,
        subjectTemplateId,
        bodyTemplateId,
        icebreakerTemplateId,
        iceBreaker,
        campaignName,
        variant,
      });
      if (!draft || (!draft.subject && !draft.bodyPlain)) {
        return res.status(502).json({error: "AI draft empty", text: "", subject: ""});
      }
      return res.json({
        subject: draft.subject || "",
        text: draft.bodyPlain || "",
        body: draft.bodyPlain || "",
      });
    } catch (e) {
      logger.error("compose_kickoff_email_failed", {err: e && e.message ? e.message : e});
      return res.status(502).json({error: "AI compose failed", text: "", subject: ""});
    }
  });

  app.post("/api/ai/suggest-icebreaker", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) {
      return;
    }
    const b = req.body || {};
    const companyName = String(b.companyName || "").trim();
    const city = String(b.city || "").trim();
    const directorFirstName = String(b.directorFirstName || "").trim();
    const campaignName = String(b.campaignName || "").trim();
    const painPoint = String(b.painPoint || b.painPointHint || "").trim();
    const templateId = String(b.templateId || "").trim();
    const outreachVibe = trimOutreachVibe(b.outreachVibe) || DEFAULT_OUTREACH_VIBE;
    const seed = String(b.email || companyName || directorFirstName || "default").trim();

    function templateFallback() {
      const list = icebreakerTemplates();
      const picked = templateId ? list.find((x) => x.id === templateId) : pickIcebreakerTemplate(seed);
      const tpl = picked || pickIcebreakerTemplate(seed);
      const target = {
        companyName,
        city,
        greetingNameHint: directorFirstName,
        contactEmail: String(b.email || "").trim(),
      };
      return fillOutreachTemplate(tpl.text, target, {
        email: String(b.email || "").trim(),
        companyName,
        city,
        painPointHint: painPoint || pickPainPoint(seed),
        campaignName,
      });
    }

    function fallback() {
      const fromTpl = templateFallback();
      if (fromTpl && fromTpl.trim()) {
        return fromTpl;
      }
      return defaultIceBreakerFallback(directorFirstName, companyName);
    }

    const openaiKey = String(process.env.OPENAI_API_KEY || "").trim();
    if (!openaiKey) {
      return res.json({iceBreaker: fallback(), painPoint: painPoint || pickPainPoint(seed)});
    }

    try {
      const OpenAIMod = require("openai");
      const OpenAI = OpenAIMod.default || OpenAIMod;
      const client = new OpenAI({apiKey: openaiKey});
      const prompt =
        "Write ONE believable B2B cold email icebreaker sentence (no greeting). Plain text. No em dashes. Generic enough if data is missing.\n" +
        "Company: " +
        (companyName || "unknown") +
        "\nCity: " +
        (city || "unknown") +
        "\nContact first name: " +
        (directorFirstName || "unknown") +
        "\nPain point angle: " +
        (painPoint || pickPainPoint(seed)) +
        "\nCase study reference (optional): Warner Music Group delivery partnership\n" +
        "Campaign: " +
        (campaignName || "outreach") +
        "\nOutreach vibe: " +
        outreachVibe;
      const completion = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You write short, credible B2B opener lines for Outreach Platform outreach (pipeline/outbound support). One sentence. No hype.",
          },
          {role: "user", content: prompt},
        ],
        max_tokens: 120,
        temperature: 0.7,
      });
      const text = String(
        (completion.choices &&
          completion.choices[0] &&
          completion.choices[0].message &&
          completion.choices[0].message.content) ||
          ""
      ).trim();
      if (!text) {
        return res.json({iceBreaker: fallback(), painPoint: painPoint || pickPainPoint(seed)});
      }
      return res.json({
        iceBreaker: text.replace(/[\u2013\u2014\u2212]/g, "-"),
        painPoint: painPoint || pickPainPoint(seed),
      });
    } catch (e) {
      logger.warn("suggest_icebreaker_failed", {err: e && e.message ? e.message : e});
      return res.json({iceBreaker: fallback(), painPoint: painPoint || pickPainPoint(seed)});
    }
  });

  app.post("/api/coach/chat", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;

    const openaiKey = String(process.env.OPENAI_API_KEY || "").trim();
    if (!openaiKey) {
      return res.status(503).json({
        error: "Assistant is not configured yet. Ask your admin to set OPENAI_API_KEY.",
      });
    }

    if (!coachRateLimitOk(user.uid)) {
      return res.status(429).json({error: "Too many requests. Please wait a minute and try again."});
    }

    const b = req.body || {};
    const page = String(b.page || "other").trim().toLowerCase() || "other";
    const messages = b.messages;

    try {
      const OpenAIMod = require("openai");
      const OpenAI = OpenAIMod.default || OpenAIMod;
      const client = new OpenAI({apiKey: openaiKey});
      const reply = await chatWithCoach(client, {page, messages});
      return res.json({reply});
    } catch (e) {
      const msg = e && e.message ? String(e.message) : "Coach request failed";
      if (e && e.code === "validation") {
        return res.status(400).json({error: msg});
      }
      logger.warn("coach_chat_failed", {
        uid: user.uid,
        err: msg,
      });
      return res.status(500).json({
        error: "Could not get an answer right now. Please try again in a moment.",
      });
    }
  });

  app.use((req, res) => {
    if (req.path && req.path.startsWith("/api/")) {
      return res.status(404).json({error: "Not found", path: req.path});
    }
    res.status(404).send("Not found");
  });
}

module.exports = {attachApiRoutes};

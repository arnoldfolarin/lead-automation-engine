/**
 * Stage-specific prompts for automated email touches 2+ (after human kickoff).
 * Returns plain-text subject + body for SendGrid.
 */
const {extractFirstNameFromEmail, formatProfessionalEmailBody} = require("./greetingTemplate");

function snippet(s, max) {
  const t = (s != null ? String(s) : "").trim();
  return t.length <= max ? t : t.slice(0, max) + "…";
}

function summarizeTouchHistory(history) {
  if (!Array.isArray(history) || history.length === 0) return "(no prior touch log)";
  const lines = history
    .slice(-6)
    .map((h) => {
      if (!h || typeof h !== "object") return "";
      const st = h.stage != null ? String(h.stage) : "?";
      const k = h.kind != null ? String(h.kind) : "touch";
      const sub = h.subject != null ? snippet(h.subject, 80) : "";
      const body =
        h.bodyPlain != null && String(h.bodyPlain).trim()
          ? snippet(String(h.bodyPlain), 900)
          : h.textPreview != null
            ? snippet(String(h.textPreview), 400)
            : "";
      const head = `- Stage ${st} (${k})${sub ? `: ${sub}` : ""}`;
      return body ? `${head}\n  Body: ${body}` : head;
    })
    .filter(Boolean);
  return lines.length ? lines.join("\n") : "(no prior touch log)";
}

function systemPromptForTouch(touchNumber) {
  const n = Number(touchNumber) || 2;
  if (n <= 2) {
    return (
      "You write concise B2B follow-up emails for Tech Jump. This is touch 2 — a polite bump after the initial outreach. " +
      "Reference the prior thread abstractly (do not invent specifics). Stay professional and short. " +
      "Reply with valid JSON only, no markdown fences, keys: subject (max 120 chars), body_plain (plain text, 2-4 short paragraphs, no markdown). " +
      "Do NOT include a sign-off, closing, or signature — the email system adds that automatically at send time."
    );
  }
  if (n === 3) {
    return (
      "You write concise B2B follow-up emails for Tech Jump. This is touch 3 — add light value or a fresh angle; avoid repeating touch 2 verbatim. " +
      "Reply with valid JSON only, keys: subject (max 120 chars), body_plain (plain text, 2-4 short paragraphs, no markdown). " +
      "Do NOT include a sign-off, closing, or signature — the email system adds that automatically at send time."
    );
  }
  return (
    "You write concise B2B follow-up emails for Tech Jump. This is a later touch — keep it very brief; you may use a respectful 'last note' tone without being pushy. " +
    "Reply with valid JSON only, keys: subject (max 120 chars), body_plain (plain text, 2-3 short paragraphs, no markdown). " +
    "Do NOT include a sign-off, closing, or signature — the email system adds that automatically at send time."
  );
}

function formatLastOpenedLine(d) {
  if (!d || typeof d !== "object") return "";
  const o = d.lastEmailOpenedAt;
  if (o == null) return "";
  try {
    const t =
      typeof o.toDate === "function"
        ? o.toDate()
        : new Date(typeof o === "string" || typeof o === "number" ? o : String(o));
    if (Number.isNaN(t.getTime())) return "";
    return t.toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

function buildUserPayload(targetData, touchNumber) {
  const d = targetData && typeof targetData === "object" ? targetData : {};
  const company =
    (d.companyName != null ? String(d.companyName) : "") ||
    (d.name != null ? String(d.name) : "") ||
    "";
  const contact = d.contact && typeof d.contact === "object" ? d.contact : {};
  const first =
    (contact.firstName != null ? String(contact.firstName).trim() : "") ||
    extractFirstNameFromEmail(d.contactEmail || contact.email);
  const lastSubject = (d.lastEmailSubject != null ? String(d.lastEmailSubject) : "").trim();
  const kickSub = (d.lastKickoffSubject != null ? String(d.lastKickoffSubject) : "").trim();
  const kickBody = (d.lastKickoffBodyPreview != null ? String(d.lastKickoffBodyPreview) : "").trim();
  const history = summarizeTouchHistory(d.touchHistory);
  const linkedinNotes = (d.linkedinNotes != null ? String(d.linkedinNotes).trim() : "").slice(0, 8000);
  const linkedinStub =
    linkedinNotes ||
    "(No LinkedIn thread notes on file — future sync may add linkedinNotes on the target.)";
  const openedLine = formatLastOpenedLine(d);
  const engagementHint = openedLine
    ? `Last tracked open/click activity around: ${openedLine} (from email engagement webhook when available).`
    : "No recent open/click timestamp on file.";

  return JSON.stringify({
    touchNumber,
    companyName: company || "Unknown company",
    contactFirstName: first || "(unknown)",
    lastOutgoingSubject: lastSubject || kickSub || "(unknown)",
    kickoffSubject: kickSub || lastSubject || "",
    kickoffBodyPreview: snippet(kickBody, 1200),
    outboundThreadFromApp: history,
    linkedinConversationNotesPlaceholder: linkedinStub,
    emailEngagementHint: engagementHint,
    instructions:
      "Write the next outbound email continuing Tech Jump's outreach. Use outboundThreadFromApp as the source of truth for prior emails sent through this system. Do not fabricate meetings or replies. No URLs unless essential; Calendly and signature are added in the HTML wrapper separately. Do not include sign-off or signature in body_plain.",
  });
}

/**
 * @param {import("openai").default} client
 * @param {object} targetData — Firestore target fields
 * @param {number} nextTouchNumber — 2 for first AI send after kickoff
 */
async function draftAiFollowUp(client, targetData, nextTouchNumber) {
  const touchNumber = Math.max(2, Math.min(99, parseInt(String(nextTouchNumber), 10) || 2));
  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {role: "system", content: systemPromptForTouch(touchNumber)},
      {role: "user", content: buildUserPayload(targetData, touchNumber)},
    ],
    response_format: {type: "json_object"},
    max_tokens: 900,
    temperature: 0.65,
  });
  const raw = completion.choices[0].message.content || "{}";
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }
  const subject = snippet(String(parsed.subject || parsed.subject_line || ""), 120);
  const bodyPlain = String(parsed.body_plain || parsed.body || "").trim().slice(0, 16000);
  return {subject, bodyPlain, touchNumber};
}

const SENTIMENT_VALUES = ["positive", "neutral", "negative"];
const INTENT_VALUES = [
  "interested",
  "booking",
  "ask_info",
  "out_of_office",
  "wrong_person",
  "not_interested",
  "unsubscribe",
  "negative",
  "other",
];

function normalizeSentiment(v) {
  const s = String(v || "").trim().toLowerCase();
  return SENTIMENT_VALUES.indexOf(s) >= 0 ? s : "neutral";
}

function normalizeIntent(v) {
  const s = String(v || "").trim().toLowerCase().replace(/\s+/g, "_");
  return INTENT_VALUES.indexOf(s) >= 0 ? s : "other";
}

/**
 * Draft an AI reply to an inbound message with confidence, risk flags, sentiment, intent.
 * Sentiment + intent are used by /api/inbound/email-parse to decide auto-send vs pending review.
 * @param {import("openai").default} client
 * @param {object} targetData
 * @param {{ inboundFrom?: string, inboundSubject?: string, inboundBody?: string }} inbound
 * @returns {Promise<{ subject: string, bodyPlain: string, confidence: number, riskFlags: string[], sentiment: string, intent: string }>}
 */
async function draftInboundAiReply(client, targetData, inbound) {
  const d = targetData && typeof targetData === "object" ? targetData : {};
  const inboundBody = snippet(inbound && inbound.inboundBody ? String(inbound.inboundBody) : "", 6000);
  const inboundSubject = snippet(inbound && inbound.inboundSubject ? String(inbound.inboundSubject) : "", 300);
  const inboundFrom = snippet(inbound && inbound.inboundFrom ? String(inbound.inboundFrom) : "", 200);
  const history = summarizeTouchHistory(d.touchHistory);
  const company =
    (d.companyName != null ? String(d.companyName) : "") ||
    (d.name != null ? String(d.name) : "") ||
    "Unknown company";
  const system =
    "You write short, professional B2B email replies for Tech Jump and also classify the inbound message. " +
    "Return valid JSON only with keys: subject (string, max 120 chars), body_plain (string, 2-4 short paragraphs), " +
    "confidence (number 0..1), risk_flags (array of short strings), sentiment (\"positive\" | \"neutral\" | \"negative\"), " +
    "intent (one of: interested, booking, ask_info, out_of_office, wrong_person, not_interested, unsubscribe, negative, other). " +
    "Set sentiment 'negative' for complaints, hostility, unsubscribe demands, legal threats, or clear rejection. " +
    "Set sentiment 'positive' only when the reply shows real interest, willingness to book, or a question that wants a follow-up. " +
    "Lower confidence and add risk_flags for legal/compliance, pricing commitments, contracts, security incidents, refunds, deadlines, or unclear context.";
  const user = JSON.stringify({
    companyName: company,
    contactEmail: d.contactEmail || (d.contact && d.contact.email) || "",
    inboundFrom,
    inboundSubject,
    inboundBody,
    priorOutboundThreadFromApp: history,
    instructions:
      "Reply helpfully and briefly. Do not invent product claims, discounts, or legal guarantees. " +
      "Keep body_plain to 2-4 short paragraphs. Always classify sentiment and intent honestly. " +
      "Do NOT include sign-off, closing, or signature — the email system adds that automatically at send time.",
  });

  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {role: "system", content: system},
      {role: "user", content: user},
    ],
    response_format: {type: "json_object"},
    max_tokens: 1100,
    temperature: 0.4,
  });
  const raw = completion.choices[0].message.content || "{}";
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }
  const subject = snippet(String(parsed.subject || parsed.subject_line || "Re: Quick follow-up"), 120);
  const bodyPlain = String(parsed.body_plain || parsed.body || "").trim().slice(0, 16000);
  const confNum = Number(parsed.confidence);
  const confidence = Number.isFinite(confNum) ? Math.max(0, Math.min(1, confNum)) : 0.6;
  const riskFlags = Array.isArray(parsed.risk_flags)
    ? parsed.risk_flags.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 8)
    : [];
  const sentiment = normalizeSentiment(parsed.sentiment);
  const intent = normalizeIntent(parsed.intent);
  return {subject, bodyPlain, confidence, riskFlags, sentiment, intent};
}

/**
 * @param {import("openai").default} client
 * @param {{
 *   companyName?: string,
 *   directorFirstName?: string,
 *   city?: string,
 *   painPoint?: string,
 *   outreachVibe?: string,
 *   campaignName?: string,
 *   variant?: number,
 * }} opts
 * @returns {Promise<{subject: string, bodyPlain: string}|null>}
 */
function lengthInstruction(emailLength) {
  const len = String(emailLength || "medium").trim().toLowerCase();
  if (len === "short") {
    return "Length: short — about 2-3 sentences total, one clear hook, minimal filler.";
  }
  if (len === "long") {
    return "Length: long — 4-5 short paragraphs with more context or story, still concise.";
  }
  return "Length: medium — 2-4 short paragraphs.";
}

async function draftKickoffEmail(client, opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const companyName = String(o.companyName || "").trim();
  const directorFirstName = String(o.directorFirstName || "").trim();
  const city = String(o.city || "").trim();
  const painPoint = String(o.painPoint || "").trim();
  const userBrief = String(o.userBrief || o.outreachVibe || "").trim();
  const outreachVibe = userBrief;
  const campaignName = String(o.campaignName || "").trim();
  const variant = Math.max(0, parseInt(String(o.variant || 0), 10) || 0);
  const emailLength = String(o.emailLength || "medium").trim().toLowerCase();
  const subjectTemplateRef = String(o.subjectTemplateRef || "").trim();
  const bodyTemplateRef = String(o.bodyTemplateRef || "").trim();
  const subjectTemplateSkeleton = String(o.subjectTemplateSkeleton || "").trim();
  const bodyTemplateSkeleton = String(o.bodyTemplateSkeleton || "").trim();
  const subjectTemplateId = String(o.subjectTemplateId || "").trim();
  const bodyTemplateId = String(o.bodyTemplateId || "").trim();
  const icebreakerTemplateId = String(o.icebreakerTemplateId || "").trim();
  const iceBreaker = String(o.iceBreaker || "").trim();

  const userPayload = JSON.stringify({
    companyName: companyName || "Unknown company",
    contactFirstName: directorFirstName || "(unknown)",
    city: city || "(unknown)",
    painPoint: painPoint || "(none specified)",
    userBrief: userBrief || "(use default SaaS personalized outreach tone)",
    outreachVibe: outreachVibe || "(use default SaaS personalized outreach tone)",
    subjectTemplateId: subjectTemplateId || "(none)",
    bodyTemplateId: bodyTemplateId || "(none)",
    icebreakerTemplateId: icebreakerTemplateId || "(none)",
    subjectTemplateSkeleton: subjectTemplateSkeleton || "(none)",
    bodyTemplateSkeleton: bodyTemplateSkeleton || "(none)",
    subjectTemplateRef: subjectTemplateRef || "(none)",
    bodyTemplateRef: bodyTemplateRef || "(none)",
    iceBreaker: iceBreaker || "(none)",
    emailLength,
    campaignName: campaignName || "outreach",
    variant,
    instructions:
      "Write a kickoff cold email for Tech Jump using proven B2B template structure plus userBrief for angle. " +
      "Mirror paragraph flow from bodyTemplateSkeleton/bodyTemplateRef: opener, value or pain, proof or ask, CTA — rewrite in natural language per userBrief. " +
      "userBrief overrides generic tone; templates are structure only. Weave iceBreaker when it fits. " +
      lengthInstruction(emailLength) +
      " body_plain formatting: line 1 must be {Greeting} alone (do not substitute a real name); blank line between paragraphs; bullet lines use two spaces then - ; plain text only; no em dashes; no sign-off or signature.",
  });

  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "You write credible B2B kickoff outreach emails for Tech Jump. Sound human, specific, and low-noise — never generic AI filler. " +
          "Follow userBrief for tone, angle, personalization hooks, and length. Use template skeletons and filled refs as scaffolding only. " +
          "Format body_plain professionally: {Greeting} on its own first line, blank lines between paragraphs, indented bullets when used. " +
          "Reply with valid JSON only, keys: subject (max 120 chars), body_plain (plain text). " +
          "Do NOT include sign-off, closing, or signature.",
      },
      {role: "user", content: userPayload},
    ],
    response_format: {type: "json_object"},
    max_tokens: 900,
    temperature: 0.65,
  });
  const raw = completion.choices[0].message.content || "{}";
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }
  const subject = snippet(String(parsed.subject || parsed.subject_line || ""), 120);
  let bodyPlain = String(parsed.body_plain || parsed.body || parsed.text || "").trim().slice(0, 16000);
  bodyPlain = formatProfessionalEmailBody(bodyPlain);
  if (!subject && !bodyPlain) {
    return null;
  }
  return {subject, bodyPlain};
}

const VALID_SUBJECT_IDS = new Set([
  "sub_question",
  "sub_outcome",
  "sub_hoping",
  "sub_thoughts",
  "sub_pain",
  "sub_company",
  "sub_team",
]);
const VALID_BODY_IDS = new Set([
  "kick_value_case",
  "kick_case_compare",
  "kick_pain",
  "kick_ultra_short",
  "kick_subject_body",
  "kick_team_safe",
]);
const VALID_IB_IDS = new Set([
  "ib_research",
  "ib_niche",
  "ib_enterprise",
  "ib_city",
  "ib_bottleneck",
  "ib_case",
  "ib_role",
  "ib_short",
]);

/**
 * @param {import("openai").default} client
 * @param {object} catalog from getOutreachSetupCatalog()
 * @param {{companyName?: string, city?: string, directorFirstName?: string, campaignName?: string, email?: string, existingVibe?: string}} opts
 */
async function suggestOutreachSetup(client, catalog, opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const existingVibeHint = String(o.existingVibe || "").trim() || "";
  const hasUserBrief = existingVibeHint.length > 40;
  const userPayload = JSON.stringify({
    companyName: String(o.companyName || "").trim() || "Unknown",
    city: String(o.city || "").trim() || "(unknown)",
    contactFirstName: String(o.directorFirstName || "").trim() || "(unknown)",
    campaignName: String(o.campaignName || "").trim() || "outreach",
    existingVibeHint,
    availableTemplates: catalog,
    instructions:
      "Pick the best kickoff setup for this recipient. Return JSON keys: outreachVibe (2-4 sentences, specific angle/tone for writers — NOT the email body), subjectTemplateId, bodyTemplateId, icebreakerTemplateId (must be from availableTemplates ids), painPoint (short phrase), iceBreaker (one opener sentence, plain text). " +
      (hasUserBrief
        ? "The existingVibeHint is the user's freeform email brief — pick templates that best scaffold that angle (product gap, personal hook, length, tone). Distill outreachVibe from the brief, not generic defaults. "
        : "Vibe should be concrete when company is known (product gap, outcome, tone). ") +
      "No em dashes.",
  });

  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "You configure B2B cold email outreach for Tech Jump. Pick template ids from the catalog only. When existingVibeHint is a detailed user brief, templates must support that angle. Reply with valid JSON only.",
      },
      {role: "user", content: userPayload},
    ],
    response_format: {type: "json_object"},
    max_tokens: 700,
    temperature: 0.55,
  });
  const raw = completion.choices[0].message.content || "{}";
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }
  const subjectTemplateId = VALID_SUBJECT_IDS.has(String(parsed.subjectTemplateId || ""))
    ? String(parsed.subjectTemplateId)
    : "sub_question";
  const bodyTemplateId = VALID_BODY_IDS.has(String(parsed.bodyTemplateId || ""))
    ? String(parsed.bodyTemplateId)
    : "kick_value_case";
  const icebreakerTemplateId = VALID_IB_IDS.has(String(parsed.icebreakerTemplateId || ""))
    ? String(parsed.icebreakerTemplateId)
    : "ib_city";
  return {
    outreachVibe: String(parsed.outreachVibe || parsed.vibe || "").trim().slice(0, 500),
    subjectTemplateId,
    bodyTemplateId,
    icebreakerTemplateId,
    painPoint: String(parsed.painPoint || "").trim().slice(0, 200),
    iceBreaker: String(parsed.iceBreaker || parsed.icebreaker || "").trim().slice(0, 500),
  };
}

module.exports = {
  draftInboundAiReply,
  draftAiFollowUp,
  draftKickoffEmail,
  suggestOutreachSetup,
  snippet,
  summarizeTouchHistory,
  systemPromptForTouch,
};

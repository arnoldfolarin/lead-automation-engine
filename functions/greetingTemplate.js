/**
 * Shared greeting + outreach merge tokens for kickoff sends and follow-up sequences.
 */

const NEUTRAL_GREETINGS = ["Hey there,", "Hello,", "Hi,", "Good day,"];

const GENERIC_OPENER_LINE =
  /^(?:Hi there|Hey there|Good day|Hello|Hi)(?:,|\s)?(?:\s+I hope (?:you are well|this note finds you well)\.?)?\.?\s*$/i;

const {extendedOutreachTokens, pickIcebreakerTemplate} = require("./outreachCopy");

const TOKEN_KEYS = [
  "Greeting",
  "FirstName",
  "CompanyName",
  "City",
  "CampaignName",
  "SenderName",
  "SenderTitle",
  "IceBreaker",
  "PainPoint",
  "Offer",
  "Service",
  "Outcome",
  "Niche",
  "CaseStudy",
  "CaseStudyResult",
  "CaseStudyLocation",
];

const GENERIC_EMAIL_DOMAINS = new Set([
  "gmail",
  "googlemail",
  "yahoo",
  "hotmail",
  "outlook",
  "live",
  "icloud",
  "aol",
  "protonmail",
  "proton",
  "me",
  "msn",
  "comcast",
  "att",
  "verizon",
]);

/**
 * @param {unknown} emailRaw
 * @returns {string}
 */
function extractFirstNameFromEmail(emailRaw) {
  const email = (emailRaw != null ? String(emailRaw) : "").trim().toLowerCase();
  const at = email.indexOf("@");
  const local = at > 0 ? email.slice(0, at) : email;
  const parts = local.split(/[._-]+/).filter(Boolean);
  const first = parts[0] || "";
  if (!first || !isPlausibleFirstName(first)) {
    return "";
  }
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

/**
 * @param {unknown} name
 * @returns {boolean}
 */
function isPlausibleFirstName(name) {
  const n = String(name || "").trim();
  if (n.length < 2 || n.length > 24) {
    return false;
  }
  if (/\d/.test(n)) {
    return false;
  }
  return /^[A-Za-z][A-Za-z'-]*$/.test(n);
}

/**
 * @param {unknown} email
 * @returns {number}
 */
function simpleEmailHash(email) {
  let h = 0;
  const s = String(email || "").toLowerCase();
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * @param {unknown} email
 * @returns {string}
 */
function neutralGreetingForEmail(email) {
  const h = simpleEmailHash(email);
  return NEUTRAL_GREETINGS[h % NEUTRAL_GREETINGS.length];
}

/**
 * @param {object} target
 * @param {{ email?: string } | null | undefined} opts
 * @returns {string}
 */
function resolveFirstNameForTarget(target, opts) {
  const t = target && typeof target === "object" ? target : {};
  const h = String(t.greetingNameHint || t.greetingNameHintLast || "").trim();
  if (h) {
    const first = h.split(/\s+/)[0] || "";
    if (isPlausibleFirstName(first)) {
      return first;
    }
  }
  const fn =
    (t.contact && t.contact.firstName && String(t.contact.firstName).trim()) ||
    (t.firstName && String(t.firstName).trim()) ||
    "";
  if (fn && isPlausibleFirstName(fn)) {
    return fn;
  }
  const email =
    (opts && opts.email ? String(opts.email) : "") ||
    String(t.contactEmail || (t.contact && t.contact.email) || "").trim();
  return extractFirstNameFromEmail(email);
}

/**
 * @param {object} target
 * @param {{ email?: string } | null | undefined} opts
 * @returns {string}
 */
function greetingForTarget(target, opts) {
  const t = target && typeof target === "object" ? target : {};
  const h = String(t.greetingNameHint || t.greetingNameHintLast || "").trim();
  if (h) {
    return h.match(/^(?:hi|hello|hey|good day)\b/i) ? String(h).trim() : "Hi " + String(h).trim() + ",";
  }
  const first = resolveFirstNameForTarget(t, opts);
  if (first) {
    return "Hey " + first + ",";
  }
  const email =
    (opts && opts.email ? String(opts.email) : "") ||
    String(t.contactEmail || (t.contact && t.contact.email) || "").trim();
  if (email) {
    return neutralGreetingForEmail(email);
  }
  return NEUTRAL_GREETINGS[0];
}

/**
 * @param {string} firstName
 * @param {string} companyName
 * @returns {string}
 */
function defaultIceBreakerFallback(firstName, companyName) {
  if (firstName && companyName) {
    return "I wanted to reach out to " + firstName + " at " + companyName + ".";
  }
  if (companyName) {
    return "I came across " + companyName + " and wanted to connect.";
  }
  return "I wanted to reach out and introduce the Tech Jump team.";
}

/**
 * Guess a company label from a work email domain (e.g. pat@acme.com → Acme).
 * @param {unknown} emailRaw
 * @returns {string}
 */
function deriveCompanyLabelFromEmail(emailRaw) {
  const email = String(emailRaw || "").trim().toLowerCase();
  const at = email.indexOf("@");
  if (at < 1) {
    return "";
  }
  const host = email.slice(at + 1);
  const parts = host.split(".").filter(Boolean);
  if (!parts.length) {
    return "";
  }
  let base = parts[0];
  if (parts.length >= 3 && parts[parts.length - 1].length <= 3 && parts[parts.length - 2].length <= 3) {
    base = parts[parts.length - 3] || parts[0];
  }
  if (!base || GENERIC_EMAIL_DOMAINS.has(base) || base.length < 2) {
    return "";
  }
  return base
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Smooth awkward gaps when optional tokens (company, city, first name) are empty.
 * @param {string} text
 * @returns {string}
 */
/**
 * Professional plain-text email body: paragraph breaks, greeting line, list indents.
 * Keep in sync with Deliverables/public/js/email-templates.js formatProfessionalEmailBody.
 * @param {string} text
 * @returns {string}
 */
function indentProfessionalListLines(text) {
  return String(text || "")
    .split("\n")
    .map((line) => {
      const trimmed = line.trimEnd();
      if (!trimmed) return "";
      const content = trimmed.trimStart();
      if (/^(\u2022|-|\d+\.)\s/.test(content) && !/^\s{2,}/.test(line)) {
        return "  " + content;
      }
      return trimmed;
    })
    .join("\n");
}

function normalizeProseDashes(text) {
  return String(text || "")
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .split("\n")
    .map((line) => {
      const trimmed = line.trimStart();
      if (/^(-|\u2022|\d+\.)\s/.test(trimmed)) return line;
      return line.replace(/\s+-\s+/g, " ");
    })
    .join("\n");
}

function formatProfessionalEmailBody(text) {
  let s = normalizeProseDashes(String(text || "").trim());
  if (!s) return "";

  if (/\{Greeting\}/i.test(s)) {
    s = s.replace(/^\s*\{Greeting\}\s*,?\s*/i, "{Greeting}\n\n");
    s = s.replace(/\n{3,}/g, "\n\n");
  }

  if (s.indexOf("\n\n") === -1 && s.length > 80) {
    s = s.replace(
      /([.!?])\s+(?=(?:I |We |If |Our |Thank |Hoping|Please|This |At |You |A ))/g,
      "$1\n\n"
    );
    if (s.indexOf("\n\n") === -1) {
      s = s.replace(/([.!?])\s+([A-Za-z(])/g, "$1\n\n$2");
    }
  }

  s = indentProfessionalListLines(s);
  s = s.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n").trim();
  s = polishFilledOutreachText(s);
  return indentProfessionalListLines(s);
}

function polishFilledOutreachText(text) {
  let s = String(text || "");
  s = s.replace(/[ \t]{2,}/g, " ");
  s = s.replace(/\s+in\s+with\b/gi, " with");
  s = s.replace(/\borgs like\s+with\b/gi, "organizations with");
  s = s.replace(/\borgs like\s+in\b/gi, "organizations in");
  s = s.replace(/companies in\s+on\b/gi, "companies on");
  s = s.replace(/companies in\s+with\b/gi, "companies with");
  s = s.replace(/partners with companies in\s+on\b/gi, "partners with companies on");
  s = s.replace(/partners with companies in\s+/gi, "partners with companies ");
  s = s.replace(/^A question for\s*$/gm, "A quick question");
  s = s.replace(/^Hoping to connect with\s*$/gm, "Hoping to connect");
  s = s.replace(/^What are your thoughts,\s*$/gm, "What are your thoughts?");
  s = s.replace(/^A question regarding\s*$/gm, "A quick question");
  s = s.replace(/^Quick intro —\s*$/gm, "Quick intro from Tech Jump");
  s = s.replace(/If we could help\s+with\b/gi, "If we could help your team with");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

/**
 * @param {object} target
 * @param {object | null | undefined} opts
 * @returns {Record<string, string>}
 */
function buildOutreachContext(target, opts) {
  const t = target && typeof target === "object" ? target : {};
  const o = opts && typeof opts === "object" ? opts : {};
  const email =
    (o.email ? String(o.email) : "") ||
    String(t.contactEmail || (t.contact && t.contact.email) || "").trim();
  const firstName = resolveFirstNameForTarget(t, {email});
  let companyName = String(o.companyName || t.companyName || t.name || "").trim();
  if (!companyName) {
    companyName = deriveCompanyLabelFromEmail(email) || "";
  }
  const city = String(o.city || t.city || "").trim();
  const campaignName = String(
    o.campaignName || t.lastCampaignName || t.campaignName || ""
  ).trim();
  const senderName = String(
    o.outreachSenderName || o.senderName || t.outreachSenderName || t.senderName || ""
  ).trim();
  const senderTitle = String(
    o.outreachSenderTitle || o.senderTitle || t.outreachSenderTitle || t.senderTitle || "Account Lead"
  ).trim();
  let iceBreaker = String(o.iceBreakerHint || t.iceBreakerHint || "").trim();
  if (!iceBreaker) {
    const ibTpl = pickIcebreakerTemplate(email || companyName);
    const ibCtx = {
      email,
      companyName,
      city,
      painPointHint: String(o.painPointHint || "").trim(),
    };
    const partial = Object.assign(
      {
        Greeting: greetingForTarget(t, {email}),
        FirstName: firstName,
        CompanyName: companyName || "your organization",
        City: city,
      },
      extendedOutreachTokens(ibCtx)
    );
    iceBreaker = String(ibTpl.text || "").replace(/\{([A-Za-z]+)\}/g, (match, key) => {
      if (Object.prototype.hasOwnProperty.call(partial, key)) {
        const val = partial[key];
        return val != null ? String(val) : "";
      }
      const lower = key.toLowerCase();
      for (let i = 0; i < TOKEN_KEYS.length; i++) {
        const tk = TOKEN_KEYS[i];
        if (tk.toLowerCase() === lower) {
          const val = partial[tk];
          return val != null ? String(val) : "";
        }
      }
      return match;
    });
    iceBreaker = polishFilledOutreachText(iceBreaker);
    if (!iceBreaker.trim()) {
      iceBreaker = defaultIceBreakerFallback(firstName, companyName);
    }
  }
  const base = {
    Greeting: greetingForTarget(t, {email}),
    FirstName: firstName,
    CompanyName: companyName,
    City: city,
    CampaignName: campaignName,
    SenderName: senderName || "Tech Jump team",
    SenderTitle: senderTitle,
    IceBreaker: iceBreaker,
    email,
    painPointHint: String(o.painPointHint || "").trim(),
    niche: String(o.niche || "").trim(),
  };
  return Object.assign(base, extendedOutreachTokens(base));
}

/**
 * @param {string} tpl
 * @param {object} target
 * @param {object | null | undefined} opts
 * @returns {string}
 */
function fillOutreachTemplate(tpl, target, opts) {
  const ctx = buildOutreachContext(target, opts);
  const filled = String(tpl || "").replace(/\{([A-Za-z]+)\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(ctx, key)) {
      const val = ctx[key];
      return val != null ? String(val) : "";
    }
    const lower = key.toLowerCase();
    for (let i = 0; i < TOKEN_KEYS.length; i++) {
      const tk = TOKEN_KEYS[i];
      if (tk.toLowerCase() === lower) {
        const val = ctx[tk];
        return val != null ? String(val) : "";
      }
    }
    return match;
  });
  return polishFilledOutreachText(filled);
}

/**
 * @param {string} tpl
 * @param {object} target
 * @param {{ email?: string } | null | undefined} opts
 * @returns {string}
 */
function fillTemplate(tpl, target, opts) {
  return fillOutreachTemplate(tpl, target, opts);
}

/**
 * @param {string} body
 * @param {object} target
 * @param {{ email?: string } | null | undefined} opts
 * @returns {string}
 */
function normalizeKickoffBody(body, target, opts) {
  const raw = String(body || "");
  if (/\{[A-Za-z]+\}/.test(raw)) {
    return fillOutreachTemplate(raw, target, opts);
  }
  const normalized = raw.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length && GENERIC_OPENER_LINE.test(lines[0].trim())) {
    lines[0] = greetingForTarget(target, opts);
    return lines.join("\n");
  }
  return raw;
}

module.exports = {
  extractFirstNameFromEmail,
  isPlausibleFirstName,
  neutralGreetingForEmail,
  resolveFirstNameForTarget,
  greetingForTarget,
  buildOutreachContext,
  fillOutreachTemplate,
  fillTemplate,
  normalizeKickoffBody,
  defaultIceBreakerFallback,
  deriveCompanyLabelFromEmail,
  polishFilledOutreachText,
  formatProfessionalEmailBody,
  TOKEN_KEYS,
};

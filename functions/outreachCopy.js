/**
 * Tech Jump outreach copy: case studies (from tech-jump.com), pain points, icebreakers.
 * Keep in sync with Deliverables/public/js/email-templates.js
 */

/** Default tone/structure guidance for kickoff AI (not shown to recipients). */
const DEFAULT_OUTREACH_VIBE =
  "We're a SaaS company offering personalized outreach. Sound human and specific — short paragraphs, one clear angle, no hype or obvious AI phrasing.";

const DEFAULT_CALENDLY_LINK = "https://calendly.com/tech-jump/30min";

const KICKOFF_SUBJECT_TEMPLATES = [
  {id: "sub_question", label: "A question for {FirstName}"},
  {id: "sub_outcome", label: "Fancy a chat (pattern interrupt)"},
  {id: "sub_hoping", label: "Hoping to connect"},
  {id: "sub_thoughts", label: "What are your thoughts"},
  {id: "sub_pain", label: "Quick question re: pain"},
  {id: "sub_company", label: "Question re: company"},
  {id: "sub_team", label: "Tech Jump intro"},
];

const KICKOFF_BODY_TEMPLATES = [
  {id: "kick_value_case", label: "Value prop + case study"},
  {id: "kick_case_compare", label: "Case study + comparable ask"},
  {id: "kick_pain", label: "Quick outcome / pain point"},
  {id: "kick_ultra_short", label: "Extremely short"},
  {id: "kick_subject_body", label: "Subject-line question in body"},
  {id: "kick_team_safe", label: "Safe generic (no city required)"},
];

const CASE_STUDIES = [
  {
    id: "wmg",
    name: "Warner Music Group",
    result: "hit sprint commitments on time with a dedicated delivery team",
    niche: "enterprise media",
    location: "New York",
  },
  {
    id: "enterprise",
    name: "a Fortune 500 technology team",
    result: "shipped a production platform without pulling internal engineers off roadmap work",
    niche: "enterprise software",
    location: "the US",
  },
  {
    id: "healthcare",
    name: "a healthcare software team",
    result: "moved from prototype to HIPAA-aware production on a predictable timeline",
    niche: "healthcare",
    location: "Orlando",
  },
  {
    id: "growth",
    name: "a growth-stage B2B company",
    result: "filled the top of funnel with a steadier outbound rhythm",
    niche: "B2B services",
    location: "Florida",
  },
];

const PAIN_POINTS = [
  "inconsistent outbound and follow-up",
  "pipeline drying up between campaigns",
  "reps spending too much time on manual email instead of closing",
  "no clear system for who to contact next",
  "follow-ups slipping through the cracks",
  "needing meetings without hiring another SDR",
  "outreach that does not match your brand voice",
  "scaling top-of-funnel without adding headcount overnight",
];

const OFFERS = [
  "steady qualified conversations",
  "a fuller pipeline without another hire",
  "structured outbound and follow-through",
  "predictable top-of-funnel motion",
];

const SERVICES = [
  "outreach support",
  "outbound and follow-up",
  "pipeline generation",
];

const OUTCOMES = [
  "a fuller pipeline",
  "more predictable outreach",
  "outbound that runs without you babysitting it",
];

const NICHE_DEFAULT = "growth-stage and enterprise teams";

/**
 * @param {unknown} seed
 * @returns {number}
 */
function hashSeed(seed) {
  let h = 0;
  const s = String(seed || "").toLowerCase();
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * @param {unknown} seed
 * @returns {(typeof CASE_STUDIES)[number]}
 */
function pickCaseStudy(seed) {
  const h = hashSeed(seed);
  return CASE_STUDIES[h % CASE_STUDIES.length];
}

/**
 * @param {unknown} seed
 * @returns {string}
 */
function pickPainPoint(seed) {
  const h = hashSeed(seed + ":pain");
  return PAIN_POINTS[h % PAIN_POINTS.length];
}

/**
 * @param {unknown} seed
 * @returns {string}
 */
function pickOffer(seed) {
  const h = hashSeed(seed + ":offer");
  return OFFERS[h % OFFERS.length];
}

/**
 * @param {unknown} seed
 * @returns {string}
 */
function pickService(seed) {
  const h = hashSeed(seed + ":svc");
  return SERVICES[h % SERVICES.length];
}

/**
 * @param {unknown} seed
 * @returns {string}
 */
function pickOutcome(seed) {
  const h = hashSeed(seed + ":out");
  return OUTCOMES[h % OUTCOMES.length];
}

/**
 * Generic icebreaker lines (no scraping). Tokens filled by caller.
 * @returns {Array<{id: string, label: string, text: string}>}
 */
function icebreakerTemplates() {
  return [
    {
      id: "ib_research",
      label: "Research / company mention",
      text: "I came across {CompanyName} while looking at teams in {City}.",
    },
    {
      id: "ib_niche",
      label: "Niche / space mention",
      text: "Saw you are building in the {Niche} space and wanted to reach out.",
    },
    {
      id: "ib_enterprise",
      label: "Enterprise clients angle",
      text: "I noticed {CompanyName} works with larger clients, similar to teams we have supported.",
    },
    {
      id: "ib_city",
      label: "Local / city mention",
      text: "I was looking at companies in {City} and {CompanyName} stood out.",
    },
    {
      id: "ib_bottleneck",
      label: "Outreach bottleneck (generic)",
      text: "Teams like {CompanyName} often hit the same outreach bottlenecks we help fix.",
    },
    {
      id: "ib_case",
      label: "Case study mention",
      text: "We recently supported {CaseStudy}; your space reminded me of that work.",
    },
    {
      id: "ib_role",
      label: "New role / title",
      text: "Saw you may be leading growth or revenue motion at {CompanyName} and wanted to connect.",
    },
    {
      id: "ib_short",
      label: "Short direct",
      text: "Quick note from the Tech Jump team after coming across {CompanyName}.",
    },
  ];
}

/**
 * @param {unknown} seed
 * @returns {{id: string, label: string, text: string}}
 */
function pickIcebreakerTemplate(seed) {
  const list = icebreakerTemplates();
  const h = hashSeed(seed + ":ib");
  return list[h % list.length];
}

/**
 * Template ids for AI outreach setup picker.
 * @returns {{subjects: Array<{id: string, label: string}>, bodies: Array<{id: string, label: string}>, icebreakers: Array<{id: string, label: string}>}}
 */
function getOutreachSetupCatalog() {
  return {
    subjects: KICKOFF_SUBJECT_TEMPLATES.slice(),
    bodies: KICKOFF_BODY_TEMPLATES.slice(),
    icebreakers: icebreakerTemplates().map((t) => ({id: t.id, label: t.label})),
  };
}

/**
 * Heuristic outreach setup when OpenAI is unavailable.
 * @param {{companyName?: string, city?: string, directorFirstName?: string, email?: string, existingVibe?: string}} opts
 */
function heuristicOutreachSetup(opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const companyName = String(o.companyName || "").trim();
  const city = String(o.city || "").trim();
  const existingVibe = String(o.existingVibe || "").trim();
  const seed = String(o.email || companyName || "default").trim();
  const painPoint = pickPainPoint(seed);
  let outreachVibe = existingVibe;
  if (!outreachVibe) {
    if (companyName) {
      outreachVibe =
        "Personalized SaaS outreach to " +
        companyName +
        ". Sound human and specific — one clear product or outcome angle, short paragraphs, no hype or obvious AI phrasing.";
    } else {
      outreachVibe = DEFAULT_OUTREACH_VIBE;
    }
  }
  const subjectTemplateId = companyName ? "sub_company" : "sub_question";
  const bodyTemplateId = city ? "kick_value_case" : "kick_pain";
  const icebreakerTemplateId = city ? "ib_city" : companyName ? "ib_research" : "ib_short";
  const ibTpl = icebreakerTemplates().find((t) => t.id === icebreakerTemplateId) || pickIcebreakerTemplate(seed);
  const target = {
    companyName,
    city,
    greetingNameHint: String(o.directorFirstName || "").trim(),
    contactEmail: seed.includes("@") ? seed : "",
  };
  const {fillOutreachTemplate} = require("./greetingTemplate");
  const iceBreaker = fillOutreachTemplate(ibTpl.text, target, {
    email: seed.includes("@") ? seed : "",
    companyName,
    city,
    painPointHint: painPoint,
  });
  return {
    outreachVibe: outreachVibe.slice(0, 500),
    subjectTemplateId,
    bodyTemplateId,
    icebreakerTemplateId: ibTpl.id,
    painPoint,
    iceBreaker: iceBreaker.slice(0, 500),
  };
}

/**
 * @param {object} ctx
 * @returns {Record<string, string>}
 */
function extendedOutreachTokens(ctx) {
  const email = String(ctx.email || "").trim();
  const seed = email || String(ctx.companyName || "").trim() || "default";
  const cs = pickCaseStudy(seed);
  const pain = String(ctx.painPointHint || "").trim() || pickPainPoint(seed);
  const city = String(ctx.city || "").trim();
  const niche = String(ctx.niche || "").trim() || NICHE_DEFAULT;
  return {
    PainPoint: pain,
    Offer: pickOffer(seed),
    Service: pickService(seed),
    Outcome: pickOutcome(seed),
    Niche: niche,
    CaseStudy: cs.name,
    CaseStudyResult: cs.result,
    CaseStudyLocation: cs.location,
  };
}

module.exports = {
  CASE_STUDIES,
  PAIN_POINTS,
  DEFAULT_OUTREACH_VIBE,
  DEFAULT_CALENDLY_LINK,
  KICKOFF_SUBJECT_TEMPLATES,
  KICKOFF_BODY_TEMPLATES,
  getOutreachSetupCatalog,
  heuristicOutreachSetup,
  icebreakerTemplates,
  pickCaseStudy,
  pickPainPoint,
  pickIcebreakerTemplate,
  extendedOutreachTokens,
  NICHE_DEFAULT,
};

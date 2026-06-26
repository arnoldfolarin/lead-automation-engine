/**
 * Proven B2B outreach templates + merge tokens (mirrors greetingTemplate.js + outreachCopy.js).
 */
(function () {
  var NEUTRAL_GREETINGS = ["Hey there,", "Hello,", "Hi,", "Good day,"];
  var DEFAULT_OUTREACH_VIBE =
    "We're a SaaS company offering personalized outreach. Sound human and specific — short paragraphs, one clear angle, no hype or obvious AI phrasing.";
  var DEFAULT_CALENDLY_LINK = "https://calendly.com/example/30min";
  var GENERIC_EMAIL_DOMAINS = {
    gmail: 1,
    googlemail: 1,
    yahoo: 1,
    hotmail: 1,
    outlook: 1,
    live: 1,
    icloud: 1,
    aol: 1,
    protonmail: 1,
    proton: 1,
    me: 1,
    msn: 1,
  };

  var CASE_STUDIES = [
    {
      name: "Warner Music Group",
      result: "hit sprint commitments on time with a dedicated delivery team",
      niche: "enterprise media",
      location: "New York",
    },
    {
      name: "a Fortune 500 technology team",
      result: "shipped a production platform without pulling internal engineers off roadmap work",
      niche: "enterprise software",
      location: "the US",
    },
    {
      name: "a healthcare software team",
      result: "moved from prototype to HIPAA-aware production on a predictable timeline",
      niche: "healthcare",
      location: "Orlando",
    },
    {
      name: "a growth-stage B2B company",
      result: "filled the top of funnel with a steadier outbound rhythm",
      niche: "B2B services",
      location: "Florida",
    },
  ];

  var PAIN_POINTS = [
    "inconsistent outbound and follow-up",
    "pipeline drying up between campaigns",
    "reps spending too much time on manual email instead of closing",
    "no clear system for who to contact next",
    "follow-ups slipping through the cracks",
    "needing meetings without hiring another SDR",
    "outreach that does not match your brand voice",
    "scaling top-of-funnel without adding headcount overnight",
  ];

  var OFFERS = [
    "steady qualified conversations",
    "a fuller pipeline without another hire",
    "structured outbound and follow-through",
    "predictable top-of-funnel motion",
  ];

  var SERVICES = ["outreach support", "outbound and follow-up", "pipeline generation"];
  var OUTCOMES = ["a fuller pipeline", "more predictable outreach", "outbound that runs without you babysitting it"];
  var NICHE_DEFAULT = "growth-stage and enterprise teams";

  function hashSeed(seed) {
    var h = 0;
    var s = String(seed || "").toLowerCase();
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }

  function pickCaseStudy(seed) {
    return CASE_STUDIES[hashSeed(seed) % CASE_STUDIES.length];
  }
  function pickPainPoint(seed) {
    return PAIN_POINTS[hashSeed(seed + ":pain") % PAIN_POINTS.length];
  }
  function pickOffer(seed) {
    return OFFERS[hashSeed(seed + ":offer") % OFFERS.length];
  }
  function pickService(seed) {
    return SERVICES[hashSeed(seed + ":svc") % SERVICES.length];
  }
  function pickOutcome(seed) {
    return OUTCOMES[hashSeed(seed + ":out") % OUTCOMES.length];
  }

  var ICEBREAKER_TEMPLATES = [
    {id: "ib_research", label: "Research / company mention", text: "I came across {CompanyName} while looking at teams in {City}."},
    {id: "ib_niche", label: "Niche / space mention", text: "Saw you are building in the {Niche} space and wanted to reach out."},
    {id: "ib_enterprise", label: "Enterprise clients angle", text: "I noticed {CompanyName} works with larger clients, similar to teams we have supported."},
    {id: "ib_city", label: "Local / city mention", text: "I was looking at companies in {City} and {CompanyName} stood out."},
    {id: "ib_bottleneck", label: "Outreach bottleneck (generic)", text: "Teams like {CompanyName} often hit the same outreach bottlenecks we help fix."},
    {id: "ib_case", label: "Case study mention", text: "We recently supported {CaseStudy}; your space reminded me of that work."},
    {id: "ib_role", label: "Growth / revenue angle", text: "Saw you may be leading growth or revenue motion at {CompanyName} and wanted to connect."},
    {id: "ib_short", label: "Short direct", text: "Quick note from the outreach team after coming across {CompanyName}."},
  ];

  function pickIcebreakerTemplate(seed) {
    return ICEBREAKER_TEMPLATES[hashSeed(seed + ":ib") % ICEBREAKER_TEMPLATES.length];
  }

  function extractFirstNameFromEmail(emailRaw) {
    var email = emailRaw != null ? String(emailRaw).trim().toLowerCase() : "";
    var at = email.indexOf("@");
    var local = at > 0 ? email.slice(0, at) : email;
    var parts = local.split(/[._-]+/).filter(Boolean);
    var first = parts[0] || "";
    if (!first || !/^[A-Za-z][A-Za-z'-]*$/.test(first) || first.length < 2 || first.length > 24 || /\d/.test(first)) {
      return "";
    }
    return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
  }

  function resolveFirstNameForTarget(target, opts) {
    var t = target && typeof target === "object" ? target : {};
    var h = String(t.greetingNameHint || t.greetingNameHintLast || "").trim();
    if (h) {
      var first = h.split(/\s+/)[0] || "";
      if (/^[A-Za-z][A-Za-z'-]*$/.test(first) && first.length >= 2) return first;
    }
    var fn =
      (t.contact && t.contact.firstName && String(t.contact.firstName).trim()) ||
      (t.firstName && String(t.firstName).trim()) ||
      "";
    if (fn && /^[A-Za-z][A-Za-z'-]*$/.test(fn)) return fn;
    var email =
      (opts && opts.email ? String(opts.email) : "") ||
      String(t.contactEmail || (t.contact && t.contact.email) || "").trim();
    return extractFirstNameFromEmail(email);
  }

  function greetingForTarget(target, opts) {
    var t = target && typeof target === "object" ? target : {};
    var h = String(t.greetingNameHint || "").trim();
    if (h) {
      return /^(?:hi|hello|hey|good day)\b/i.test(h) ? h : "Hey " + h + ",";
    }
    var first = resolveFirstNameForTarget(t, opts);
    if (first) return "Hey " + first + ",";
    return NEUTRAL_GREETINGS[0];
  }

  function defaultIceBreakerFallback(firstName, companyName) {
    if (firstName && companyName) return "I wanted to reach out to " + firstName + " at " + companyName + ".";
    if (companyName) return "I came across " + companyName + " and wanted to connect.";
    return "I wanted to reach out and introduce the outreach team.";
  }

  function deriveCompanyLabelFromEmail(emailRaw) {
    var email = emailRaw != null ? String(emailRaw).trim().toLowerCase() : "";
    var at = email.indexOf("@");
    if (at < 1) return "";
    var parts = email.slice(at + 1).split(".").filter(Boolean);
    if (!parts.length) return "";
    var base = parts[0];
    if (parts.length >= 3 && parts[parts.length - 1].length <= 3 && parts[parts.length - 2].length <= 3) {
      base = parts[parts.length - 3] || parts[0];
    }
    if (!base || GENERIC_EMAIL_DOMAINS[base] || base.length < 2) return "";
    return base
      .split(/[-_]+/)
      .filter(Boolean)
      .map(function (w) {
        return w.charAt(0).toUpperCase() + w.slice(1);
      })
      .join(" ");
  }

  /**
   * Keep in sync with Deliverables/functions/greetingTemplate.js formatProfessionalEmailBody.
   */
  function indentProfessionalListLines(text) {
    return String(text || "")
      .split("\n")
      .map(function (line) {
        var trimmed = line.replace(/\s+$/, "");
        if (!trimmed) return "";
        var content = trimmed.replace(/^\s+/, "");
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
      .map(function (line) {
        var trimmed = line.replace(/^\s+/, "");
        if (/^(-|\u2022|\d+\.)\s/.test(trimmed)) return line;
        return line.replace(/\s+-\s+/g, " ");
      })
      .join("\n");
  }

  function formatProfessionalEmailBody(text) {
    var s = normalizeProseDashes(String(text || "").trim());
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
    var s = String(text || "");
    s = s.replace(/[ \t]{2,}/g, " ");
    s = s.replace(/\s+in\s+with\b/gi, " with");
    s = s.replace(/\borgs like\s+with\b/gi, "organizations with");
    s = s.replace(/\borgs like\s+in\b/gi, "organizations in");
    s = s.replace(/companies in\s+on\b/gi, "companies on");
    s = s.replace(/companies in\s+with\b/gi, "companies with");
    s = s.replace(/partners with companies in\s+on\b/gi, "partners with companies on");
    s = s.replace(/partners with companies in\s+/gi, "partners with companies ");
    s = s.replace(/while looking at teams in\s*\./gi, "while researching companies in your space.");
    s = s.replace(/companies in\s+and\b/gi, "companies and");
    s = s.replace(/^A question for\s*$/gm, "A quick question");
    s = s.replace(/^Hoping to connect with\s*$/gm, "Hoping to connect");
    s = s.replace(/^What are your thoughts,\s*$/gm, "What are your thoughts?");
    s = s.replace(/^A question regarding\s*$/gm, "A quick question");
    s = s.replace(/^Quick intro —\s*$/gm, "Quick intro from Outreach Platform");
    s = s.replace(/If we could help\s+with\b/gi, "If we could help your team with");
    s = s.replace(/\n{3,}/g, "\n\n");
    return s.trim();
  }

  function extendedOutreachTokens(ctx) {
    var email = String(ctx.email || "").trim();
    var seed = email || String(ctx.companyName || "").trim() || "default";
    var cs = pickCaseStudy(seed);
    var pain = String(ctx.painPointHint || "").trim() || pickPainPoint(seed);
    var niche = String(ctx.niche || "").trim() || NICHE_DEFAULT;
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

  var TOKEN_KEYS = [
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

  function buildOutreachContext(target, opts) {
    var t = target && typeof target === "object" ? target : {};
    var o = opts && typeof opts === "object" ? opts : {};
    var email =
      (o.email ? String(o.email) : "") ||
      String(t.contactEmail || (t.contact && t.contact.email) || "").trim();
    var firstName = resolveFirstNameForTarget(t, {email: email});
    var companyName = String(o.companyName || t.companyName || t.name || "").trim();
    if (!companyName) companyName = deriveCompanyLabelFromEmail(email) || "";
    var city = String(o.city || t.city || "").trim();
    var campaignName = String(o.campaignName || t.lastCampaignName || t.campaignName || "").trim();
    var senderName = String(o.outreachSenderName || o.senderName || t.outreachSenderName || "").trim();
    var senderTitle = String(o.outreachSenderTitle || o.senderTitle || t.outreachSenderTitle || "Account Lead").trim();
    var iceBreaker = String(o.iceBreakerHint || t.iceBreakerHint || "").trim();
    if (!iceBreaker) {
      var ibTpl = pickIcebreakerTemplate(email || companyName);
      var partial = {
        Greeting: greetingForTarget(t, {email: email}),
        FirstName: firstName,
        CompanyName: companyName || "your organization",
        City: city,
        email: email,
        painPointHint: String(o.painPointHint || "").trim(),
      };
      Object.assign(partial, extendedOutreachTokens(partial));
      iceBreaker = String(ibTpl.text || "").replace(/\{([A-Za-z]+)\}/g, function (match, key) {
        if (Object.prototype.hasOwnProperty.call(partial, key)) {
          return partial[key] != null ? String(partial[key]) : "";
        }
        return match;
      });
      iceBreaker = polishFilledOutreachText(iceBreaker);
      if (!iceBreaker.trim()) iceBreaker = defaultIceBreakerFallback(firstName, companyName);
    }
    var base = {
      Greeting: greetingForTarget(t, {email: email}),
      FirstName: firstName,
      CompanyName: companyName,
      City: city,
      CampaignName: campaignName,
      SenderName: senderName || "outreach team",
      SenderTitle: senderTitle,
      IceBreaker: iceBreaker,
      email: email,
      painPointHint: String(o.painPointHint || "").trim(),
      niche: String(o.niche || "").trim(),
    };
    return Object.assign(base, extendedOutreachTokens(base));
  }

  function fillOutreachTemplate(tpl, target, opts) {
    var ctx = buildOutreachContext(target, opts);
    var filled = String(tpl || "").replace(/\{([A-Za-z]+)\}/g, function (match, key) {
      if (Object.prototype.hasOwnProperty.call(ctx, key)) {
        return ctx[key] != null ? String(ctx[key]) : "";
      }
      var lower = key.toLowerCase();
      for (var i = 0; i < TOKEN_KEYS.length; i++) {
        if (TOKEN_KEYS[i].toLowerCase() === lower) {
          return ctx[TOKEN_KEYS[i]] != null ? String(ctx[TOKEN_KEYS[i]]) : "";
        }
      }
      return match;
    });
    return polishFilledOutreachText(filled);
  }

  var SUBJECT_TEMPLATES = [
    {id: "sub_question", label: "A question for {FirstName}", text: "A question for {FirstName}"},
    {id: "sub_outcome", label: "Fancy a chat (pattern interrupt)", text: "Fancy a chat about {Outcome}?"},
    {id: "sub_hoping", label: "Hoping to connect", text: "Hoping to connect with {FirstName}"},
    {id: "sub_thoughts", label: "What are your thoughts", text: "What are your thoughts, {FirstName}"},
    {id: "sub_pain", label: "Quick question re: pain", text: "Quick question about {PainPoint}"},
    {id: "sub_company", label: "Question re: company", text: "A question regarding {CompanyName}"},
    {id: "sub_team", label: "Outreach Platform intro", text: "Introduction from the outreach team"},
  ];

  var KICKOFF_BODIES = [
    {
      id: "kick_value_case",
      label: "Value prop + case study (proven #1)",
      text:
        "{Greeting}\n\n{IceBreaker}\n\nI'm getting in touch because we help {Niche} secure {Offer} without adding headcount overnight.\n\nWe recently supported {CaseStudy} ({CaseStudyResult}).\n\nWould it be alright if I sent a short overview of how we run outbound for teams like yours?",
    },
    {
      id: "kick_case_compare",
      label: "Case study + comparable ask (#2)",
      text:
        "{Greeting}\n\n{IceBreaker}\n\nWe recently helped {CaseStudy} and I believe we could do something comparable for {CompanyName}.\n\nMight I show you how our {Service} works in a 15-minute call?",
    },
    {
      id: "kick_pain",
      label: "Quick outcome / pain point (#3)",
      text: "{Greeting}\n\n{IceBreaker}\n\nIf I could help with {PainPoint}, would that be something you'd want to hear more about?",
    },
    {
      id: "kick_ultra_short",
      label: "Extremely short (#4)",
      text:
        "{Greeting}\n\nThis is the shortest email you'll get all day.\n\nIf someone could help with {PainPoint}, would that be of use?",
    },
    {
      id: "kick_subject_body",
      label: "Subject-line question in body (#5)",
      text:
        "{Greeting}\n\n{IceBreaker}\n\nFancy a chat about {Outcome}? Happy to keep it brief and work around your calendar.",
    },
    {
      id: "kick_team_safe",
      label: "Safe generic (no city required)",
      text:
        "{Greeting}\n\n{IceBreaker}\n\nWe run structured outbound and follow-through for teams that need pipeline without another hire.\n\nOpen to a short call this week or next?",
    },
  ];

  var FOLLOWUP_BODIES = [
    {
      id: "fu_thoughts_cases",
      label: "Thoughts + case examples (#1)",
      text:
        "{Greeting}\n\nLet me know your thoughts, {FirstName}.\n\nWe've supported teams across {Niche}, including {CaseStudy}, and I'm glad to share a few examples if useful.",
    },
    {
      id: "fu_cracks_loom",
      label: "Slip through + Loom offer (#2)",
      text:
        "{Greeting}\n\nHello again {FirstName}, just making sure this didn't slip through the cracks.\n\nHappy to send a quick Loom walking through our {Service} if that's easier than a call.",
    },
    {
      id: "fu_nudge_meeting",
      label: "Nudge + meeting ask (#3)",
      text:
        "{Greeting}\n\nJust nudging this back to the top of your inbox, {FirstName}!\n\nAre you free this week or early next to talk through {Service}?",
    },
    {
      id: "fu_buried",
      label: "Short buried check (#4)",
      text: "{Greeting}\n\nJust checking this didn't get buried.",
    },
    {
      id: "fu_pain",
      label: "Pain point reminder",
      text: "{Greeting}\n\nStill happy to help if {PainPoint} is on your radar. No pressure either way.",
    },
    {
      id: "fu_case",
      label: "Case study nudge",
      text:
        "{Greeting}\n\nCircling back once. {CaseStudy} saw {CaseStudyResult} with a similar engagement model.\n\nWorth a quick look for {CompanyName}?",
    },
  ];

  function getKickoffPoolFromTemplates() {
    var pool = [];
    for (var i = 0; i < SUBJECT_TEMPLATES.length; i++) {
      var sub = SUBJECT_TEMPLATES[i];
      var body = KICKOFF_BODIES[i % KICKOFF_BODIES.length];
      pool.push({subject: sub.text, body: body.text});
    }
    return pool;
  }

  function suggestPainPointForRecipient(email, companyName) {
    return pickPainPoint(email || companyName || "default");
  }

  window.TJEmailTemplates = {
    DEFAULT_OUTREACH_VIBE: DEFAULT_OUTREACH_VIBE,
    DEFAULT_CALENDLY_LINK: DEFAULT_CALENDLY_LINK,
    SUBJECT_TEMPLATES: SUBJECT_TEMPLATES,
    KICKOFF_BODIES: KICKOFF_BODIES,
    FOLLOWUP_BODIES: FOLLOWUP_BODIES,
    ICEBREAKER_TEMPLATES: ICEBREAKER_TEMPLATES,
    PAIN_POINTS: PAIN_POINTS,
    CASE_STUDIES: CASE_STUDIES,
    fillOutreachTemplate: fillOutreachTemplate,
    buildOutreachContext: buildOutreachContext,
    deriveCompanyLabelFromEmail: deriveCompanyLabelFromEmail,
    polishFilledOutreachText: polishFilledOutreachText,
    formatProfessionalEmailBody: formatProfessionalEmailBody,
    defaultIceBreakerFallback: defaultIceBreakerFallback,
    pickIcebreakerTemplate: pickIcebreakerTemplate,
    suggestPainPointForRecipient: suggestPainPointForRecipient,
    getKickoffPoolFromTemplates: getKickoffPoolFromTemplates,
    TOKEN_LEGEND:
      "{Greeting}, {FirstName}, {IceBreaker}, {PainPoint}, {Offer}, {CaseStudy}, {Niche}, {Service}, {Outcome}, {CompanyName}, {City}",
  };
})();

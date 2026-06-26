/**
 * Sync-first Auto-fill + Chat-style Generate email for Send email.
 * Requires TJOutreachAutofill.configure() from email.html with page hooks.
 */
(function () {
  var hooks = {};
  var statusTimer = null;

  function configure(h) {
    hooks = h || {};
    initBriefLengthChips();
  }

  function hcall(name) {
    var fn = hooks[name];
    if (typeof fn !== "function") return undefined;
    return fn.apply(null, Array.prototype.slice.call(arguments, 1));
  }

  function getDefaultVibeText() {
    var tpl = window.TJEmailTemplates;
    if (tpl && tpl.DEFAULT_OUTREACH_VIBE) return String(tpl.DEFAULT_OUTREACH_VIBE);
    return "We're a SaaS company offering personalized outreach. Sound human and specific — short paragraphs, one clear angle, no hype or obvious AI phrasing.";
  }

  function isGenericVibe(v) {
    if (typeof hooks.isGenericOutreachVibe === "function") {
      return hooks.isGenericOutreachVibe(v);
    }
    var s = String(v || "").trim();
    if (!s) return true;
    return s === getDefaultVibeText();
  }

  function deriveCompanyFromEmail(email) {
    var tpl = window.TJEmailTemplates;
    if (!tpl || !tpl.deriveCompanyLabelFromEmail) return "";
    return String(tpl.deriveCompanyLabelFromEmail(email) || "").trim();
  }

  function emailDomainLabel(email) {
    var e = String(email || "").trim().toLowerCase();
    var at = e.indexOf("@");
    if (at < 1) return "";
    var domain = e.slice(at + 1).split(".")[0] || "";
    if (!domain) return "";
    return domain.charAt(0).toUpperCase() + domain.slice(1);
  }

  function hasRecipientEmail(payload) {
    return !!(payload.email && payload.email.indexOf("@") > 0);
  }

  function hasAutofillContext(payload) {
    if (hasRecipientEmail(payload)) return true;
    if (payload.companyName) return true;
    if (payload.targetId) return true;
    return false;
  }

  function readUserBrief() {
    var vibeEl = document.getElementById("emailOutreachVibe");
    return vibeEl ? String(vibeEl.value || "").trim() : "";
  }

  function readEmailLength() {
    var el = document.getElementById("emailBriefLength");
    var v = el ? String(el.value || "").trim().toLowerCase() : "medium";
    if (v === "short" || v === "long") return v;
    return "medium";
  }

  function initBriefLengthChips() {
    var chips = document.querySelectorAll(".email-brief__chip[data-length]");
    if (!chips.length) return;
    for (var i = 0; i < chips.length; i++) {
      chips[i].addEventListener("click", function () {
        var len = this.getAttribute("data-length") || "medium";
        var hidden = document.getElementById("emailBriefLength");
        if (hidden) hidden.value = len;
        var all = document.querySelectorAll(".email-brief__chip[data-length]");
        for (var j = 0; j < all.length; j++) {
          all[j].classList.toggle("email-brief__chip--active", all[j] === this);
        }
      });
    }
  }

  function buildAutofillPayload() {
    var head = hcall("getCurrentBulkHead") || null;
    var toEl = document.getElementById("testTo");
    var dnEl = document.getElementById("emailDirectorName");
    var campEl = document.getElementById("campaignName");
    var composeCo = document.getElementById("emailComposeCompany");
    var hiddenCo = document.getElementById("testCompanyName");
    var cityEl = document.getElementById("emailComposeCity");
    var tidEl = document.getElementById("testTargetId");

    var email = head ? String(head.email || "").trim() : toEl ? String(toEl.value || "").trim() : "";
    var companyName = composeCo ? String(composeCo.value || "").trim() : "";
    if (!companyName && hiddenCo) companyName = String(hiddenCo.value || "").trim();

    if (!companyName && email) {
      companyName = deriveCompanyFromEmail(email);
      if (companyName && composeCo && !String(composeCo.value || "").trim()) {
        composeCo.value = companyName;
      }
      if (companyName && hiddenCo && !String(hiddenCo.value || "").trim()) {
        hiddenCo.value = companyName;
      }
    }

    var city = cityEl ? String(cityEl.value || "").trim() : "";
    if (!city && head) city = String(head.city || "").trim();

    var painEl = document.getElementById("emailPainPoint");
    var painPoint = painEl ? String(painEl.value || "").trim() : "";

    return {
      tenantId: hcall("getComposeTenantId") || "default",
      email: email,
      companyName: companyName,
      city: city,
      targetId: tidEl ? String(tidEl.value || "").trim() : "",
      directorFirstName: dnEl ? String(dnEl.value || "").trim() : "",
      campaignName: head
        ? String(head.campaignName || "").trim()
        : campEl
          ? String(campEl.value || "").trim()
          : "",
      existingVibe: readUserBrief(),
      painPoint: painPoint,
    };
  }

  function findIcebreakerTemplateById(id) {
    var tpl = window.TJEmailTemplates;
    if (!tpl || !tpl.ICEBREAKER_TEMPLATES) return null;
    for (var i = 0; i < tpl.ICEBREAKER_TEMPLATES.length; i++) {
      if (tpl.ICEBREAKER_TEMPLATES[i].id === id) return tpl.ICEBREAKER_TEMPLATES[i];
    }
    return null;
  }

  function buildVibeForPayload(payload) {
    var companyName = String(payload.companyName || "").trim();
    var email = String(payload.email || "").trim();
    var existingVibe = String(payload.existingVibe || "").trim();

    if (!isGenericVibe(existingVibe)) return existingVibe;

    if (companyName) {
      return (
        "Personalized SaaS outreach to " +
        companyName +
        ". Sound human and specific — one clear product or outcome angle, short paragraphs, no hype or obvious AI phrasing."
      );
    }

    if (email) {
      var label = deriveCompanyFromEmail(email) || emailDomainLabel(email) || "this contact";
      return (
        "Outreach to " +
        label +
        " — sound human and specific, short paragraphs, one clear angle, no hype or obvious AI phrasing."
      );
    }

    if (payload.targetId) {
      return "Personalized outreach for this pipeline contact — human, specific, short paragraphs, no hype or obvious AI phrasing.";
    }

    return getDefaultVibeText();
  }

  function computeClientSetup(payload) {
    var tpl = window.TJEmailTemplates;
    var companyName = String(payload.companyName || "").trim();
    var city = String(payload.city || "").trim();
    var email = String(payload.email || "").trim();
    var seed = email || companyName || payload.targetId || "default";
    var painPoint =
      payload.painPoint ||
      (tpl && tpl.suggestPainPointForRecipient
        ? tpl.suggestPainPointForRecipient(seed, companyName)
        : "inconsistent outbound and follow-up");
    var outreachVibe = buildVibeForPayload(payload);
    var subjectTemplateId = companyName ? "sub_company" : "sub_question";
    var bodyTemplateId = city ? "kick_value_case" : "kick_pain";
    var icebreakerTemplateId = city ? "ib_city" : companyName ? "ib_research" : "ib_short";
    var ibTpl = findIcebreakerTemplateById(icebreakerTemplateId);
    if (!ibTpl && tpl && tpl.pickIcebreakerTemplate) {
      ibTpl = tpl.pickIcebreakerTemplate(seed);
      if (ibTpl) icebreakerTemplateId = ibTpl.id;
    }
    var target = hcall("buildComposeTargetFromItem") || {};
    var opts = hcall("getComposeFillOpts") || {};
    var iceBreaker = "";
    if (ibTpl && ibTpl.text && typeof hooks.fillOutreachTemplateClient === "function") {
      iceBreaker = hooks.fillOutreachTemplateClient(ibTpl.text, target, opts);
    }
    return {
      outreachVibe: outreachVibe.slice(0, 500),
      subjectTemplateId: subjectTemplateId,
      bodyTemplateId: bodyTemplateId,
      icebreakerTemplateId: icebreakerTemplateId,
      painPoint: painPoint,
      iceBreaker: iceBreaker.slice(0, 500),
      source: "client-heuristic",
      companyUsed: companyName || deriveCompanyFromEmail(email) || emailDomainLabel(email) || "",
    };
  }

  function selectTemplateOptionById(sel, id) {
    if (!sel || !id) return "";
    for (var i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === id) {
        sel.selectedIndex = i;
        return sel.options[i].getAttribute("data-text") || "";
      }
    }
    return "";
  }

  function templateSelectNeedsInit(sel) {
    if (!sel) return false;
    return sel.options.length <= 1;
  }

  function getSelectedTemplateTexts() {
    var ctx = getSelectedTemplateContext();
    return {subTpl: ctx.subjectTemplateSkeleton, bodyTpl: ctx.bodyTemplateSkeleton};
  }

  function getSelectedTemplateContext() {
    var subSel = document.getElementById("emailSubjectTemplate");
    var bodySel = document.getElementById("emailBodyTemplate");
    var ibSel = document.getElementById("emailIcebreakerTemplate");
    var iceEl = document.getElementById("emailIceBreaker");
    var subjectTemplateId = "";
    var bodyTemplateId = "";
    var icebreakerTemplateId = "";
    var subjectTemplateSkeleton = "";
    var bodyTemplateSkeleton = "";
    if (subSel && subSel.selectedIndex > 0) {
      subjectTemplateId = String(subSel.value || "").trim();
      subjectTemplateSkeleton = subSel.options[subSel.selectedIndex].getAttribute("data-text") || "";
    }
    if (bodySel && bodySel.selectedIndex > 0) {
      bodyTemplateId = String(bodySel.value || "").trim();
      bodyTemplateSkeleton = bodySel.options[bodySel.selectedIndex].getAttribute("data-text") || "";
    }
    if (ibSel && ibSel.selectedIndex > 0) {
      icebreakerTemplateId = String(ibSel.value || "").trim();
    }
    var iceBreaker = iceEl ? String(iceEl.value || "").trim() : "";
    var refs = resolveTemplateRefs(subjectTemplateSkeleton, bodyTemplateSkeleton);
    return {
      subjectTemplateId: subjectTemplateId,
      bodyTemplateId: bodyTemplateId,
      icebreakerTemplateId: icebreakerTemplateId,
      subjectTemplateSkeleton: subjectTemplateSkeleton,
      bodyTemplateSkeleton: bodyTemplateSkeleton,
      subjectTemplateRef: refs.subjectTemplateRef,
      bodyTemplateRef: refs.bodyTemplateRef,
      iceBreaker: iceBreaker,
    };
  }

  function resolveTemplateRefs(subTpl, bodyTpl) {
    var target = hcall("buildComposeTargetFromItem") || {};
    var opts = hcall("getComposeFillOpts") || {};
    var subjectRef = "";
    var bodyRef = "";
    if (subTpl && typeof hooks.fillOutreachTemplateClient === "function") {
      subjectRef = hooks.fillOutreachTemplateClient(subTpl, target, opts);
    }
    if (bodyTpl && typeof hooks.fillOutreachTemplateClient === "function") {
      bodyRef = hooks.fillOutreachTemplateClient(bodyTpl, target, opts);
    }
    return {subjectTemplateRef: subjectRef, bodyTemplateRef: bodyRef};
  }

  function applySetupResult(j, opts) {
    var o = opts || {};
    if (!j) return {applied: false, subTplFound: false, bodyTplFound: false, companyUsed: "", subTpl: "", bodyTpl: ""};
    if (j.outreachVibe && !o.preserveBrief && typeof hooks.applyOutreachVibeToField === "function") {
      hooks.applyOutreachVibeToField(String(j.outreachVibe).trim(), {onlyIfEmpty: false});
    }
    var subSel = document.getElementById("emailSubjectTemplate");
    var bodySel = document.getElementById("emailBodyTemplate");
    var ibSel = document.getElementById("emailIcebreakerTemplate");
    if (
      templateSelectNeedsInit(subSel) ||
      templateSelectNeedsInit(bodySel) ||
      templateSelectNeedsInit(ibSel)
    ) {
      hcall("initEmailTemplatePicker");
    }
    var subTpl = selectTemplateOptionById(subSel, j.subjectTemplateId);
    var bodyTpl = selectTemplateOptionById(bodySel, j.bodyTemplateId);
    if (j.icebreakerTemplateId) selectTemplateOptionById(ibSel, j.icebreakerTemplateId);
    var painEl = document.getElementById("emailPainPoint");
    if (painEl && j.painPoint) painEl.value = String(j.painPoint).trim();
    var iceEl = document.getElementById("emailIceBreaker");
    if (iceEl && j.iceBreaker) iceEl.value = String(j.iceBreaker).trim();
    if (!o.skipComposeFields && (subTpl || bodyTpl)) {
      hcall("applyFilledTemplateToCompose", subTpl || null, bodyTpl || null, false, true);
    } else {
      hcall("updateOutreachTemplatePreview");
    }
    return {
      applied: true,
      subTplFound: !!subTpl,
      bodyTplFound: !!bodyTpl,
      companyUsed: j.companyUsed || "",
      subTpl: subTpl,
      bodyTpl: bodyTpl,
    };
  }

  function setStatus(text, kind, persistMs) {
    var el = document.getElementById("emailBriefStatus") || document.getElementById("autoFillSetupStatus");
    if (!el) return;
    if (statusTimer) {
      clearTimeout(statusTimer);
      statusTimer = null;
    }
    el.textContent = text || "";
    var baseClass = el.id === "emailBriefStatus" ? "email-brief__status" : "email-vibe-row__status";
    el.className = baseClass + (kind ? " " + baseClass + "--" + kind : "");
    var ms = persistMs != null ? persistMs : 4000;
    if (text && ms > 0) {
      statusTimer = setTimeout(function () {
        if (el) {
          el.textContent = "";
          el.className = baseClass;
        }
        statusTimer = null;
      }, ms);
    }
  }

  function tjFetchWithTimeout(url, options, timeoutMs) {
    var ms = timeoutMs || 8000;
    return Promise.race([
      window.TJFetch(url, options),
      new Promise(function (_, reject) {
        setTimeout(function () {
          var err = new Error("TJFetch timeout after " + ms + "ms");
          err.name = "TimeoutError";
          reject(err);
        }, ms);
      }),
    ]);
  }

  async function fetchSuggestOutreachSetup(payload, timeoutMs) {
    if (typeof window.TJFetch !== "function") return null;
    var ms = timeoutMs || 8000;
    try {
      var res = await tjFetchWithTimeout(
        "/api/ai/suggest-outreach-setup",
        {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify(payload),
        },
        ms
      );
      var j = await res.json().catch(function () {
        return {};
      });
      return {res: res, body: j};
    } catch (_) {
      return null;
    }
  }

  async function fetchComposeKickoffEmail(payload, timeoutMs) {
    if (typeof window.TJFetch !== "function") return null;
    var ms = timeoutMs || 12000;
    try {
      var res = await tjFetchWithTimeout(
        "/api/ai/compose-kickoff-email",
        {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify(payload),
        },
        ms
      );
      var j = await res.json().catch(function () {
        return {};
      });
      return {res: res, body: j};
    } catch (_) {
      return null;
    }
  }

  function applyComposeToFields(subject, body) {
    var subEl = document.getElementById("testSubject");
    var bodyEl = document.getElementById("testBody");
    if (subEl && subject) {
      subEl.value = subject;
      subEl.removeAttribute("data-auto-filled");
    }
    if (bodyEl && body) {
      bodyEl.value = body;
      bodyEl.removeAttribute("data-auto-filled");
    }
    hcall("updateOutreachTemplatePreview");
  }

  async function runGenerateEmail() {
    var btn = document.getElementById("btnGenerateEmail");
    var userBrief = readUserBrief();
    var payload = buildAutofillPayload();

    if (!userBrief && !hasAutofillContext(payload)) {
      setStatus("Describe your email or add a recipient first", "warn");
      return;
    }

    if (!userBrief) {
      setStatus("Add a brief describing tone, length, and angle", "warn");
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.textContent = "Generating…";
    }

    var setupResult = null;
    var meta = {applied: false, subTpl: "", bodyTpl: ""};

    try {
      setStatus("Picking templates…", "", 0);

      var apiSetup = await fetchSuggestOutreachSetup(payload, 8000);
      if (apiSetup && apiSetup.res && apiSetup.res.ok && apiSetup.body) {
        setupResult = apiSetup.body;
      } else {
        setupResult = computeClientSetup(payload);
      }

      meta = applySetupResult(setupResult, {preserveBrief: true, skipComposeFields: true});

      if (!meta.subTpl && !meta.bodyTpl) {
        var picked = getSelectedTemplateTexts();
        meta.subTpl = picked.subTpl;
        meta.bodyTpl = picked.bodyTpl;
      }

      hcall("applyFilledTemplateToCompose", meta.subTpl || null, meta.bodyTpl || null, true, false);

      var templateCtx = getSelectedTemplateContext();
      var subEl = document.getElementById("testSubject");
      var bodyEl = document.getElementById("testBody");
      if (subEl) {
        templateCtx.subjectTemplateRef =
          String(subEl.value || "").trim() || templateCtx.subjectTemplateRef;
      }
      if (bodyEl) {
        templateCtx.bodyTemplateRef = String(bodyEl.value || "").trim() || templateCtx.bodyTemplateRef;
      }

      setStatus("Personalizing…", "", 0);

      var painEl = document.getElementById("emailPainPoint");
      var composePayload = {
        tenantId: payload.tenantId,
        companyName: payload.companyName,
        directorFirstName: payload.directorFirstName,
        city: payload.city,
        painPoint: painEl ? String(painEl.value || "").trim() : payload.painPoint || "",
        outreachVibe: userBrief,
        userBrief: userBrief,
        emailLength: readEmailLength(),
        subjectTemplateId: templateCtx.subjectTemplateId,
        bodyTemplateId: templateCtx.bodyTemplateId,
        icebreakerTemplateId: templateCtx.icebreakerTemplateId,
        subjectTemplateSkeleton: templateCtx.subjectTemplateSkeleton,
        bodyTemplateSkeleton: templateCtx.bodyTemplateSkeleton,
        subjectTemplateRef: templateCtx.subjectTemplateRef,
        bodyTemplateRef: templateCtx.bodyTemplateRef,
        iceBreaker: templateCtx.iceBreaker,
        campaignName: payload.campaignName,
        variant: typeof hooks.getAiComposeRot === "function" ? hooks.getAiComposeRot() : 0,
      };

      var apiCompose = await fetchComposeKickoffEmail(composePayload, 12000);
      var applied = false;

      if (apiCompose && apiCompose.res && apiCompose.res.ok && apiCompose.body) {
        var j = apiCompose.body;
        var bRaw = j.text != null ? j.text : j.body != null ? j.body : j.plain;
        var sFromApi = j.subject != null ? j.subject : j.sub;
        bRaw = bRaw != null && String(bRaw).trim() ? String(bRaw).trim() : "";
        sFromApi = sFromApi != null && String(sFromApi).trim() ? String(sFromApi).trim() : "";
        if (bRaw || sFromApi) {
          var formattedBody =
            typeof hooks.formatApiEmailBody === "function" ? hooks.formatApiEmailBody(bRaw) : bRaw;
          applyComposeToFields(sFromApi, formattedBody || bRaw);
          applied = true;
          if (typeof hooks.incrementAiComposeRot === "function") hooks.incrementAiComposeRot();
        }
      }

      if (!applied && typeof hooks.buildLocalKickoffDraft === "function") {
        var local = hooks.buildLocalKickoffDraft(composePayload.variant || 0);
        if (local && (local.subject || local.body)) {
          applyComposeToFields(local.subject || "", local.body || "");
          applied = true;
        }
      }

      if (applied) {
        setStatus("Email ready — review before sending", "ok", 5000);
      } else {
        setStatus("Templates applied — AI unavailable, try AI: new draft", "warn", 5000);
      }
    } catch (_) {
      setStatus("Could not generate right now", "warn");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Generate email";
      }
    }
  }

  async function runOutreachAutofill() {
    var btn = document.getElementById("btnAutoFillOutreachSetup");
    var payload = buildAutofillPayload();
    var hasContext = hasAutofillContext(payload);

    if (!hasContext) {
      setStatus("Add a recipient or company first", "warn");
      return;
    }

    if (btn) btn.textContent = "Auto-filling…";
    setStatus("", "");

    var applied = false;
    var meta = {applied: false, subTplFound: false, bodyTplFound: false, companyUsed: ""};
    var hasEmail = hasRecipientEmail(payload);

    try {
      var clientResult = computeClientSetup(payload);
      meta = applySetupResult(clientResult);
      applied = meta.applied;
    } catch (_) {
      setStatus("Could not auto-fill right now", "warn");
    } finally {
      if (btn) btn.textContent = "Auto-fill setup only";
    }

    if (applied) {
      var label = meta.companyUsed || payload.companyName || (hasEmail ? payload.email : "setup");
      setStatus("Filled for " + label, "ok");
    }

    if (hasEmail && applied) {
      try {
        var apiResult = await fetchSuggestOutreachSetup(payload, 8000);
        var res = apiResult ? apiResult.res : null;
        var j = apiResult ? apiResult.body : null;
        if (res && res.ok && j) {
          applySetupResult(j);
        }
      } catch (_) {}
    }
  }

  window.TJOutreachAutofill = {
    configure: configure,
    buildAutofillPayload: buildAutofillPayload,
    computeClientSetup: computeClientSetup,
    applySetupResult: applySetupResult,
    getSelectedTemplateContext: getSelectedTemplateContext,
    run: runOutreachAutofill,
    runGenerate: runGenerateEmail,
  };
})();

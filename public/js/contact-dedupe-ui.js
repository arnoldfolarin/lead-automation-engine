/**
 * Shared duplicate-warning UI for import previews and send queues.
 * Requires TJContactDedupe on window.
 */
(function (global) {
  "use strict";

  var D = global.TJContactDedupe;
  if (!D) return;

  function hasImportFlags(analysis) {
    if (!analysis) return false;
    return (analysis.withinCount || 0) > 0 || (analysis.pipelineCount || 0) > 0;
  }

  function importBannerMessage(analysis) {
    var parts = [];
    var within = analysis.withinCount || 0;
    var pipe = analysis.pipelineCount || 0;
    if (within > 0) {
      parts.push(
        within +
          " duplicate email" +
          (within === 1 ? "" : "s") +
          " in this file — sending twice looks like spam."
      );
    }
    if (pipe > 0) {
      parts.push(
        pipe + " contact" + (pipe === 1 ? "" : "s") + " already on Pipeline."
      );
    }
    return parts.join(" ");
  }

  function makeBannerBtn(label, action) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "contact-dedupe-banner__btn";
    btn.textContent = label;
    btn.addEventListener("click", function () {
      action();
    });
    return btn;
  }

  /**
   * @param {HTMLElement|null} containerEl
   * @param {object} analysis
   * @param {(action: "within"|"pipeline"|"all") => void} onAction
   */
  function renderImportDedupeBanner(containerEl, analysis, onAction) {
    if (!containerEl) return;
    containerEl.innerHTML = "";
    containerEl.hidden = true;
    containerEl.className = "contact-dedupe-banner";
    if (!hasImportFlags(analysis)) return;

    containerEl.hidden = false;
    var msg = document.createElement("p");
    msg.className = "contact-dedupe-banner__msg";
    msg.textContent = importBannerMessage(analysis);

    var actions = document.createElement("div");
    actions.className = "contact-dedupe-banner__actions";

    if ((analysis.withinCount || 0) > 0) {
      actions.appendChild(
        makeBannerBtn("Remove file duplicates (keep first)", function () {
          onAction("within");
        })
      );
    }
    if ((analysis.pipelineCount || 0) > 0) {
      actions.appendChild(
        makeBannerBtn("Remove Pipeline matches", function () {
          onAction("pipeline");
        })
      );
    }
    if (hasImportFlags(analysis)) {
      actions.appendChild(
        makeBannerBtn("Remove all flagged", function () {
          onAction("all");
        })
      );
    }

    containerEl.appendChild(msg);
    containerEl.appendChild(actions);
  }

  /**
   * @param {HTMLTableSectionElement|null} tbody
   * @param {object} analysis
   */
  function applyImportRowFlags(tbody, analysis) {
    if (!tbody || !analysis || !analysis.rows) return;
    var trs = tbody.querySelectorAll("tr[data-import-idx]");
    for (var i = 0; i < trs.length; i++) {
      var tr = trs[i];
      var idx = parseInt(tr.getAttribute("data-import-idx") || "-1", 10);
      var row = analysis.rows[idx];
      tr.classList.remove("import-row--dup-within", "import-row--dup-pipeline");
      if (!row) continue;
      if (row.isExtraWithin) tr.classList.add("import-row--dup-within");
      if (row.onPipeline) tr.classList.add("import-row--dup-pipeline");
    }
  }

  function importConfirmLabel(count, analysis) {
    var n = count || 0;
    if (n < 1) return "Import now";
    var flagged = 0;
    if (analysis && analysis.rows) {
      analysis.rows.forEach(function (r) {
        if (r.isExtraWithin || r.onPipeline) flagged++;
      });
    }
    if (flagged > 0) {
      return "Import " + n + " contact" + (n === 1 ? "" : "s") + " (" + flagged + " duplicate" + (flagged === 1 ? "" : "s") + " flagged)";
    }
    return "Import " + n + " contact" + (n === 1 ? "" : "s");
  }

  /**
   * @param {HTMLElement|null} containerEl
   * @param {object|null} analysis
   * @param {() => void} onRemoveDupes
   * @param {string} [extraMessage]
   */
  function renderQueueDedupeBanner(containerEl, analysis, onRemoveDupes, extraMessage) {
    if (!containerEl) return;
    containerEl.innerHTML = "";
    containerEl.hidden = true;
    containerEl.className = "contact-dedupe-banner contact-dedupe-banner--queue";

    var within = analysis && analysis.withinCount ? analysis.withinCount : 0;
    var extra = String(extraMessage || "").trim();
    if (!within && !extra) return;

    containerEl.hidden = false;
    var parts = [];
    if (within > 0) {
      parts.push(
        within +
          " duplicate email" +
          (within === 1 ? "" : "s") +
          " on your send list — remove extras to avoid spamming the same person."
      );
    }
    if (extra) parts.push(extra);

    var msg = document.createElement("p");
    msg.className = "contact-dedupe-banner__msg";
    msg.textContent = parts.join(" ");

    containerEl.appendChild(msg);

    if (within > 0 && typeof onRemoveDupes === "function") {
      var actions = document.createElement("div");
      actions.className = "contact-dedupe-banner__actions";
      actions.appendChild(
        makeBannerBtn("Remove duplicate emails", function () {
          onRemoveDupes();
        })
      );
      containerEl.appendChild(actions);
    }
  }

  function queueChipIsDuplicate(analysis, index) {
    if (!analysis || !analysis.rows) return false;
    var row = analysis.rows[index];
    return !!(row && row.isExtraWithin);
  }

  global.TJContactDedupeUi = {
    hasImportFlags: hasImportFlags,
    importBannerMessage: importBannerMessage,
    renderImportDedupeBanner: renderImportDedupeBanner,
    applyImportRowFlags: applyImportRowFlags,
    importConfirmLabel: importConfirmLabel,
    renderQueueDedupeBanner: renderQueueDedupeBanner,
    queueChipIsDuplicate: queueChipIsDuplicate,
  };
})(typeof window !== "undefined" ? window : globalThis);

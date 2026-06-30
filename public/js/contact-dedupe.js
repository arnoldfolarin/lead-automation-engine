/**
 * Shared duplicate-email detection for import previews and send queues.
 * Exposes TJContactDedupe on window.
 */
(function (global) {
  "use strict";

  function normEmail(s) {
    return String(s == null ? "" : s)
      .trim()
      .toLowerCase();
  }

  function getContactEmail(c) {
    if (!c || typeof c !== "object") return "";
    return normEmail(c.email || c.contactEmail || (c.contact && c.contact.email) || "");
  }

  function getQueueEmail(it) {
    if (!it || typeof it !== "object") return "";
    return normEmail(it.email || it.contactEmail || "");
  }

  /**
   * @param {Array} contacts
   * @param {Set<string>|Array<string>|null} existingEmails - emails already on Pipeline
   * @returns {{ withinBatch: Object, onPipeline: Object, rows: Array, withinCount: number, pipelineCount: number }}
   */
  function analyzeContacts(contacts, existingEmails) {
    var list = Array.isArray(contacts) ? contacts : [];
    var existing = new Set();
    if (existingEmails) {
      if (existingEmails instanceof Set) {
        existingEmails.forEach(function (e) {
          var n = normEmail(e);
          if (n) existing.add(n);
        });
      } else if (Array.isArray(existingEmails)) {
        existingEmails.forEach(function (e) {
          var n = normEmail(e);
          if (n) existing.add(n);
        });
      }
    }

    var byEmail = {};
    var rows = [];
    var withinBatch = {};
    var onPipeline = {};

    for (var i = 0; i < list.length; i++) {
      var email = getContactEmail(list[i]);
      if (!email || email.indexOf("@") < 1) continue;
      if (!byEmail[email]) byEmail[email] = [];
      byEmail[email].push(i);
    }

    for (var em in byEmail) {
      if (!Object.prototype.hasOwnProperty.call(byEmail, em)) continue;
      var indices = byEmail[em];
      if (indices.length > 1) {
        withinBatch[em] = indices.slice();
      }
      if (existing.has(em)) {
        onPipeline[em] = indices.slice();
      }
    }

    var withinCount = 0;
    var pipelineCount = 0;

    for (var j = 0; j < list.length; j++) {
      var rowEmail = getContactEmail(list[j]);
      var within = false;
      var onPipe = false;
      var isExtraWithin = false;

      if (rowEmail && withinBatch[rowEmail]) {
        within = true;
        isExtraWithin = withinBatch[rowEmail].indexOf(j) > 0;
        if (isExtraWithin) withinCount++;
      }
      if (rowEmail && onPipeline[rowEmail]) {
        onPipe = true;
        pipelineCount++;
      }

      rows.push({
        index: j,
        email: rowEmail,
        withinBatch: within,
        onPipeline: onPipe,
        isExtraWithin: isExtraWithin,
      });
    }

    return {
      withinBatch: withinBatch,
      onPipeline: onPipeline,
      rows: rows,
      withinCount: withinCount,
      pipelineCount: pipelineCount,
    };
  }

  /**
   * @param {Array} items - send queue items
   * @returns {{ withinBatch: Object, rows: Array, withinCount: number }}
   */
  function analyzeQueueItems(items) {
    var list = Array.isArray(items) ? items : [];
    var byEmail = {};
    var rows = [];
    var withinBatch = {};

    for (var i = 0; i < list.length; i++) {
      var email = getQueueEmail(list[i]);
      if (!email || email.indexOf("@") < 1) continue;
      if (!byEmail[email]) byEmail[email] = [];
      byEmail[email].push(i);
    }

    for (var em in byEmail) {
      if (!Object.prototype.hasOwnProperty.call(byEmail, em)) continue;
      if (byEmail[em].length > 1) {
        withinBatch[em] = byEmail[em].slice();
      }
    }

    var withinCount = 0;
    for (var j = 0; j < list.length; j++) {
      var rowEmail = getQueueEmail(list[j]);
      var within = false;
      var isExtraWithin = false;
      if (rowEmail && withinBatch[rowEmail]) {
        within = true;
        isExtraWithin = withinBatch[rowEmail].indexOf(j) > 0;
        if (isExtraWithin) withinCount++;
      }
      rows.push({
        index: j,
        email: rowEmail,
        withinBatch: within,
        isExtraWithin: isExtraWithin,
      });
    }

    return { withinBatch: withinBatch, rows: rows, withinCount: withinCount };
  }

  /** Keep first occurrence per email. */
  function dedupeWithinBatch(contacts, keep) {
    var list = Array.isArray(contacts) ? contacts.slice() : [];
    var mode = keep === "last" ? "last" : "first";
    var seen = {};
    var remove = [];

    if (mode === "first") {
      for (var i = 0; i < list.length; i++) {
        var e = getContactEmail(list[i]);
        if (!e) continue;
        if (seen[e]) {
          remove.push(i);
        } else {
          seen[e] = true;
        }
      }
    } else {
      for (var k = list.length - 1; k >= 0; k--) {
        var e2 = getContactEmail(list[k]);
        if (!e2) continue;
        if (seen[e2]) {
          remove.push(k);
        } else {
          seen[e2] = true;
        }
      }
    }

    return removeIndices(list, remove);
  }

  /** Remove rows whose email is already on Pipeline. */
  function removePipelineOverlaps(contacts, existingEmails) {
    var list = Array.isArray(contacts) ? contacts.slice() : [];
    var analysis = analyzeContacts(list, existingEmails);
    var remove = [];
    analysis.rows.forEach(function (r) {
      if (r.onPipeline) remove.push(r.index);
    });
    return removeIndices(list, remove);
  }

  /** Remove within-batch extras (keep first) + pipeline overlaps. */
  function removeAllFlagged(contacts, existingEmails) {
    var step1 = dedupeWithinBatch(contacts, "first");
    return removePipelineOverlaps(step1, existingEmails);
  }

  function removeIndices(contacts, indicesToRemove) {
    var list = Array.isArray(contacts) ? contacts : [];
    var removeSet = new Set(
      (Array.isArray(indicesToRemove) ? indicesToRemove : []).map(function (n) {
        return Number(n);
      })
    );
    return list.filter(function (_, idx) {
      return !removeSet.has(idx);
    });
  }

  /** Indices to remove: within-batch extras (keep first per email). */
  function indicesWithinBatchExtras(contacts) {
    var analysis = analyzeContacts(contacts, null);
    var remove = [];
    analysis.rows.forEach(function (r) {
      if (r.isExtraWithin) remove.push(r.index);
    });
    return remove;
  }

  /** Indices to remove: any row whose email is on Pipeline. */
  function indicesPipelineOverlaps(contacts, existingEmails) {
    var analysis = analyzeContacts(contacts, existingEmails);
    var remove = [];
    analysis.rows.forEach(function (r) {
      if (r.onPipeline) remove.push(r.index);
    });
    return remove;
  }

  function dedupeQueueItems(items) {
    var list = Array.isArray(items) ? items : [];
    var seen = {};
    var out = [];
    var removed = 0;
    for (var i = 0; i < list.length; i++) {
      var e = getQueueEmail(list[i]);
      var tid = String((list[i] && list[i].targetId) || "").trim();
      var key = e || tid || "row-" + i;
      if (e && seen[e]) {
        removed++;
        continue;
      }
      if (e) seen[e] = true;
      else if (tid && seen["tid:" + tid]) {
        removed++;
        continue;
      } else if (tid) seen["tid:" + tid] = true;
      out.push(list[i]);
    }
    return { items: out, removed: removed };
  }

  function buildExistingEmailSetFromTargets(targets, getEmailFn) {
    var set = new Set();
    var list = Array.isArray(targets) ? targets : [];
    var fn = typeof getEmailFn === "function" ? getEmailFn : getContactEmail;
    list.forEach(function (t) {
      var e = fn(t);
      if (e) set.add(e);
    });
    return set;
  }

  global.TJContactDedupe = {
    normEmail: normEmail,
    getContactEmail: getContactEmail,
    getQueueEmail: getQueueEmail,
    analyzeContacts: analyzeContacts,
    analyzeQueueItems: analyzeQueueItems,
    dedupeWithinBatch: dedupeWithinBatch,
    removePipelineOverlaps: removePipelineOverlaps,
    removeAllFlagged: removeAllFlagged,
    removeIndices: removeIndices,
    indicesWithinBatchExtras: indicesWithinBatchExtras,
    indicesPipelineOverlaps: indicesPipelineOverlaps,
    dedupeQueueItems: dedupeQueueItems,
    buildExistingEmailSetFromTargets: buildExistingEmailSetFromTargets,
  };
})(typeof window !== "undefined" ? window : globalThis);

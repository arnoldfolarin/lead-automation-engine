/**
 * Snapshot fields for touchHistory entries so the Pipeline email log stays accurate
 * even if aiFollowupStages / campaignName change later on the target.
 */

/**
 * @param {object | null | undefined} stage
 */
function stageTimingSummary(stage) {
  if (!stage || typeof stage !== "object") return "";
  const parts = [];
  const days = stage.ifNoReplyAfterDays;
  if (days != null && Number(days) > 0) {
    parts.push("+" + String(days) + " eligible day(s) after prior");
  }
  const dm = stage.delayMinutesAfterPrior;
  if (dm != null && !Number.isNaN(Number(dm)) && Number(dm) > 0) {
    parts.push("+" + String(dm) + " min after prior");
  }
  if (stage.sendAtLocal) {
    parts.push(
      String(stage.sendAtLocal).trim() +
        (stage.sendAtTimeZone ? " " + String(stage.sendAtTimeZone).trim() : "")
    );
  }
  if (stage.ifCondition) {
    parts.push("if " + String(stage.ifCondition));
  }
  return parts.join(" · ").slice(0, 350);
}

/**
 * @param {object} target
 * @param {unknown[]} stages
 */
function maxFollowupStagesFromTarget(target, stages) {
  const arr = Array.isArray(stages) ? stages : [];
  return Math.max(arr.length, parseInt(String(target.maxFollowupStages || arr.length), 10) || arr.length);
}

/**
 * @param {object} target
 */
function campaignNameSnapshot(target) {
  return String((target && (target.campaignName || target.lastCampaignName)) || "")
    .trim()
    .slice(0, 200);
}

/**
 * @param {object} target
 * @param {object | null} stage — stage config used for this send
 * @param {number} followupStageNumber — 1-based follow-up index (matches touch.stage for ai_followup)
 * @param {number} maxStages
 * @param {string | null} nextSequenceSendAtIso — UTC ISO for next worker send after this touch, if any
 */
function followupTouchSnapshot(target, stage, followupStageNumber, maxStages, nextSequenceSendAtIso) {
  const tpl = stage && stage.bodyTemplate != null ? String(stage.bodyTemplate).trim().slice(0, 4000) : "";
  const label = "Follow-up " + String(followupStageNumber) + " of " + String(maxStages);
  return {
    campaignName: campaignNameSnapshot(target),
    followupIndex: followupStageNumber,
    followupOf: maxStages,
    stageLabel: label,
    stageBodyTemplate: tpl,
    stageTimingSummary: stageTimingSummary(stage),
    aiSequenceSendMode: String((target && target.aiSequenceSendMode) || "manual_review").slice(0, 32),
    nextSequenceSendAtIso: nextSequenceSendAtIso || null,
  };
}

/**
 * @param {object} prevTarget
 * @param {string} campaignNameRaw — from kickoff body (may be empty)
 * @param {unknown[]} stages
 * @param {number} maxStages
 * @param {string | null} nextIso
 * @param {string} sendMode
 */
function kickoffTouchSnapshot(prevTarget, campaignNameRaw, stages, maxStages, nextIso, sendMode) {
  const first = Array.isArray(stages) && stages.length ? stages[0] : null;
  const nm = String(campaignNameRaw || campaignNameSnapshot(prevTarget || {})).trim().slice(0, 200);
  let timing = "";
  if (first) {
    timing = "Next queued follow-up: " + stageTimingSummary(first);
  }
  return {
    campaignName: nm,
    followupIndex: null,
    followupOf: maxStages,
    stageLabel: "Kickoff (initial send)",
    stageBodyTemplate: "",
    stageTimingSummary: timing.slice(0, 350),
    aiSequenceSendMode: String(sendMode || "manual_review").slice(0, 32),
    nextSequenceSendAtIso: nextIso || null,
  };
}

module.exports = {
  stageTimingSummary,
  maxFollowupStagesFromTarget,
  campaignNameSnapshot,
  followupTouchSnapshot,
  kickoffTouchSnapshot,
};

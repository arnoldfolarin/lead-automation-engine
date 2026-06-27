/**
 * Scheduled worker: due follow-ups (automatic send or manual-review draft creation).
 */
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const {computeNextStageSendAt, getStageBySequenceIndex} = require("./sequenceSchedule");
const {sendOutreachMail} = require("./emailProvider");
const {buildCalendlyBlocks, nextCalendlyRef, validateCalendlyUrl, senderOptsFromRecord} = require("./emailCalendly");
const {draftAiFollowUp} = require("./sequencePrompts");
const {fillOutreachTemplate} = require("./greetingTemplate");
const {followupTouchSnapshot, maxFollowupStagesFromTarget} = require("./touchSnapshot");

/**
 * @param {unknown} v
 * @returns {string}
 */
function normEmail(v) {
  return String(v || "")
    .trim()
    .toLowerCase();
}

/**
 * @param {FirebaseFirestore.Firestore} db
 */
async function runSequenceWorker(db) {
  const nowTs = admin.firestore.Timestamp.now();
  let snap;
  try {
    snap = await db
      .collectionGroup("targets")
      .where("sequenceStatus", "==", "active")
      .where("nextSequenceSendAt", "<=", nowTs)
      .limit(20)
      .get();
  } catch (e) {
    logger.error("sequence_worker_query_failed", {err: e && e.message ? e.message : e});
    return {processed: 0, error: String(e && e.message ? e.message : e)};
  }

  let processed = 0;
  for (const doc of snap.docs) {
    const pathParts = doc.ref.path.split("/");
    if (pathParts.length < 4 || pathParts[0] !== "tenants" || pathParts[2] !== "targets") {
      continue;
    }
    const tenantId = pathParts[1];
    const targetId = pathParts[3];
    const target = doc.data() || {};
    try {
      await processOneTarget(db, tenantId, targetId, doc.ref, target);
      processed++;
    } catch (e) {
      logger.error("sequence_worker_target_failed", {
        tenantId,
        targetId,
        err: e && e.message ? e.message : e,
      });
    }
  }
  return {processed};
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} tenantId
 * @param {string} targetId
 * @param {FirebaseFirestore.DocumentReference} ref
 * @param {object} target
 */
async function processOneTarget(db, tenantId, targetId, ref, target) {
  if (target.lastReplyAt != null) {
    await ref.update({
      sequenceStatus: "cancelled",
      nextSequenceSendAt: admin.firestore.FieldValue.delete(),
      sequenceWorkerNote: "cancelled: reply detected",
    });
    return;
  }
  if (target.pipelineStatus === "booked") {
    await ref.update({
      sequenceStatus: "cancelled",
      nextSequenceSendAt: admin.firestore.FieldValue.delete(),
      sequenceWorkerNote: "cancelled: meeting booked",
    });
    return;
  }
  if (target.followupsPaused === true) {
    await ref.update({
      sequenceStatus: "cancelled",
      nextSequenceSendAt: admin.firestore.FieldValue.delete(),
      sequenceWorkerNote: "cancelled: manually stopped",
    });
    return;
  }
  const stages = target.aiFollowupStages;
  if (!Array.isArray(stages) || stages.length === 0) {
    await ref.update({
      sequenceStatus: "none",
      nextSequenceSendAt: admin.firestore.FieldValue.delete(),
    });
    return;
  }
  if (!target.aiSequence) {
    await ref.update({
      sequenceStatus: "none",
      nextSequenceSendAt: admin.firestore.FieldValue.delete(),
    });
    return;
  }

  const mode = String(target.aiSequenceSendMode || "manual_review").trim().toLowerCase() === "automatic"
    ? "automatic"
    : "manual_review";
  const nextIdx = Math.max(1, parseInt(String(target.sequenceNextStageIndex || 1), 10) || 1);
  const stage = getStageBySequenceIndex(stages, nextIdx);
  if (!stage) {
    await ref.update({
      sequenceStatus: "complete",
      nextSequenceSendAt: admin.firestore.FieldValue.delete(),
    });
    return;
  }

  const schedule = target.schedule || {};
  const to = normEmail(target.contactEmail || (target.contact && target.contact.email) || "");
  if (!to) {
    logger.warn("sequence_worker_no_email", {tenantId, targetId});
    return;
  }

  if (mode === "manual_review") {
    const pendCol = db.collection("tenants").doc(tenantId).collection("aiSequencePending");
    const existing = await pendCol.where("targetId", "==", targetId).where("status", "==", "pending").limit(1).get();
    if (!existing.empty) {
      return;
    }
    let subject = `Follow-up — ${(target.companyName || "our last note").toString().slice(0, 60)}`;
    let bodyPlain = fillOutreachTemplate(stage.bodyTemplate || "", target, {email: to});
    if (!bodyPlain.trim()) {
      const openaiKey = (process.env.OPENAI_API_KEY || "").trim();
      if (openaiKey) {
        try {
          const OpenAIMod = require("openai");
          const OpenAI = OpenAIMod.default || OpenAIMod;
          const client = new OpenAI({apiKey: openaiKey});
          const ai = await draftAiFollowUp(client, target, nextIdx + 1);
          subject = ai.subject || subject;
          bodyPlain = ai.bodyPlain || bodyPlain;
        } catch (e) {
          logger.warn("openai_manual_draft_failed", {err: e && e.message ? e.message : e});
          bodyPlain = fillOutreachTemplate("{Greeting}\n\nFollowing up on my previous note.", target, {email: to});
        }
      } else {
        bodyPlain = fillOutreachTemplate("{Greeting}\n\nFollowing up on my previous note.", target, {email: to});
      }
    }
    await pendCol.add({
      tenantId,
      targetId,
      stageIndex: nextIdx,
      status: "pending",
      pendingAiDraft: {subject, bodyPlain},
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await ref.update({
      awaitingAiReview: true,
      nextSequenceSendAt: admin.firestore.FieldValue.delete(),
    });
    return;
  }

  let subject = `Re: ${(target.lastKickoffSubject || target.lastEmailSubject || "our conversation").toString().slice(0, 80)}`;
  let bodyPlain = fillOutreachTemplate(stage.bodyTemplate || "", target, {email: to});
  if (!bodyPlain.trim()) {
    const openaiKey = (process.env.OPENAI_API_KEY || "").trim();
    if (openaiKey) {
      try {
        const OpenAIMod = require("openai");
        const OpenAI = OpenAIMod.default || OpenAIMod;
        const client = new OpenAI({apiKey: openaiKey});
        const ai = await draftAiFollowUp(client, target, nextIdx + 1);
        subject = ai.subject || subject;
        bodyPlain = ai.bodyPlain || bodyPlain;
      } catch (e) {
        logger.warn("openai_auto_followup_failed", {err: e && e.message ? e.message : e});
        bodyPlain = fillOutreachTemplate("{Greeting}\n\nCircling back briefly.", target, {email: to});
      }
    } else {
      bodyPlain = fillOutreachTemplate("{Greeting}\n\nCircling back briefly.", target, {email: to});
    }
  }

  const calendlyLinkRaw = String(target.calendlyLink || "").trim();
  const calendlyLink = validateCalendlyUrl(calendlyLinkRaw) || "";
  const calendlyRef = nextCalendlyRef(target.calendlyRef, !!calendlyLink);
  const senderOpts = senderOptsFromRecord(target);
  const {text: sentText, html: sentHtml} = buildCalendlyBlocks(bodyPlain, calendlyLink, calendlyRef, senderOpts);

  const sentAt = new Date().toISOString();
  await sendOutreachMail({
    to,
    subject,
    text: sentText,
    html: sentHtml,
    targetId,
    fromName: senderOpts.senderName,
  });

  const maxStages = maxFollowupStagesFromTarget(target, stages);
  const afterIdx = nextIdx + 1;
  const nextStage = getStageBySequenceIndex(stages, afterIdx);
  const anchorIso = sentAt;
  let nextSend = null;
  let status = "complete";
  let nextSequenceSendAtIso = null;
  if (nextStage && afterIdx <= maxStages) {
    const nextIso = computeNextStageSendAt(anchorIso, nextStage, schedule);
    nextSequenceSendAtIso = nextIso;
    nextSend = admin.firestore.Timestamp.fromDate(new Date(nextIso));
    status = "active";
  }

  const touch = Object.assign(
    {
      kind: "ai_followup",
      stage: nextIdx,
      subject,
      bodyPlain: sentText,
      sentAt,
    },
    followupTouchSnapshot(target, stage, nextIdx, maxStages, nextSequenceSendAtIso)
  );
  const prevHist = Array.isArray(target.touchHistory) ? target.touchHistory.slice() : [];
  prevHist.push(touch);

  const workerUpdate = {
    touchHistory: prevHist,
    lastEmailSubject: subject,
    lastEmailSentAt: sentAt,
    sequenceNextStageIndex: afterIdx,
    sequenceStatus: status,
    nextSequenceSendAt: nextSend || admin.firestore.FieldValue.delete(),
    awaitingAiReview: false,
    pipelineStatus: "waiting_on_them",
  };
  if (calendlyRef && calendlyRef !== target.calendlyRef) {
    workerUpdate.calendlyRef = calendlyRef;
  }
  await ref.update(workerUpdate);
}

module.exports = {runSequenceWorker, processOneTarget};

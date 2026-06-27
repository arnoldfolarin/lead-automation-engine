/**
 * Meta Lead Ads webhook routes. No API keys in this file — they are used inside:
 * - meta.js (META_WEBHOOK_VERIFY_TOKEN, META_PAGE_ACCESS_TOKEN)
 * - firestore.js (Firebase credentials from config)
 * - openai.js (OPENAI_API_KEY)
 * - twilio.js (Twilio credentials + SEND_MESSAGES_ENABLED)
 *
 * GET /v1/ingest/meta/webhook — Meta verification (return hub.challenge)
 * POST /v1/ingest/meta/webhook — New lead: fetch → normalize → Firestore → OpenAI → Twilio dry-run/send → events
 */

import express from "express";
import {
  verifyMetaWebhook,
  extractMetaLeadgenId,
  getNormalizedLeadFromMeta,
} from "../services/meta.js";
import {
  upsertLead,
  addEvent,
  hasSmsEvent,
} from "../services/firestore.js";
import { buildLeadIdFromMeta } from "../models/lead.js";
import { craftSms } from "../services/openai.js";
import { sendSmsDryRunOrReal } from "../services/twilio.js";
import { config } from "../config/env.js";

export const metaRouter = express.Router();

metaRouter.get("/ingest/meta/webhook", (req, res) => {
  const result = verifyMetaWebhook(req);
  if (result.ok) {
    return res.status(200).send(result.challenge);
  }
  return res.sendStatus(403);
});

metaRouter.post("/ingest/meta/webhook", async (req, res) => {
  try {
    const leadgenId = extractMetaLeadgenId(req.body);
    if (!leadgenId) {
      return res.sendStatus(400);
    }

    const leadEnvelope = await getNormalizedLeadFromMeta(leadgenId);
    const leadId = buildLeadIdFromMeta(leadgenId);

    await upsertLead(config.runtime.tenantId, leadId, {
      contact: leadEnvelope.contact,
      source: leadEnvelope.source,
      status: "new",
    });

    await addEvent(config.runtime.tenantId, leadId, {
      type: "lead_ingested",
      channel: null,
      providerIds: { providerLeadId: leadgenId },
      metadata: {},
    });

    const alreadySent = await hasSmsEvent(config.runtime.tenantId, leadId);
    if (alreadySent) {
      return res.sendStatus(200);
    }

    const smsText = await craftSms(leadEnvelope);
    const result = await sendSmsDryRunOrReal(
      leadEnvelope.contact.phone || "",
      smsText
    );

    const eventType = result.dryRun ? "sms_dry_run" : "sms_sent";

    await addEvent(config.runtime.tenantId, leadId, {
      type: eventType,
      channel: "sms",
      providerIds: {
        providerLeadId: leadgenId,
        messageSid: result.sid || null,
      },
      metadata: { draftedText: smsText, dryRun: !!result.dryRun },
    });

    await upsertLead(config.runtime.tenantId, leadId, {
      status: "contacted",
      lastTouchAt: new Date().toISOString(),
    });

    return res.sendStatus(200);
  } catch (err) {
    console.error("Meta webhook error:", err);
    return res.sendStatus(500);
  }
});

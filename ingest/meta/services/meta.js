/**
 * Meta (Facebook) Lead Ads integration. Uses config.meta from env:
 * - META_WEBHOOK_VERIFY_TOKEN: compared to hub.verify_token when Meta verifies the webhook
 * - META_PAGE_ACCESS_TOKEN: sent as access_token when calling Graph API to fetch lead details
 *
 * API used: GET https://graph.facebook.com/v19.0/{LEAD_ID}?access_token=PAGE_ACCESS_TOKEN
 */

import axios from "axios";
import { config } from "../config/env.js";
import { normalizeMetaLead } from "../models/lead.js";

/** Verify Meta webhook subscription (GET with hub.mode, hub.verify_token, hub.challenge). */
export function verifyMetaWebhook(req) {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === config.meta.verifyToken) {
    return { ok: true, challenge };
  }
  return { ok: false };
}

/** Extract leadgen_id from POST body (Meta sends entry[0].changes[0].value.leadgen_id). */
export function extractMetaLeadgenId(reqBody) {
  try {
    const entry = reqBody.entry?.[0];
    const change = entry?.changes?.[0];
    return change?.value?.leadgen_id || null;
  } catch {
    return null;
  }
}

/**
 * Fetch full lead details from Meta Graph API.
 * Token: config.meta.pageAccessToken (env: META_PAGE_ACCESS_TOKEN)
 */
export async function fetchMetaLeadDetails(leadgenId) {
  const url = `https://graph.facebook.com/v19.0/${leadgenId}`;
  const res = await axios.get(url, {
    params: {
      access_token: config.meta.pageAccessToken,
    },
  });
  return res.data;
}

/** Fetch from Meta API then normalize to LeadEnvelope. */
export async function getNormalizedLeadFromMeta(leadgenId) {
  const raw = await fetchMetaLeadDetails(leadgenId);
  return normalizeMetaLead(raw);
}

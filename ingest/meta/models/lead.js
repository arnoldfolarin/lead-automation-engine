/**
 * Lead model: normalizes external payloads (e.g. Meta Graph API response) into
 * our internal LeadEnvelope shape. No API keys here — just data shaping.
 * Tenant id comes from config.runtime.tenantId (env: TENANT_ID).
 */

import { config } from "../config/env.js";

/** Firestore document id for a Meta lead (used in tenants/{tenantId}/leads/{leadId}). */
export function buildLeadIdFromMeta(leadgenId) {
  return `meta_${leadgenId}`;
}

/**
 * Normalize Meta Graph API lead response into LeadEnvelope-like object.
 * Meta API returns: id, created_time, field_data[], form_id, etc.
 */
export function normalizeMetaLead(metaLeadResponse) {
  const { id, created_time, field_data = [] } = metaLeadResponse;

  let name = "";
  let email = "";
  let phone = "";
  const answers = [];

  for (const field of field_data) {
    const key = field.name || field.question_key;
    const value = (field.values && field.values[0]) || "";
    if (!key) continue;

    if (!name && key.toLowerCase().includes("name")) name = value;
    if (!email && key.toLowerCase().includes("email")) email = value;
    if (!phone && key.toLowerCase().includes("phone")) phone = value;

    answers.push({ key, value });
  }

  return {
    tenantId: config.runtime.tenantId,
    source: {
      provider: "meta",
      providerLeadId: id,
      campaignId: undefined,
      adId: undefined,
      formId: metaLeadResponse.form_id,
      raw: metaLeadResponse,
    },
    contact: {
      name,
      phone,
      email,
    },
    answers,
    createdAt: created_time ? Date.parse(created_time) : Date.now(),
  };
}

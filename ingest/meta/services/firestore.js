/**
 * Firestore client and helpers. Uses config.firebase (projectId, clientEmail, privateKey)
 * from src/config/env.js — those come from .env: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY.
 *
 * Writes:
 * - tenants/{tenantId}/leads/{leadId}  (lead document)
 * - tenants/{tenantId}/leads/{leadId}/events/{eventId}  (immutable event log)
 */

import admin from "firebase-admin";
import { config } from "../config/env.js";

let app;
if (!admin.apps.length) {
  app = admin.initializeApp({
    credential: admin.credential.cert({
      projectId: config.firebase.projectId,
      clientEmail: config.firebase.clientEmail,
      privateKey: config.firebase.privateKey,
    }),
  });
} else {
  app = admin.app();
}

const db = admin.firestore();

export function leadsCollectionRef(tenantId) {
  return db.collection("tenants").doc(tenantId).collection("leads");
}

export async function upsertLead(tenantId, leadId, leadDoc) {
  const ref = leadsCollectionRef(tenantId).doc(leadId);
  await ref.set(
    {
      ...leadDoc,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt:
        leadDoc.createdAt || admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return ref;
}

export async function addEvent(tenantId, leadId, event) {
  const eventsRef = leadsCollectionRef(tenantId)
    .doc(leadId)
    .collection("events");
  await eventsRef.add({
    ...event,
    ts: admin.firestore.FieldValue.serverTimestamp(),
  });
}

/** Returns true if we already have an sms_dry_run or sms_sent event (idempotency). */
export async function hasSmsEvent(tenantId, leadId) {
  const eventsRef = leadsCollectionRef(tenantId)
    .doc(leadId)
    .collection("events");

  const snap = await eventsRef
    .where("type", "in", ["sms_dry_run", "sms_sent"])
    .limit(1)
    .get();

  return !snap.empty;
}

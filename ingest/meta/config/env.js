/**
 * Loads and validates environment variables. All API keys and tokens should
 * be read from process.env (set via .env file or host config); this module
 * is the single place that reads them and exposes config to the rest of the app.
 *
 * Where each value is used:
 * - firebase.* → src/services/firestore.js (Firestore client init)
 * - meta.*     → src/services/meta.js (webhook verify + Graph API calls)
 * - openai.*   → src/services/openai.js (OpenAI API for SMS draft)
 * - twilio.*   → src/services/twilio.js (Twilio REST API for SMS)
 * - runtime.*  → src/routes/metaWebhook.js, src/index.js
 */

import dotenv from "dotenv";

dotenv.config();

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const config = {
  // Used by Firestore Admin SDK to connect to your Firebase project
  firebase: {
    projectId: requireEnv("FIREBASE_PROJECT_ID"),
    clientEmail: requireEnv("FIREBASE_CLIENT_EMAIL"),
    // Private key often has \n in .env; replace so it's a real newline
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  },

  // Meta: verify token is sent by Meta when you click "Verify" in webhook settings
  // pageAccessToken is used in Meta Graph API request to fetch lead details
  meta: {
    verifyToken: requireEnv("META_WEBHOOK_VERIFY_TOKEN"),
    pageAccessToken: requireEnv("META_PAGE_ACCESS_TOKEN"),
  },

  // OpenAI: API key is sent in Authorization header for chat completions (SMS draft)
  openai: {
    apiKey: requireEnv("OPENAI_API_KEY"),
  },

  // Twilio: Account SID + Auth Token used for REST API auth; fromNumber is the "from" for SMS
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || "",
    authToken: process.env.TWILIO_AUTH_TOKEN || "",
    fromNumber: process.env.TWILIO_PHONE_NUMBER || "",
  },

  // Runtime: sendMessagesEnabled gates real Twilio send (false = dry-run only)
  runtime: {
    sendMessagesEnabled: process.env.SEND_MESSAGES_ENABLED === "true",
    port: Number(process.env.PORT || 3000),
    tenantId: process.env.TENANT_ID || "default",
  },
};

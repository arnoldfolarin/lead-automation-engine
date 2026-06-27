# Lead Automation Engine — Implementation Checklist

**What you’re building:** A **backend application** (Node.js API service) that runs on a server or in the cloud. It exposes webhook URLs for Meta (and later LinkedIn); when a lead comes in, it saves to Firestore, drafts messages with OpenAI, and logs or sends via Twilio. It is not a website or browser extension.

For a **full list of deliverables** (every file and what it does), see **[HANDOFF.md](./HANDOFF.md)**.

The **full design** (multi-tenant, multi-arm, Calendly, WhatsApp, AI caller) is in [ARCHITECTURE.md](./ARCHITECTURE.md). Build **V1 simple** (Meta + LinkedIn, Firestore, OpenAI, Twilio + LinkedIn API) using the same shapes and patterns so expansion is easy.

---

## V1 — What you’re building now

- **Intake:** Meta Lead Ads (webhook) + LinkedIn (periodic sweep).
- **Storage:** Firestore under `tenants/{tenantId}/leads` (single tenant OK: `tenantId = "default"`).
- **AI:** One OpenAI “craft message” function for all outbound text.
- **Outbound:** Twilio SMS for Meta leads; LinkedIn API for LinkedIn leads. LinkedIn: max 5 messages per lead.
- **No** Calendly, WhatsApp, or voice yet — add later.

---

## 1. Project setup & architecture alignment

<!-- What this should be: A single Node (JS or TS) app; src/ holds config, services, models, routes; package.json and .env.example exist; no secrets in code. -->

- [ ] **1.1** Choose runtime: **Node.js** (this repo uses plain JS; TypeScript optional later).
- [ ] **1.2** Create repo structure (see [ARCHITECTURE.md](./ARCHITECTURE.md) §7):
  - `api/` or `src/`: `ingest/meta`, `ingest/linkedin`, `webhooks/` (stub if needed).
  - `shared/` or `lib/`: `firestore`, `models` (LeadEnvelope + Lead doc type), `channels/twilio`, `channels/linkedin`, `openai/craftMessage`.
  - Optional: `worker/` for scheduled steps (or in-process scheduler for V1).
- [ ] **1.3** Define **LeadEnvelope** and **Lead** doc type (contact, source, status, messageCount, lastTouchAt, etc.) — see ARCHITECTURE §1 and §2.
- [ ] **1.4** Add `package.json` with dependencies (express/fastify, firebase-admin, twilio, openai, etc.); pin versions.
- [ ] **1.5** Add `.env.example` and use env vars for every key; never commit `.env`.
- [ ] **1.6** README: how to run, env vars, and “how to add a new hook/channel” (point to ARCHITECTURE).

---

## 2. Firebase / Firestore

<!-- What this should be: Firestore holds tenants/{tenantId}/leads/{leadId} and .../events. Credentials go in .env (see .env.example). Backend uses them in src/services/firestore.js. -->

- [ ] **2.1** Create or use existing Firebase project; enable Firestore; set security rules (restrictive).
- [ ] **2.2** Get credentials: **service account JSON** — use FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY in .env (or path via GOOGLE_APPLICATION_CREDENTIALS).
- [ ] **2.3** Firebase Admin SDK is in `src/services/firestore.js`; it reads config from `src/config/env.js`.
- [ ] **2.4** Use **multi-tenant paths**: `tenants/{tenantId}/leads/{leadId}` and `.../leads/{leadId}/events/{eventId}`. V1: single tenant (e.g. `default`).
- [ ] **2.5** Implement: create lead from LeadEnvelope, get by id, update (messageCount, lastTouchAt, status); write events (lead_ingested, sms_sent, linkedin_sent).
- [ ] **2.6** Implement query for LinkedIn sweep: leads where `source.provider === "linkedin"`, `messageCount < 5`, and e.g. `lastTouchAt` older than N days (or no lastTouchAt).

---

## 3. Ingestion (multi-arm adapters)

### 3.1 Meta Lead Ads

<!-- What this should be: META_WEBHOOK_VERIFY_TOKEN and META_PAGE_ACCESS_TOKEN in .env. GET returns hub.challenge when token matches; POST parses leadgen_id, fetches lead via Graph API (using page token), writes to Firestore, then OpenAI + Twilio. See src/routes/metaWebhook.js and src/services/meta.js. -->

- [ ] **3.1.1** Get Meta credentials — **META_WEBHOOK_VERIFY_TOKEN** (you choose; same in Meta dashboard), **META_PAGE_ACCESS_TOKEN** (Graph API lead fetch). Put both in .env.
- [ ] **3.1.2** **GET** `/v1/ingest/meta/webhook`: implemented in `src/routes/metaWebhook.js`; uses `src/services/meta.js` (verifyMetaWebhook) and returns challenge when token matches.
- [ ] **3.1.3** Implement **POST** `/v1/ingest/meta/webhook`: parse `entry[0].changes[0].value.leadgen_id` (and page_id/form_id if present).
- [ ] **3.1.4** **Fetch full lead details** via Meta Graph API: `GET https://graph.facebook.com/v19.0/{LEAD_ID}?access_token=PAGE_ACCESS_TOKEN` → name, email, phone, custom answers.
- [ ] **3.1.5** Resolve tenant (V1: use default); **normalize** to LeadEnvelope (`provider: "meta"`, contact, answers, createdAt).
- [ ] **3.1.6** Write lead to Firestore (idempotency: use `providerLeadId` or form_id+lead_id so same lead isn’t duplicated); write `lead_ingested` event.
- [ ] **3.1.7** Trigger “new lead” flow: call OpenAI craft message → send via Twilio → update lead + write `sms_sent` event.

### 3.2 LinkedIn (periodic sweep)

- [ ] **3.2.1** Get LinkedIn API access — **ask for: Client ID, Client Secret, long-lived Access Token (OAuth 2.0).**
- [ ] **3.2.2** Implement **sweep job** (cron or in-process scheduler, e.g. every 6–24 hours): call LinkedIn API to fetch recent conversations/messages.
- [ ] **3.2.3** For each conversation: map to LeadEnvelope (`provider: "linkedin"`, contact from profile/message); create or update lead in Firestore; ensure `messageCount` and `lastTouchAt` are correct.
- [ ] **3.2.4** Filter leads to message: `source.provider === "linkedin"`, `messageCount < 5`, and last contact was N+ days ago (or similar rule).
- [ ] **3.2.5** For each qualified lead: call OpenAI to craft reply → send via LinkedIn API → update lead (increment messageCount, set lastTouchAt), write event. **Enforce 5-message cap** in code (skip if messageCount ≥ 5).

---

## 4. OpenAI integration

<!-- What this should be: OPENAI_API_KEY in .env; used in src/services/openai.js (craftSms). No other OpenAI config needed for Day 1. -->

- [ ] **4.1** Get **OpenAI API key** from platform.openai.com; put in .env as OPENAI_API_KEY.
- [ ] **4.2** OpenAI SDK is in `src/services/openai.js`; key is read via `src/config/env.js`.
- [ ] **4.3** Implement **one** “craft message” function in `shared/openai/craftMessage.ts`: input = lead (contact, source, optional previous messages), output = single reply text. Use a short system prompt (e.g. professional, concise, SMS-friendly length).
- [ ] **4.4** Use this for both Meta (first SMS) and LinkedIn (follow-up messages); support context like “first touch” vs “follow-up” and source so tone can adapt.
- [ ] **4.5** Error handling: log failures; don’t block pipeline (e.g. skip send or use fallback text).

---

## 5. Outbound channels

### 5.1 Twilio (Meta leads)

<!-- What this should be: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER in .env. src/services/twilio.js uses them; when SEND_MESSAGES_ENABLED=false it does not call Twilio (dry-run). -->

- [ ] **5.1.1** Get Twilio credentials — Account SID, Auth Token, phone number; put in .env as TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER.
- [ ] **5.1.2** Send/dry-run is in `src/services/twilio.js` (sendSmsDryRunOrReal); route calls it from `src/routes/metaWebhook.js`.
- [ ] **5.1.3** After Meta lead ingest: craft message with OpenAI → send via Twilio → update lead + write `sms_sent` event.

### 5.2 LinkedIn API (LinkedIn leads)

- [ ] **5.2.1** Use same LinkedIn credentials as 3.2.1.
- [ ] **5.2.2** Implement send message in `shared/channels/linkedin.ts`: send to conversation/recipient URN; return success/failure.
- [ ] **5.2.3** In sweep: for qualified leads, craft message → send via LinkedIn → update lead + write event; enforce messageCount ≤ 5.

---

## 6. Orchestration & safety

- [ ] **6.1** Meta path: Webhook → verify/fetch → normalize → write lead + event → OpenAI → Twilio → update lead. **Idempotent** by provider lead id.
- [ ] **6.2** LinkedIn path: Sweep → fetch conversations → create/update leads → filter (messageCount < 5, follow-up timing) → OpenAI → LinkedIn send → update lead.
- [ ] **6.3** Enforce **5-message limit** for LinkedIn in code (no send if messageCount ≥ 5).
- [ ] **6.4** Minimal logging: lead received, message sent, sweep ran, errors.
- [ ] **6.5** (Optional) Dry run: env var to disable actual sends (e.g. `SEND_MESSAGES_ENABLED=false`).

---

## 7. Extensibility (for future hooks & dashboard)

- [ ] **7.1** New intake arm = new adapter under `ingest/`: verify → parse → fetch (if needed) → normalize to LeadEnvelope → write lead + event → start workflow. See ARCHITECTURE §3.
- [ ] **7.2** New channel = new module under `channels/` with send(lead, messageText); orchestration picks by `lead.source.provider` or tenant config.
- [ ] **7.3** Keep “craft message” in one place (OpenAI module); prompt/model changes there only.
- [ ] **7.4** Document in README: “To add a new hook…” and “To add a new channel…” (and point to ARCHITECTURE).

---

## Credentials summary (where each goes)

| Item | Used for | Where it goes in code / .env |
|------|----------|------|
| Firebase (projectId, clientEmail, privateKey or JSON path) | Firestore read/write | .env → config.firebase → src/services/firestore.js |
| Meta: META_WEBHOOK_VERIFY_TOKEN, META_PAGE_ACCESS_TOKEN | Webhook verify + Graph API lead fetch | .env → config.meta → src/services/meta.js |
| LinkedIn (for later) | Sweep + send | .env (LINKEDIN_*); not used in Day 1 code yet |
| OPENAI_API_KEY | SMS draft | .env → config.openai → src/services/openai.js |
| Twilio: SID, Auth Token, TWILIO_PHONE_NUMBER | SMS send (or dry-run) | .env → config.twilio → src/services/twilio.js |

**What each should be:** Firebase = service account from Firebase Console. Meta verify token = any string you type in Meta webhook form; Page token = token with leadgen permission for Graph API. OpenAI = API key from platform.openai.com. Twilio = from Twilio console (Account SID, Auth Token, one phone number). Set SEND_MESSAGES_ENABLED=false for Day 1 dry-run.

**Future (optional, when you expand):** Calendly signing secret + scheduling link; SendGrid (email); ElevenLabs API key (voice).

---

## Suggested order of implementation

1. **Project + Firestore** (§1, §2) — repo layout, LeadEnvelope/Lead types, Firestore paths, create/update/query + events.
2. **OpenAI + Twilio** (§4, §5.1) — craft message + send SMS; test with a script or stub lead.
3. **Meta ingestion** (§3.1) — webhook verify + fetch lead + normalize → write lead → OpenAI → Twilio → update lead.
4. **LinkedIn** (§3.2, §5.2) — sweep job, create/update leads, filter, OpenAI → LinkedIn send, 5-message cap.
5. **Orchestration & safety** (§6), then **extensibility docs** (§7).

---

## Future expansion (after V1)

- [ ] Calendly webhook: on booking → set `status = booked`, stop follow-ups.
- [ ] Reminders: 24h and 1h before appointment (Cloud Tasks or cron).
- [ ] WhatsApp via Twilio; email via SendGrid.
- [ ] AI voice caller (Twilio Voice + ElevenLabs); structured call blocks first.
- [ ] Multi-tenant config: per-tenant Twilio/Calendly/scripts in Firestore.
- [ ] Web dashboard: review leads, performance, analytics (query existing Firestore collections).

These are not part of the “very simple version”; add them when the team is ready to expand.

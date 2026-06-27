# Tech Jump LeadOps — Day 1 Handoff

**What this is:** A **backend application** (Node.js API service) that runs on a server or in the cloud. It is **not** a website you open in a browser, and it is **not** a browser extension or desktop app. When someone submits a Facebook Lead Form, Meta sends an HTTP request (webhook) to your service’s URL; the backend then saves the lead to Firestore, drafts an SMS with OpenAI, and logs the action (dry-run: no real text sent). Clinic web apps read the results from Firestore.

This document is the **single reference** for: what the app is, the full list of deliverables (files and what they do), what you need to run it, and how to test it.

---

## 1. What Runs Where (Simple Terms)

| Thing | What it is |
|-------|------------|
| **This project** | A Node.js application (backend service). |
| **How it runs** | Someone runs `npm install` then `npm start` (or deploys it to Cloud Run / Vercel / similar). It listens on a port (e.g. 3000) and responds to HTTP requests. |
| **Webhook** | A public URL (e.g. `https://your-service.com/v1/ingest/meta/webhook`) that Meta calls when a new lead is submitted. Your service receives that call and processes the lead. |
| **Not** | Not a “web file” you open in Chrome, not an extension, not a desktop app. It’s a server that stays running and waits for Meta to send leads. |

---

## 2. Deliverables (Files You Have)

All of these live in the project folder. Together they form the Day 1 MVP.

| File | Purpose |
|------|--------|
| `package.json` | Declares Node.js dependencies (Express, Firebase, OpenAI, Twilio, etc.) and scripts (`npm start`, `npm run dev`). |
| `.env.example` | Template listing every environment variable the app needs. Copy to `.env` and fill in real values; never commit `.env`. |
| `src/index.js` | Entry point: starts the Express server and mounts routes. |
| `src/config/env.js` | Loads and validates environment variables so the rest of the app can use them safely. |
| `src/services/firestore.js` | Firestore client and helpers: create/update leads, append events, check if SMS was already sent (idempotency). |
| `src/services/meta.js` | Meta webhook verification and fetching full lead details from the Meta Graph API. |
| `src/services/openai.js` | Calls OpenAI to generate a short SMS message from the lead’s contact info and context. |
| `src/services/twilio.js` | Twilio integration: when `SEND_MESSAGES_ENABLED=true` it sends SMS; when `false` it only “dry-runs” (no real send, but we still log the event). |
| `src/models/lead.js` | Defines how we normalize a Meta lead into our internal “LeadEnvelope” shape (same shape we’ll use later for LinkedIn, web forms, etc.). |
| `src/routes/metaWebhook.js` | Handles `GET /v1/ingest/meta/webhook` (Meta verification) and `POST /v1/ingest/meta/webhook` (receive lead → save → draft SMS → log dry-run). |

**Optional for handoff:** A short `README.md` in the repo that points to this file and says “See HANDOFF.md for setup and testing.”

---

## 3. What You Need to Run It (Accounts & Keys)

Your boss or the person deploying must have:

- **Firebase** — A Firebase project with Firestore enabled, and a service account JSON (or equivalent) so the Node app can read/write Firestore.
- **Meta (Facebook)** — A Meta Developer app, a Page running Lead Ads, webhook subscribed to “leadgen,” plus:
  - `META_WEBHOOK_VERIFY_TOKEN` (a secret string you choose)
  - `META_PAGE_ACCESS_TOKEN` (used to fetch lead details from the Graph API)
- **OpenAI** — An API key: `OPENAI_API_KEY`.
- **Twilio** — Account SID, Auth Token, and a phone number (for later real sends; Day 1 uses dry-run).
- **Runtime** — A place to run Node (your machine for local testing, or a host like Google Cloud Run, Vercel, etc.).

For Day 1 testing, set `SEND_MESSAGES_ENABLED=false` so no real SMS is sent.

**Where APIs and tokens go:** All secrets are in `.env` (see `.env.example` for names and comments). The code reads them only in `src/config/env.js`, which exposes `config` to the rest of the app. Firebase credentials are used in `src/services/firestore.js`; Meta tokens in `src/services/meta.js`; OpenAI key in `src/services/openai.js`; Twilio credentials in `src/services/twilio.js`. Each of those files has a short comment at the top saying which env vars it uses.

---

## 4. How to Run It Locally

1. Open a terminal in the project folder.
2. Copy env: `cp .env.example .env` (or copy by hand).
3. Fill `.env` with real values (Firebase, Meta, OpenAI, Twilio, and `SEND_MESSAGES_ENABLED=false`).
4. Install dependencies: `npm install`.
5. Start the server: `npm start` (or `npm run dev` if you added a dev script).
6. The server listens on the port in `.env` (e.g. 3000). Meta cannot reach `localhost`, so for Meta verification and real leads you must deploy to a public URL (see below).

---

## 5. How to Run It So Meta Can Reach It (Deploy)

Meta needs to call a **public URL**. Options:

- **Google Cloud Run** — Deploy the same Node app as a container; Cloud Run gives you a URL like `https://your-service-xxx.run.app`. Set the Meta webhook URL to `https://your-service-xxx.run.app/v1/ingest/meta/webhook`.
- **Vercel** — Deploy as a serverless function; Vercel gives you a URL. Point Meta to `https://your-project.vercel.app/v1/ingest/meta/webhook` (path may vary by how you mount the routes).
- **Any other host** — As long as the Node app is running and the routes `GET /v1/ingest/meta/webhook` and `POST /v1/ingest/meta/webhook` are available on HTTPS, Meta can use it.

After deploy, set the same environment variables in the host’s configuration (e.g. Cloud Run env vars, Vercel env vars).

---

## 6. How to Test That Day 1 Works

Use these three checks. Whoever has the Meta/Firebase/Twilio access should run them.

1. **Webhook verification**  
   In the Meta Developer dashboard, set the webhook URL to your deployed `GET /v1/ingest/meta/webhook` and the verify token to `META_WEBHOOK_VERIFY_TOKEN`. Click “Verify and Save.”  
   **Success:** Meta shows the webhook as verified.

2. **One lead end-to-end (dry-run)**  
   Submit one test lead using Meta’s Lead Form test tool.  
   **Success:** In Firestore you see a new document under `tenants/default/leads/...` with the lead’s contact info and source, and under that lead’s `events` subcollection you see at least `lead_ingested` and `sms_dry_run` (with the drafted SMS text in metadata). No real SMS is sent because `SEND_MESSAGES_ENABLED=false`.

3. **Duplicate / retry safety**  
   Send the same webhook POST body again (or trigger a retry).  
   **Success:** Only one `sms_dry_run` (or `sms_sent`) event exists for that lead; no second SMS is sent or logged.

---

## 7. Handoff Summary for Your Boss

- **What was built:** A small Node.js backend that receives Meta Lead Form webhooks, normalizes leads into a single internal format, stores them in Firestore, uses OpenAI to draft the first SMS, and logs a Twilio “send” as a dry-run so we can prove the pipeline without sending real texts.
- **What they need to provide:** Firebase project + credentials, Meta app + Page + webhook token and Page access token, OpenAI API key, Twilio account and number, and a place to run the Node app (e.g. Cloud Run or Vercel).
- **What “professional” means here:** The service is designed so that later you can add more “arms” (e.g. LinkedIn, web forms), keep the same workflow, and plug results into clinic web apps via Firestore. This MD file is the single place that describes the deliverables, how to run the service, and how to test it.

If you want, the repo can also include a one-line `README.md` that says: “Tech Jump LeadOps Day 1 — see HANDOFF.md for setup, run, and test instructions.”

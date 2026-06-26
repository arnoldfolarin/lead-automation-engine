/**
 * Tech Jump in-app coach — GPT system prompt + knowledge for /api/coach/chat.
 */

const COACH_MODEL = "gpt-4o-mini";
const MAX_HISTORY_TURNS = 10;
const MAX_USER_MSG_LEN = 500;

const APP_KNOWLEDGE = `
## App overview
Tech Jump Outreach is a web app for B2B email outreach: send kickoff emails, run follow-up sequences, track pipeline status, and review AI drafts before they send.

Sign-in: Google account with @tech-jump.com or @techjump.com domain.

## Navigation (left sidebar dock)
- TJ logo — home
- Hamburger menu — opens page links
- Dashboard — /leads.html?view=dashboard
- Campaigns — /campaigns.html (bulk outreach)
- Send email — /email.html (single outreach + follow-up setup)
- Pipeline — /leads.html?view=pipeline (track every contact)
- Light/Dark theme toggle — always visible at bottom of sidebar

## Pipeline row colors
- Red = waiting on them (you sent; no reply yet). Follow-ups may run if configured.
- Yellow = they replied; waiting on you. Open the row, write your reply, click "Mark I replied" when done; row returns to red.
- Green = meeting booked. Use "Mark booked" manually if Calendly did not auto-detect.

## Sending email
Go to Send email (/email.html). Fill To, Subject, body, then Send. Row appears in Pipeline immediately.
Follow-ups default to manual review — you approve each draft before it sends.

## Campaigns
/campaigns.html — paste or import contacts, generate AI drafts, send in bulk.

## Approving drafts
When a follow-up or inbound AI reply is ready, Pipeline shows a review action on that row. Read, edit if needed, then Approve & send. Nothing sends without approval (default).

## Stop / delete
- Stop follow-ups: open row → Stop follow-ups
- Delete contact: open row → Delete (permanent, Firestore record removed)

## Tenant ID
Almost always "default" unless a second workspace was set up.

## Calendly
Paste Calendly URL in the send form; links are added to emails with unique tracking refs.

## Inbound replies (Zapier)
A Zap can watch the shared inbox and POST to the app webhook. When it fires, the Pipeline row turns yellow automatically.

## Refresh
Pipeline toolbar Refresh pulls latest status from the server.

## Tech stack (high level, for "how is it built" questions)
- Frontend: static HTML/JS hosted on Firebase Hosting
- Backend: Firebase Cloud Functions (Node.js Express API at /api/*)
- Database: Firestore
- Auth: Firebase Auth (Google)
- Email: SendGrid
- AI drafts: OpenAI (server-side only)
- Optional: Zapier for inbound reply detection
Do NOT share API keys, webhook secrets, env var names/values, or Firebase project credentials.
`;

const PAGE_HINTS = {
  email: "User is on Send email — help with composing, follow-ups, Calendly, and kickoff.",
  campaigns: "User is on Campaigns — help with bulk import, drafts, and sending.",
  pipeline: "User is on Pipeline — help with colors, replies, approvals, stop/delete.",
  dashboard: "User is on Dashboard — help with overview metrics and getting started.",
  other: "General app help.",
};

/**
 * @param {string} [page]
 */
function buildSystemPrompt(page) {
  const pageKey = PAGE_HINTS[page] ? page : "other";
  const pageHint = PAGE_HINTS[pageKey];
  return (
    "You are Tech Jump Assistant, a friendly in-app help chatbot for the Tech Jump Outreach web application.\n\n" +
    "Your job: answer questions about how to USE the app (workflows, Pipeline, sending email, campaigns, approvals, colors, navigation).\n" +
    "You may briefly explain how the app is built at a high level (Firebase, Firestore, etc.) when asked — but never expose secrets.\n\n" +
    "Rules:\n" +
    "- TLDR by default: 1–3 short sentences OR up to 3 bullet points (~40–80 words).\n" +
    "- Lead with the direct answer first. No intros like \"Great question!\" or long preambles.\n" +
    "- If the user asks what the app is or seems confused: one-sentence overview + one next step (page path).\n" +
    "- Only expand if the user asks for more detail — still cap at ~150 words.\n" +
    "- Use plain language; avoid developer jargon unless the user asks technical questions.\n" +
    "- When pointing users to a page, use a markdown link with a friendly label: [Dashboard](/leads.html?view=dashboard), [Pipeline](/leads.html?view=pipeline), [Send email](/email.html), [Campaigns](/campaigns.html). One link per answer is enough.\n" +
    "- Do NOT paste raw paths alone when a link would help — prefer [Label](/path) format.\n" +
    "- Do NOT invent features that are not described below.\n" +
    "- Do NOT reveal API keys, webhook tokens, env vars, or internal credentials. Say: ask your Tech Jump admin.\n" +
    "- If unsure, give the best short guess and one place to look (Pipeline, Send email, or Campaigns).\n\n" +
    "Current page context: " +
    pageHint +
    "\n\n" +
    APP_KNOWLEDGE
  );
}

/**
 * @param {unknown} messages
 * @returns {{ ok: true, messages: Array<{role: string, content: string}> } | { ok: false, error: string }}
 */
function validateCoachMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return {ok: false, error: "messages array is required"};
  }
  if (messages.length > MAX_HISTORY_TURNS * 2) {
    return {ok: false, error: "Too many messages in history"};
  }
  const out = [];
  for (const m of messages) {
    if (!m || typeof m !== "object") {
      return {ok: false, error: "Invalid message format"};
    }
    const role = String(m.role || "").trim().toLowerCase();
    if (role !== "user" && role !== "assistant") {
      return {ok: false, error: "Message role must be user or assistant"};
    }
    const content = String(m.content || "").trim();
    if (!content) {
      return {ok: false, error: "Message content cannot be empty"};
    }
    if (role === "user" && content.length > MAX_USER_MSG_LEN) {
      return {ok: false, error: "Message too long (max " + MAX_USER_MSG_LEN + " characters)"};
    }
    if (role === "assistant" && content.length > 4000) {
      return {ok: false, error: "Assistant message too long"};
    }
    out.push({role, content: content.slice(0, role === "user" ? MAX_USER_MSG_LEN : 4000)});
  }
  const last = out[out.length - 1];
  if (!last || last.role !== "user") {
    return {ok: false, error: "Last message must be from the user"};
  }
  return {ok: true, messages: out.slice(-MAX_HISTORY_TURNS * 2)};
}

/**
 * @param {import("openai").default} client
 * @param {{ page?: string, messages: Array<{role: string, content: string}> }} opts
 */
async function chatWithCoach(client, opts) {
  const page = String(opts.page || "other").trim().toLowerCase() || "other";
  const validated = validateCoachMessages(opts.messages);
  if (!validated.ok) {
    const err = new Error(validated.error);
    err.code = "validation";
    throw err;
  }
  const completion = await client.chat.completions.create({
    model: COACH_MODEL,
    messages: [{role: "system", content: buildSystemPrompt(page)}, ...validated.messages],
    max_tokens: 180,
    temperature: 0.25,
  });
  const reply = String(completion.choices[0]?.message?.content || "").trim();
  if (!reply) {
    throw new Error("Empty response from model");
  }
  return reply.slice(0, 800);
}

module.exports = {
  COACH_MODEL,
  MAX_HISTORY_TURNS,
  MAX_USER_MSG_LEN,
  buildSystemPrompt,
  validateCoachMessages,
  chatWithCoach,
};

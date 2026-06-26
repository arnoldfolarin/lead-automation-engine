/**
 * OpenAI integration: generates the SMS message text from lead context.
 * Uses config.openai.apiKey (env: OPENAI_API_KEY) — sent as Authorization: Bearer in API requests.
 *
 * API: OpenAI Chat Completions (e.g. gpt-4o-mini). No other tokens needed; key is enough.
 */

import OpenAI from "openai";
import { config } from "../config/env.js";

const client = new OpenAI({ apiKey: config.openai.apiKey });

export async function craftSms(leadEnvelope) {
  const { contact, source } = leadEnvelope;

  const name = contact.name || "there";
  const provider = source.provider || "Meta";
  const basePrompt = `
You are a concise, professional sales assistant.
Write a short SMS (max ~240 characters) to a new lead from ${provider}.

Lead name: ${name}
Phone: ${contact.phone || "unknown"}
Email: ${contact.email || "unknown"}

Goal: Thank them for their interest and invite them to book a quick call.
Reply with SMS text only, no quotes.
`.trim();

  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "You write short, friendly SMS for sales outreach.",
      },
      { role: "user", content: basePrompt },
    ],
  });

  const text =
    completion.choices?.[0]?.message?.content?.trim() ||
    "Hi, thanks for your interest! When would be a good time for a quick call?";

  return text;
}

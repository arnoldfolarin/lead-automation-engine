/**
 * Twilio SMS: sends the message (or dry-runs). Uses config from env:
 * - TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN: used to create Twilio client (REST API auth)
 * - TWILIO_PHONE_NUMBER: the "from" number for SMS
 * - SEND_MESSAGES_ENABLED: if "false", we do NOT call Twilio API; we only return dry-run result so the route can log sms_dry_run event
 *
 * Twilio API: POST to Twilio's REST API to send SMS. Tokens are used by the twilio npm client under the hood.
 */

import twilio from "twilio";
import { config } from "../config/env.js";

let client = null;
if (config.twilio.accountSid && config.twilio.authToken) {
  client = twilio(config.twilio.accountSid, config.twilio.authToken);
}

/**
 * If SEND_MESSAGES_ENABLED is false: do not call Twilio; return { dryRun: true, to, body }.
 * If true: call client.messages.create() with from=TWILIO_PHONE_NUMBER, return { dryRun: false, sid, to }.
 */
export async function sendSmsDryRunOrReal(to, body) {
  if (!config.runtime.sendMessagesEnabled) {
    return {
      dryRun: true,
      to,
      body,
    };
  }

  if (!client || !config.twilio.fromNumber) {
    throw new Error(
      "Twilio not configured but SEND_MESSAGES_ENABLED=true. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER in .env."
    );
  }

  const message = await client.messages.create({
    to,
    from: config.twilio.fromNumber,
    body,
  });

  return {
    dryRun: false,
    sid: message.sid,
    to: message.to,
  };
}

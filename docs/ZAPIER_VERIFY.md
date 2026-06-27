# Zapier reply webhook — verify & free plan

## Do you need to pay for Zapier?

**Probably not at your current volume.** Each successful Zap run uses **1 task**. The free plan typically includes **100 tasks/month** and up to **5 active Zaps**.

Example: 6 runs in 30 days ≈ **6 tasks/month** — well under the free limit.

Upgrade only if you exceed task limits or need premium apps / faster polling.

## How the integration works

1. A lead replies to outreach email.
2. The reply lands in the **Gmail inbox** your Zap watches.
3. Zapier **Gmail → Webhook** Zap fires.
4. Zap POSTs JSON to:

   `https://tech-jump-outreach.web.app/api/webhooks/reply?token=REPLY_WEBHOOK_SECRET`

5. The API matches `from` email to a Firestore target, sets pipeline to **waiting on us**, and cancels follow-up sequences.

See [`functions/apiRoutes.js`](../functions/apiRoutes.js) (`POST /api/webhooks/reply`).

## Verify in Zapier (no code)

1. Open your Zap in [Zapier](https://zapier.com/app/home).
2. Confirm trigger: **Gmail — New Email** on the shared inbox that receives replies.
3. Confirm action: **Webhooks by Zapier — POST** to the URL above with `token` matching `REPLY_WEBHOOK_SECRET` on Cloud Functions.
4. Click **Test** on each step.
5. Reply to a test outreach email and check **Zap runs** for a new success row.

## Smoke test (from this repo)

```bash
cd python
# Copy REPLY_WEBHOOK_SECRET into python/.env, or load from ../functions/.env.tech-jump-outreach
python scripts/webhook_smoke_test.py \
  --base-url https://tech-jump-outreach.web.app \
  --from-email LEAD_EMAIL_ON_A_TARGET \
  --tenant default
```

On Windows, if Python fails with `CERTIFICATE_VERIFY_FAILED`, use Zapier’s **Test** step instead, or fix your Python CA bundle — the webhook itself is fine.

- **200 + `matched: false`** — webhook works; email did not match any target (use a real target email to test matching).
- **200 + `matched: true`** — target updated; refresh Pipeline (`leads.html`).
- **401** — wrong or missing `REPLY_WEBHOOK_SECRET`.

## Common blockers

| Symptom | Cause |
|---------|--------|
| Zap never runs | Replies go to Google Workspace (`info@…`), not the inbox Zap watches |
| Zap runs, Pipeline unchanged | Webhook URL wrong, token mismatch, or `from` email does not match `contactEmail` on a target |
| `matched: false` in smoke test | `--from-email` is not a target in Firestore |

Email routing (SendGrid Inbound Parse, Reply-To, DNS) is separate from Zapier billing — fix routing first if replies never hit the watched inbox.

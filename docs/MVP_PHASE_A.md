# MVP Phase A — Leads dashboard (no Meta / OpenAI required)

## What was added

| Piece | Purpose |
|-------|--------|
| `functions/index.js` | Cloud Function **`api`**: Express app with `GET /health` and `GET /api/leads` (Firestore read via Admin default credentials). |
| `functions/package.json` | Dependency: **express**. |
| `firebase.json` | Hosting **rewrites**: `/api/**` and `/health` → function `api`. |
| `public/leads.html` | Dashboard: calls `/api/leads`, shows table + raw JSON. |
| `public/index.html` | Links to **View leads dashboard** and **API health**. |

## Deploy (from `Deliverables/`)

```bash
cd "path/to/Deliverables"
firebase use   # should be tech-jump-outreach (or your project)
npm install --prefix functions
firebase deploy --only functions
firebase deploy --only hosting
```

## After deploy — URLs (replace with your Hosting domain)

- **Home:** `https://<project>.web.app/`
- **Leads UI:** `https://<project>.web.app/leads.html`
- **Health:** `https://<project>.web.app/health`
- **API (same origin):** `https://<project>.web.app/api/leads?tenantId=default`

Direct function URL (if needed): see Firebase Console → Functions → `api`.

## Add a test lead (Firestore Console)

1. Firebase Console → **Firestore Database** → **Start collection** (if empty).
2. Collection ID: `tenants`
3. Document ID: `default`
4. Add subcollection `leads`, document ID e.g. `test-lead-1`
5. Fields (example):

```json
{
  "contact": {
    "name": "Test Lead",
    "phone": "+15551234567",
    "email": "test@example.com"
  },
  "status": "new",
  "source": { "provider": "manual" }
}
```

6. Open `/leads.html` and click **Refresh**.

## Notes

- Reads are **server-side** (Admin SDK); browser never needs Firestore rules for this page.
- CORS is `*` for MVP; lock down before production.
- Phase B: mount full Meta webhook Express app and secrets.

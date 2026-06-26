# Python tooling

Companion scripts for data operations around the Lead Automation Engine.

## Setup

```bash
cd python
python -m venv .venv
.venv\Scripts\activate   # Windows
pip install -r requirements.txt
```

Copy the repo root `.env.example` to `.env` and set Firebase credentials.

## Scripts

| Script | Purpose |
|---|---|
| `scripts/export_leads.py` | Export leads and targets for a tenant to JSON |
| `scripts/import_csv_targets.py` | Import contacts from CSV into Firestore targets |
| `scripts/webhook_smoke_test.py` | POST a sample payload to the Zapier reply webhook |
| `scripts/pipeline_report.py` | Print pipeline status counts |

## Tests

```bash
pytest tests/
```

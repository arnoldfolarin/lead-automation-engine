"""Normalize CSV or JSON rows into target document fields."""

from __future__ import annotations

import re
from typing import Any


def norm_email(value: Any) -> str:
    return str(value or "").strip().lower()


def normalize_contact_row(row: dict[str, Any]) -> dict[str, Any] | None:
    """
    Map a loose CSV/JSON row to a Firestore target shape.
    Returns None when no valid email is present.
    """
    email = norm_email(row.get("email") or row.get("contactEmail") or row.get("Email"))
    if not email or "@" not in email:
        return None

    first = str(row.get("firstName") or row.get("first_name") or "").strip()
    last = str(row.get("lastName") or row.get("last_name") or "").strip()
    company = str(row.get("company") or row.get("companyName") or "").strip()
    if not company:
        company = email.split("@")[-1].split(".")[0] or "Imported"

    name = " ".join(part for part in (first, last) if part).strip() or email

    doc: dict[str, Any] = {
        "companyName": company[:200],
        "contactEmail": email,
        "contact": {
            "email": email,
            "firstName": first[:80],
            "lastName": last[:80],
            "name": name[:120],
        },
        "pipelineStatus": "need_send",
        "source": {"provider": str(row.get("source") or "import")},
    }

    vibe = str(row.get("outreachVibe") or "").strip()
    if vibe:
        doc["outreachVibe"] = vibe[:500]

    return doc


def parse_csv_line(line: str) -> dict[str, str]:
    """Minimal comma split for simple CSV rows (no quoted commas)."""
    parts = [p.strip() for p in line.split(",")]
    if len(parts) < 1:
        return {}
    headers = ["email", "firstName", "lastName", "company", "outreachVibe"]
    out: dict[str, str] = {}
    for i, header in enumerate(headers):
        if i < len(parts) and parts[i]:
            out[header] = parts[i]
    return out


EMAIL_RE = re.compile(r"^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$", re.IGNORECASE)


def is_valid_email(email: str) -> bool:
    return bool(EMAIL_RE.match(email))

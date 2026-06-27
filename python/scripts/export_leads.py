#!/usr/bin/env python3
"""Export leads and targets for a tenant to JSON."""

from __future__ import annotations

import argparse
import json
import os
import sys

from dotenv import load_dotenv

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from lib.firestore_client import get_db, serialize_doc


def main() -> None:
    load_dotenv()
    parser = argparse.ArgumentParser(description="Export tenant data to JSON")
    parser.add_argument("--tenant", default="default", help="Tenant ID")
    parser.add_argument("--output", default="export.json", help="Output file path")
    args = parser.parse_args()

    db = get_db()
    tenant_ref = db.collection("tenants").document(args.tenant)

    leads = [
        serialize_doc(d.id, d.to_dict())
        for d in tenant_ref.collection("leads").stream()
    ]
    targets = [
        serialize_doc(d.id, d.to_dict())
        for d in tenant_ref.collection("targets").stream()
    ]

    payload = {"tenantId": args.tenant, "leads": leads, "targets": targets}
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, default=str)

    print(f"Exported {len(leads)} leads and {len(targets)} targets to {args.output}")


if __name__ == "__main__":
    main()

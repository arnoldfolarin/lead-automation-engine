#!/usr/bin/env python3
"""Import contacts from a CSV file into Firestore targets."""

from __future__ import annotations

import argparse
import os
import sys

from dotenv import load_dotenv
from google.cloud import firestore

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from lib.firestore_client import get_db
from lib.lead_normalizer import normalize_contact_row, parse_csv_line


def main() -> None:
    load_dotenv()
    parser = argparse.ArgumentParser(description="Import CSV contacts as targets")
    parser.add_argument("csv_file", help="Path to CSV file (header row optional)")
    parser.add_argument("--tenant", default="default", help="Tenant ID")
    parser.add_argument("--dry-run", action="store_true", help="Parse only, do not write")
    args = parser.parse_args()

    with open(args.csv_file, encoding="utf-8") as f:
        lines = [ln.strip() for ln in f if ln.strip()]

    if not lines:
        print("No rows found")
        return

    start = 1 if "@" in lines[0] and "," in lines[0] else 0
    if lines[0].lower().startswith("email"):
        start = 1

    created = 0
    db = get_db()
    batch = db.batch()
    coll = db.collection("tenants").document(args.tenant).collection("targets")

    for line in lines[start:]:
        row = parse_csv_line(line)
        doc = normalize_contact_row(row)
        if not doc:
            continue
        doc["tenantId"] = args.tenant
        doc["createdAt"] = firestore.SERVER_TIMESTAMP
        ref = coll.document()
        if not args.dry_run:
            batch.set(ref, doc)
        created += 1
        if created % 400 == 0 and not args.dry_run:
            batch.commit()
            batch = db.batch()

    if not args.dry_run and created % 400 != 0:
        batch.commit()

    print(f"{'Would create' if args.dry_run else 'Created'} {created} targets")


if __name__ == "__main__":
    main()

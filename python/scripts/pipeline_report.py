#!/usr/bin/env python3
"""Print pipeline status counts for a tenant."""

from __future__ import annotations

import argparse
import os
import sys
from collections import Counter

from dotenv import load_dotenv

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from lib.firestore_client import get_db
from lib.scoring import rank_targets


def main() -> None:
    load_dotenv()
    parser = argparse.ArgumentParser(description="Pipeline status report")
    parser.add_argument("--tenant", default="default", help="Tenant ID")
    parser.add_argument("--top", type=int, default=5, help="Show top N priority targets")
    args = parser.parse_args()

    db = get_db()
    targets = [
        {"id": d.id, **(d.to_dict() or {})}
        for d in db.collection("tenants").document(args.tenant).collection("targets").stream()
    ]

    counts = Counter(str(t.get("pipelineStatus") or "unknown") for t in targets)
    print(f"Tenant: {args.tenant}")
    print(f"Total targets: {len(targets)}")
    print("\nPipeline status:")
    for status, n in sorted(counts.items(), key=lambda x: (-x[1], x[0])):
        print(f"  {status}: {n}")

    ranked = rank_targets(targets)
    if ranked and args.top > 0:
        print(f"\nTop {args.top} by priority:")
        for t in ranked[: args.top]:
            company = t.get("companyName") or t.get("contactEmail") or t.get("id")
            print(f"  [{t['priorityScore']}] {company} ({t.get('pipelineStatus')})")


if __name__ == "__main__":
    main()

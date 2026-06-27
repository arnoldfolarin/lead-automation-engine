#!/usr/bin/env python3
"""POST a sample payload to the Zapier reply webhook."""

from __future__ import annotations

import argparse
import os
import sys

import requests
from dotenv import load_dotenv


def main() -> None:
    load_dotenv()
    parser = argparse.ArgumentParser(description="Smoke test reply webhook")
    parser.add_argument("--base-url", required=True, help="API base URL, e.g. https://project.web.app")
    parser.add_argument("--from-email", default="lead@example.com", help="Sender email in payload")
    parser.add_argument("--tenant", default="default", help="Tenant ID")
    args = parser.parse_args()

    token = os.getenv("REPLY_WEBHOOK_SECRET", "").strip()
    if not token:
        print("REPLY_WEBHOOK_SECRET is not set")
        sys.exit(1)

    url = f"{args.base_url.rstrip('/')}/api/webhooks/reply?token={token}"
    payload = {
        "tenantId": args.tenant,
        "from": args.from_email,
        "subject": "Re: quick question",
        "body": "Thanks, let's talk next week.",
    }

    resp = requests.post(url, json=payload, timeout=30)
    print(f"Status: {resp.status_code}")
    print(resp.text[:500])


if __name__ == "__main__":
    main()

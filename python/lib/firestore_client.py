"""Thin Firestore client helpers for Python scripts."""

from __future__ import annotations

import os
from typing import Any

import firebase_admin
from firebase_admin import credentials, firestore


def get_db() -> firestore.Client:
    """Initialize Firebase Admin once and return a Firestore client."""
    if not firebase_admin._apps:
        cred_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
        if cred_path and os.path.isfile(cred_path):
            cred = credentials.Certificate(cred_path)
        else:
            project_id = os.getenv("FIREBASE_PROJECT_ID", "").strip()
            client_email = os.getenv("FIREBASE_CLIENT_EMAIL", "").strip()
            private_key = os.getenv("FIREBASE_PRIVATE_KEY", "").replace("\\n", "\n")
            if not (project_id and client_email and private_key):
                raise RuntimeError(
                    "Set GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_PROJECT_ID, "
                    "FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY"
                )
            cred = credentials.Certificate(
                {
                    "type": "service_account",
                    "project_id": project_id,
                    "private_key": private_key,
                    "client_email": client_email,
                    "token_uri": "https://oauth2.googleapis.com/token",
                }
            )
        firebase_admin.initialize_app(cred)
    return firestore.client()


def serialize_doc(doc_id: str, data: dict[str, Any]) -> dict[str, Any]:
    """Convert a Firestore document to a JSON-friendly dict."""
    out = dict(data or {})
    out["id"] = doc_id
    for key, val in list(out.items()):
        if hasattr(val, "isoformat"):
            out[key] = val.isoformat()
    return out

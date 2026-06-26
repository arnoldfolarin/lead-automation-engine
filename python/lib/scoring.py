"""Simple lead priority scoring heuristics."""

from __future__ import annotations

from typing import Any


def score_target(target: dict[str, Any]) -> int:
    """
    Return a 0-100 priority score for a pipeline target.
    Higher means more urgent to contact or follow up.
    """
    score = 50
    status = str(target.get("pipelineStatus") or "").lower()

    if status == "need_send":
        score += 25
    elif status == "waiting_on_them":
        score += 10
    elif status == "waiting_on_you":
        score += 30
    elif status == "booked":
        score -= 40

    if target.get("lastReplyAt"):
        score += 15

    seq = str(target.get("sequenceStatus") or "").lower()
    if seq == "active":
        score += 10

    company = str(target.get("companyName") or "").strip()
    if company and company.lower() not in ("imported", "unknown"):
        score += 5

    return max(0, min(100, score))


def rank_targets(targets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Sort targets by descending priority score."""
    scored = []
    for t in targets:
        item = dict(t)
        item["priorityScore"] = score_target(t)
        scored.append(item)
    return sorted(scored, key=lambda x: x["priorityScore"], reverse=True)

"""Tests for scoring."""

from lib.scoring import rank_targets, score_target


def test_score_need_send_higher_than_booked():
    need_send = score_target({"pipelineStatus": "need_send"})
    booked = score_target({"pipelineStatus": "booked"})
    assert need_send > booked


def test_rank_targets_descending():
    targets = [
        {"id": "a", "pipelineStatus": "booked"},
        {"id": "b", "pipelineStatus": "need_send"},
    ]
    ranked = rank_targets(targets)
    assert ranked[0]["id"] == "b"
    assert "priorityScore" in ranked[0]

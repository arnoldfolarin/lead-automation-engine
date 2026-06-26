"""Tests for lead_normalizer."""

from lib.lead_normalizer import is_valid_email, normalize_contact_row, parse_csv_line


def test_normalize_contact_row_valid():
    row = {"email": "Jane@Acme.com", "firstName": "Jane", "company": "Acme"}
    doc = normalize_contact_row(row)
    assert doc is not None
    assert doc["contactEmail"] == "jane@acme.com"
    assert doc["companyName"] == "Acme"
    assert doc["pipelineStatus"] == "need_send"


def test_normalize_contact_row_missing_email():
    assert normalize_contact_row({"name": "No Email"}) is None


def test_parse_csv_line():
    row = parse_csv_line("a@b.com,Jane,Doe,Acme,friendly")
    assert row["email"] == "a@b.com"
    assert row["company"] == "Acme"


def test_is_valid_email():
    assert is_valid_email("user@example.com")
    assert not is_valid_email("not-an-email")

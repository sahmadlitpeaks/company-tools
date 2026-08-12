"""Field mapping: CF7 name heuristics, transforms, salvage, catalogue merge.

Pure functions, so these run without a database or fixtures.
"""
from app.services.intake_mapping import (
    apply_mapping,
    auto_mapping,
    guess_target,
    merge_catalog,
    normalize_key,
    schema_hash,
    transform_value,
)


def _fields(*names):
    return [{"name": n} for n in names]


# ---- normalisation and guessing -----------------------------------------
def test_normalize_strips_cf7_numbering_and_punctuation():
    assert normalize_key("tel-123") == "tel"
    assert normalize_key("menu-456") == "menu"
    assert normalize_key("Your-Email[]") == "your email"
    assert normalize_key("your_message") == "your message"
    # A name that merely ends in a word must not lose part of itself.
    assert normalize_key("first-name") == "first name"


def test_guess_target_cf7_defaults():
    assert guess_target("your-name")[0] == "name"
    assert guess_target("your-email")[0] == "email"
    assert guess_target("your-subject")[0] == "subject"
    assert guess_target("your-message")[0] == "message"
    assert guess_target("tel-123")[0] == "phone"


def test_ambiguous_cf7_types_are_deliberately_not_guessed():
    """Guessing wrong is worse than leaving it for the mapping editor."""
    for name in ("text-874", "menu-456", "checkbox-2", "radio-9", "file-1",
                 "acceptance-1", "number-3", "date-7", "range-2"):
        assert guess_target(name) == (None, 0), name


def test_guess_target_variants():
    assert guess_target("fullname")[0] == "name"
    assert guess_target("e-mail")[0] == "email"
    assert guess_target("mobile-number")[0] == "phone"
    assert guess_target("whatsapp")[0] == "phone"
    assert guess_target("organisation")[0] == "company"
    assert guess_target("comments")[0] == "message"


def test_declared_type_breaks_a_tie_on_an_uninformative_name():
    assert guess_target("field_7", field_type="email")[0] == "email"
    assert guess_target("text-874", field_type="tel")[0] == "phone"
    # A dictionary hit still outranks the declared type.
    assert guess_target("your-name", field_type="text")[0] == "name"


def test_label_is_used_when_the_name_says_nothing():
    assert guess_target("text-874", label="Mobile number")[0] == "phone"


def test_first_and_last_name_are_joined():
    mapping = auto_mapping(_fields("first-name", "last-name", "your-email"))
    rule = next(r for r in mapping["rules"] if r["target"] == "name")
    assert rule["sources"] == ["first-name", "last-name"]
    assert rule["combine"] == "join"

    out = apply_mapping(mapping, {
        "first-name": "Jane", "last-name": "Roe", "your-email": "jane@acme.com",
    })
    assert out.core["name"] == "Jane Roe"


def test_auto_mapping_is_deterministic_and_idempotent():
    fields = _fields("your-name", "your-email", "tel-123", "menu-456")
    first = auto_mapping(fields)
    assert first == auto_mapping(fields)
    data = {"your-name": "Jane", "your-email": "j@x.com", "tel-123": "+971500000000",
            "menu-456": "Consulting"}
    assert apply_mapping(first, data).core == apply_mapping(first, data).core


# ---- transforms ----------------------------------------------------------
def test_every_transform():
    assert transform_value("  Jane  ", ["trim"]) == "Jane"
    assert transform_value("Jane", ["lower"]) == "jane"
    assert transform_value("Jane", ["upper"]) == "JANE"
    assert transform_value("jane roe", ["title"]) == "Jane Roe"
    assert transform_value("+971 (50) 000-0000", ["digits"]) == "+971500000000"
    assert transform_value("<p>Hi <b>there</b></p>", ["strip_html"]) == "Hi there"
    assert transform_value(["a", "b"], ["join_array"]) == "a, b"
    assert transform_value("line one\nline two", ["first_line"]) == "line one"
    assert transform_value("Bob <bob@x.com>", ["email_only"]) == "bob@x.com"


def test_transforms_chain_in_order():
    assert transform_value("  BOB <BOB@X.COM> ", ["trim", "lower", "email_only"]) == "bob@x.com"


def test_empty_values_collapse_to_none():
    assert transform_value("   ", ["trim"]) is None
    assert transform_value(None, ["trim"]) is None
    assert transform_value("no email here", ["email_only"]) is None


# ---- applying ------------------------------------------------------------
def test_array_is_joined_for_a_column_but_stays_a_list_in_extras():
    mapping = {"version": 1, "rules": [
        {"sources": ["services"], "target": "subject", "combine": "first"},
    ]}
    out = apply_mapping(mapping, {"services": ["Sales", "Support"], "tags": ["a", "b"]})
    assert out.core["subject"] == "Sales, Support"
    assert out.extras["tags"] == ["a", "b"]


def test_column_limits_are_enforced_after_transforms():
    mapping = {"version": 1, "rules": [
        {"sources": ["n"], "target": "name"},
        {"sources": ["p"], "target": "phone"},
    ]}
    out = apply_mapping(mapping, {"n": "x" * 400, "p": "9" * 200})
    assert len(out.core["name"]) == 255
    assert len(out.core["phone"]) == 64


def test_fallback_chain_takes_the_first_non_empty_source():
    mapping = {"version": 1, "rules": [
        {"sources": ["work-email", "personal-email"], "target": "email"},
    ]}
    out = apply_mapping(mapping, {"work-email": "", "personal-email": "me@home.com"})
    assert out.core["email"] == "me@home.com"


def test_unclaimed_fields_are_kept_as_labelled_extras():
    mapping = auto_mapping(_fields("your-name", "your-email"))
    out = apply_mapping(
        mapping,
        {"your-name": "Jane", "your-email": "jane@acme.com", "budget-9": "10k"},
        fields=[{"name": "budget-9", "label": "Approximate budget"}],
    )
    assert out.extras["budget-9"] == "10k"
    assert out.labels["budget-9"] == "Approximate budget"


def test_wordpress_internals_are_dropped_from_extras():
    out = apply_mapping(None, {
        "your-name": "Jane",
        "_wpcf7": "17", "_wpcf7_unit_tag": "wpcf7-f17", "_wpnonce": "abc",
        "g-recaptcha-response": "token",
    })
    for internal in ("_wpcf7", "_wpcf7_unit_tag", "_wpnonce", "g-recaptcha-response"):
        assert internal not in out.extras


def test_mapping_drift_between_hyphen_and_underscore_still_resolves():
    mapping = {"version": 1, "rules": [{"sources": ["your-email"], "target": "email"}]}
    out = apply_mapping(mapping, {"your_email": "jane@acme.com"})
    assert out.core["email"] == "jane@acme.com"


def test_sibling_cf7_dropdowns_are_not_confused_for_each_other():
    """`menu-456` and `menu-789` both normalise to `menu` — mapping one must
    not swallow the other, or a budget would silently become a subject."""
    mapping = {"version": 1, "rules": [{"sources": ["menu-456"], "target": "subject"}]}
    out = apply_mapping(mapping, {"menu-456": "Sales", "menu-789": "10k+"})
    assert out.core["subject"] == "Sales"
    assert out.extras == {"menu-789": "10k+"}


def test_a_rule_never_falls_back_onto_a_different_numbered_field():
    """A rule for `menu-456` must not quietly read `menu-789` when the form
    changed — that would attribute one answer to a different question."""
    mapping = {"version": 1, "rules": [{"sources": ["menu-456"], "target": "subject"}]}
    out = apply_mapping(mapping, {"menu-789": "10k+"})
    assert out.core.get("subject") is None
    assert out.extras == {"menu-789": "10k+"}


def test_a_referenced_but_empty_field_is_not_swallowed():
    mapping = {"version": 1, "rules": [
        {"sources": ["alt-email", "main-email"], "target": "email"},
    ]}
    out = apply_mapping(mapping, {"alt-email": "", "main-email": "me@x.com"})
    assert out.core["email"] == "me@x.com"
    assert "main-email" not in out.extras


# ---- salvage: the "never lose data" guarantee -----------------------------
def test_unknown_field_names_still_produce_a_usable_submission():
    """A form nobody has mapped yet must not yield a blank lead."""
    out = apply_mapping(None, {
        "xyz-999": "Jane Roe",
        "abc-111": "jane@acme.com",
        "qqq-222": "+971 50 123 4567",
        "zzz-333": "I would like a quotation for your consulting services please.",
    })
    assert out.core["email"] == "jane@acme.com"
    assert out.core["phone"] == "+971 50 123 4567"
    assert out.core["message"].startswith("I would like a quotation")
    assert out.status == "partial"
    assert out.notes


def test_salvage_marks_partial_even_when_rules_exist():
    mapping = {"version": 1, "rules": [{"sources": ["your-name"], "target": "name"}]}
    out = apply_mapping(mapping, {"your-name": "Jane", "weird-4": "jane@acme.com"})
    assert out.core["email"] == "jane@acme.com"
    assert out.status == "partial"


def test_a_complete_mapping_reports_mapped():
    mapping = auto_mapping(_fields("your-name", "your-email", "your-message"))
    out = apply_mapping(mapping, {
        "your-name": "Jane", "your-email": "jane@acme.com", "your-message": "Hello",
    })
    assert out.status == "mapped"
    assert out.notes == []


def test_no_rules_and_no_recognisable_content_reports_none():
    out = apply_mapping(None, {"a-1": "x", "b-2": "y"})
    assert out.status == "none"


# ---- catalogue -----------------------------------------------------------
def test_catalogue_merges_schema_labels_with_observed_values():
    catalog, changed = merge_catalog(
        None,
        schema_fields=[{"name": "text-874", "basetype": "text", "label": "Mobile number"}],
        data={"text-874": "+971 50 123 4567"},
    )
    assert changed
    entry = next(e for e in catalog if e["name"] == "text-874")
    assert entry["label"] == "Mobile number"
    assert entry["type"] == "text"
    assert entry["seen_count"] == 1


def test_catalogue_masks_contact_details_in_samples():
    catalog, _ = merge_catalog(None, data={
        "your-email": "jane@acme.com", "tel-1": "+971501234567",
    })
    samples = {e["name"]: e["sample"] for e in catalog}
    assert samples["your-email"] == "j***@acme.com"
    assert "501234" not in samples["tel-1"]
    # Still recognisable enough to map by eye.
    assert samples["tel-1"].startswith("+97")


def test_catalogue_skips_samples_for_sensitive_names():
    catalog, _ = merge_catalog(None, data={"card-number": "4111111111111111"})
    assert next(e for e in catalog if e["name"] == "card-number")["sample"] is None


def test_repeated_schema_push_reports_no_change():
    schema = [{"name": "your-name", "basetype": "text", "label": "Your name"}]
    catalog, changed = merge_catalog(None, schema_fields=schema)
    assert changed
    _, changed_again = merge_catalog(catalog, schema_fields=schema)
    assert not changed_again


def test_schema_hash_detects_an_edited_form():
    a = schema_hash([{"name": "your-name"}, {"name": "your-email"}])
    b = schema_hash([{"name": "your-email"}, {"name": "your-name"}])
    c = schema_hash([{"name": "your-name"}, {"name": "tel-123"}])
    assert a == b  # order is irrelevant
    assert a != c

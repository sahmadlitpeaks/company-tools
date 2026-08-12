"""Stateless spam heuristics — the layer that reads one message on its own.

Pure functions, so no database or fixtures are involved.
"""
from app.services.spam.content import score_submission


def _score(**kw):
    base = dict(name=None, email=None, phone=None, subject=None, message=None, payload=None)
    base.update(kw)
    return score_submission(**base)


# ---- content layer -------------------------------------------------------
def test_honeypot_is_still_decisive():
    score, reasons = _score(name="Bot", email="b@x.com", payload={"_gotcha": "x"})
    assert score == 100 and "Honeypot" in reasons[0]


def test_spam_words_no_longer_match_inside_ordinary_words():
    """The old substring check flagged Seoul and Sloane, quarantining real
    enquiries. Terms must match as whole words."""
    for innocent in (
        "Our office in Seoul would like a quote.",
        "Please contact Mr Sloane about the fit-out.",
        "We need a new kitchen island for the villa.",
    ):
        score, reasons = _score(
            name="Real Person", email="real@acme.com", message=innocent
        )
        assert not any("keyword" in r.lower() for r in reasons), (innocent, reasons)

    # …while the real terms still fire.
    score, reasons = _score(
        name="X", email="x@acme.com", message="cheap seo backlink service"
    )
    assert any("keyword" in r.lower() for r in reasons)


def test_multi_word_terms_with_punctuation_still_match():
    _, reasons = _score(name="X", email="x@acme.com", message="You can earn $5000 weekly")
    assert any("keyword" in r.lower() for r in reasons)


def test_link_in_a_name_field_is_suspicious():
    plain, _ = _score(name="Jane Roe", email="j@acme.com", message="Hello")
    linky, reasons = _score(name="http://spam.ru", email="j@acme.com", message="Hello")
    assert linky > plain
    assert any("name or company" in r for r in reasons)


def test_every_field_holding_the_same_value_is_a_bot_tell():
    _, reasons = _score(
        name="aaa", email="aaa", phone="aaa", subject="aaa", message="aaa"
    )
    assert any("same value" in r for r in reasons)


def test_gibberish_names_are_flagged_but_real_ones_are_not():
    _, bad = _score(name="asdkjhqwe", email="x@acme.com", message="Hello there")
    assert any("auto-generated" in r for r in bad)
    for real in ("Jane Roe", "Mohammed Al Rashid", "Siobhan O'Connor", "Zhang Wei"):
        _, ok = _score(name=real, email="x@acme.com", message="Hello there")
        assert not any("auto-generated" in r for r in ok), real


def test_arabic_names_are_not_penalised_as_foreign_script():
    """Arabic is entirely normal here; only Cyrillic is treated as a signal."""
    _, arabic = _score(name="محمد الراشد", email="m@acme.com", message="مرحبا، أريد عرض سعر")
    assert not any("Cyrillic" in r for r in arabic)
    _, cyrillic = _score(name="Иван Иванов", email="i@acme.com", message="Привет")
    assert any("Cyrillic" in r for r in cyrillic)

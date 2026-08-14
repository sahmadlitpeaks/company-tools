from decimal import Decimal

from app.services.ad_sync.base import normalise_channel, to_decimal, to_int


def test_to_decimal_handles_strings_none_and_junk():
    assert to_decimal("12.34") == Decimal("12.34")
    assert to_decimal(None) == Decimal("0")
    assert to_decimal("") == Decimal("0")
    assert to_decimal("not-a-number") == Decimal("0")


def test_to_int_handles_float_strings():
    """Platforms return counts as float-formatted strings such as "12.0"."""
    assert to_int("12.0") == 12
    assert to_int(None) == 0
    assert to_int("junk") == 0


def test_normalise_channel_maps_known_platforms():
    assert normalise_channel("facebook") == "facebook"
    assert normalise_channel("instagram") == "instagram"
    assert normalise_channel("google") == "google"
    assert normalise_channel("tiktok") == "tiktok"


def test_unknown_channel_falls_back_to_other():
    assert normalise_channel("audience_network") == "other"
    assert normalise_channel("messenger") == "other"
    assert normalise_channel("") == "other"

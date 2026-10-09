"""Finding honey, against recorded replies.

The Overpass and Nominatim fixtures were recorded live on 2026-10-08 for the
Vergennes, Vermont search the Brain note names as the test case. The Google and
USDA fixtures are hand-written in those services' documented shapes — no key was
available to record with — and say so in their files. The relay fixture holds
one listing recorded from relay.damus.io and three written to exercise the
geohash, the sold flag and the location-only path.
"""

from __future__ import annotations

import asyncio
import json
import pathlib
from typing import Any

import httpx
import pytest

from beesknees_mcp import honey as h

FIX = pathlib.Path(__file__).parent / "fixtures" / "honey"
VERGENNES = (44.1681, -73.2518)


def fixture(name: str) -> Any:
    return json.loads((FIX / name).read_text())


@pytest.fixture(autouse=True)
def _fresh_memory() -> None:
    h.forget_everything()


# ── Where ────────────────────────────────────────────────────────────────


def test_near_is_a_pair_a_place_or_nothing() -> None:
    assert h.parse_near("44.17, -73.25") == (44.17, -73.25)
    assert h.parse_near("Vergennes, VT") == "Vergennes, VT"
    assert h.parse_near("05491") == "05491"
    assert h.parse_near("") is None
    assert h.parse_near("95,0") is None, "off the planet is not a place name either"


def test_a_geohash_round_trips_to_its_cell() -> None:
    gh = h.geohash_encode(44.25, -73.13, 7)
    lat, lon = h.geohash_decode(gh)
    assert abs(lat - 44.25) < 0.001 and abs(lon + 73.13) < 0.001
    assert h.geohash_decode("not a hash!") is None


def test_the_compass_reads_the_bearing() -> None:
    assert h.compass(0) == "N" and h.compass(44) == "NE" and h.compass(181) == "S" and h.compass(359) == "N"


# ── Reading each source ──────────────────────────────────────────────────


def test_vergennes_on_openstreetmap_puts_the_honey_shop_first() -> None:
    sellers = [h.with_distance(s, VERGENNES) for s in h.from_osm(fixture("overpass_vergennes.json"))]
    ranked = sorted(sellers, key=h.score, reverse=True)
    assert [s.name for s in ranked] == ["Champlain Valley Honey", "Ground Behive"]
    shop = ranked[0]
    assert shop.evidence == "explicit" and shop.kind == "honey"
    assert shop.website == "https://www.champlainvalleyhoney.com/" and shop.phone
    assert 15 < shop.distance_km < 20
    assert ranked[1].evidence == "strong" and ranked[1].kind == "beekeeper"


def test_a_beekeeping_supply_shop_is_not_a_honey_stop() -> None:
    payload = {"elements": [
        {"type": "node", "id": 1, "lat": 44.0, "lon": -73.0, "tags": {"name": "Bee Supply Co", "shop": "beekeeping"}},
        {"type": "node", "id": 2, "lat": 44.0, "lon": -73.0, "tags": {"name": "Green Farm", "shop": "farm",
                                                                    "description": "nucs, queens, equipment"}},
        {"type": "node", "id": 3, "lat": 44.0, "lon": -73.0, "tags": {"name": "Queen Bee Nucs & Honey", "shop": "honey"}},
    ]}
    names = [s.name for s in h.from_osm(payload)]
    assert names == ["Queen Bee Nucs & Honey"], "a shop that SAYS honey keeps its place; the suppliers go"


def test_google_keeps_the_sellers_and_drops_the_grocer_and_birdseye() -> None:
    names = [s.name for s in h.from_google(fixture("google_vergennes.json"))]
    assert "Birdseye Bee's & Poultry" not in names, "nucs and queens, not honey"
    assert "Hannaford Supermarket" not in names, "ranked for the word, sells no evidence of it"
    assert names == ["Swaying Daisies Honeybee Farm Market", "Champlain Valley Apiaries", "Dancing Bee Gardens"]


def test_usda_keeps_only_rows_that_mention_honey() -> None:
    rows = h.from_usda(fixture("usda_onfarmmarket_vergennes.json"), "onfarmmarket")
    assert [r.name for r in rows] == ["Swaying Daisies Honeybee Farm Market"]
    r = rows[0]
    assert r.evidence == "explicit" and r.kind == "farm"
    assert r.address == "5075 Ethan Allen Hwy, Ferrisburgh, VT" and r.postcode == "05456"
    assert r.observed == "2025-06-30"


def test_nostr_places_by_geohash_defers_by_text_and_drops_the_rest() -> None:
    placed, to_geocode = h.from_nostr(fixture("nostr_listings.json"))
    names = [s.name for s in placed]
    assert "Cretan Wildflower Honey 10 oz" not in names, "nowhere to drive to"
    assert "Last Jars of Fall Honey" not in names, "sold"
    monkton = next(s for s in placed if s.name == "Monkton Hollow Honey")
    assert abs(monkton.lat - 44.23) < 0.05 and monkton.website == "https://monktonhoney.example/"
    assert to_geocode == [("Bristol Comb & Creamed Honey", "Bristol, Vermont")]


# ── Merging ──────────────────────────────────────────────────────────────


def test_the_same_shop_from_two_sources_is_one_seller_with_provenance() -> None:
    osm = h.from_osm(fixture("overpass_vergennes.json"))
    google = h.from_google(fixture("google_vergennes.json"))
    merged = h.merge([*osm, *google])
    cv = [s for s in merged if "Champlain Valley" in s.name]
    assert len(cv) == 1, "one website domain, one seller"
    s = cv[0]
    assert s.sources == ("osm", "google")
    # Both sources give the same street; the first seen keeps it, and says so.
    assert "504 Washington" in s.address
    assert s.fields_from["address"] == "osm" and s.fields_from["phone"] == "osm"
    assert s.place_id == "ChIJchamplain-valley-apiaries", "Google's one keepable field rides along"
    assert s.evidence == "explicit"


def test_a_street_address_beats_a_po_box() -> None:
    a = h.Seller(name="Dancing Bee Gardens", lat=44.0153, lon=-73.1673, source="google",
                 address="P.O. Box 443, Middlebury, VT", website="https://dancingbeegardens.example/")
    b = h.Seller(name="Dancing Bee Gardens", lat=44.0153, lon=-73.1673, source="usda",
                 address="12 Orchard Ln, Middlebury, VT", website="https://dancingbeegardens.example/")
    (m,) = h.merge([a, b])
    assert m.address == "12 Orchard Ln, Middlebury, VT" and m.fields_from["address"] == "usda"
    assert h.address_quality("") < h.address_quality("P.O. Box 1") < h.address_quality("Middlebury") < h.address_quality("12 Main St")


def test_near_neighbours_with_different_names_stay_apart() -> None:
    a = h.Seller(name="Hollow Honey", lat=44.0, lon=-73.0, source="osm")
    b = h.Seller(name="Riverside Apiary", lat=44.0005, lon=-73.0, source="google")
    assert len(h.merge([a, b])) == 2


# ── Ranking and picking ──────────────────────────────────────────────────


def _at(name: str, km: float, **kw: Any) -> h.Seller:
    return h.Seller(name=name, lat=44.0, lon=-73.0, source="osm", distance_km=km, **kw)


def test_the_ring_is_the_smallest_that_holds_enough() -> None:
    sellers = [_at("a", 10), _at("b", 25), _at("c", 28), _at("d", 90)]
    assert h.ring_for(sellers, 3) == 30
    assert h.ring_for(sellers, 1) == 15
    assert h.ring_for(sellers, 4) == 60 or h.ring_for(sellers, 4) == 100
    assert h.ring_for(sellers, 9) == 100, "fewer than asked: the edge, with what there is"
    assert h.ring_for([_at("far", 300)], 1) is None
    assert h.ring_for(sellers, 3, max_km=10) == 10


def test_pick_wants_an_address_and_a_live_website_and_says_when_it_relaxed() -> None:
    good = _at("good", 5, address="1 Main St", website="https://good.example/", evidence="explicit")
    dead = _at("dead", 6, address="2 Main St", website="https://dead.example/", evidence="explicit")
    none = _at("none", 7, address="3 Main St", evidence="explicit")
    lost = _at("lost", 1, website="https://lost.example/", evidence="explicit")
    alive = {"https://good.example/": True, "https://dead.example/": False, "https://lost.example/": True}
    chosen = h.pick([good, dead, none, lost], 3, alive)
    assert [s.name for s in chosen] == ["good", "dead", "none"]
    assert chosen[0].verify == ()
    assert chosen[1].verify == ("website did not answer",)
    assert chosen[2].verify == ("no website",)
    assert all(s.name != "lost" for s in chosen), "no address is never relaxed"


def test_agreement_and_nearness_both_lift_the_score() -> None:
    lone = _at("lone", 10, address="x", website="y", evidence="explicit")
    agreed = h.Seller(**{**lone.__dict__, "sources": ("osm", "google")})
    assert h.score(agreed) > h.score(lone)
    assert h.score(_at("near", 5, address="x", website="y")) > h.score(_at("far", 50, address="x", website="y"))


# ── The whole answer, with every source faked ────────────────────────────


class _Fakes:
    """Each fetcher answers from a fixture; the clock-bound ones can be made slow."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.osm_delay = 0.0
        self.websites_alive = True

        async def fetch_osm(origin: Any, radius_km: float, client: Any) -> list[h.Seller]:
            await asyncio.sleep(self.osm_delay)
            return h.from_osm(fixture("overpass_vergennes.json"))

        async def fetch_google(origin: Any, key: str, client: Any) -> list[h.Seller]:
            return h.from_google(fixture("google_vergennes.json"))

        async def fetch_usda(origin: Any, radius_km: float, key: str, client: Any) -> list[h.Seller]:
            return h.from_usda(fixture("usda_onfarmmarket_vergennes.json"), "onfarmmarket")

        async def geocode(place: str, client: Any) -> tuple[float, float, str] | None:
            if place.startswith("Vergennes"):
                r = fixture("nominatim_search_vergennes.json")[0]
                return float(r["lat"]), float(r["lon"]), r["display_name"]
            if place.startswith("Bristol"):
                return 44.133, -73.079, "Bristol, Addison County, Vermont, United States"
            return None

        async def reverse(lat: float, lon: float, client: Any) -> tuple[str, str]:
            a = fixture("nominatim_reverse_middlebury.json")["address"]
            return f"{a['house_number']} {a['road']}, {a['town']}, {a['state']}", a["postcode"]

        async def check_website(url: str, client: Any) -> bool:
            return self.websites_alive

        monkeypatch.setattr(h, "fetch_osm", fetch_osm)
        monkeypatch.setattr(h, "fetch_google", fetch_google)
        monkeypatch.setattr(h, "fetch_usda", fetch_usda)
        monkeypatch.setattr(h, "fetch_nostr_events", lambda: fixture("nostr_listings.json"))
        monkeypatch.setattr(h, "geocode", geocode)
        monkeypatch.setattr(h, "reverse", reverse)
        monkeypatch.setattr(h, "check_website", check_website)


@pytest.fixture
def fakes(monkeypatch: pytest.MonkeyPatch) -> _Fakes:
    return _Fakes(monkeypatch)


def test_vergennes_answers_three_sellers_each_with_an_address_and_a_website(fakes: _Fakes) -> None:
    out = asyncio.run(h.find("Vergennes, VT", 3, None, google_key="k", usda_key="k"))
    assert out["success"], out
    assert len(out["sellers"]) == 3
    for s in out["sellers"]:
        assert s["address"] and s["website"], s
    names = [s["name"] for s in out["sellers"]]
    assert "Birdseye Bee's & Poultry" not in names
    assert "Champlain Valley Honey" in names and "Swaying Daisies Honeybee Farm Market" in names
    cv = next(s for s in out["sellers"] if s["name"] == "Champlain Valley Honey")
    assert set(cv["sources"]) == {"osm", "google"}
    assert out["origin"]["label"].startswith("Vergennes") and out["coarse"] is False
    assert out["radius_used_km"] in h.RINGS_KM
    assert out["sources"] == {"osm": "ok (2)", "usda": "ok (1)", "nostr": "ok (2)", "google": "ok (3)"}
    assert h.OSM_ATTRIBUTION in out["attribution"] and h.GOOGLE_ATTRIBUTION in out["attribution"]


def test_without_keys_the_answer_says_which_sources_were_skipped(fakes: _Fakes) -> None:
    out = asyncio.run(h.find("44.1681,-73.2518", 3, None))
    assert out["success"]
    assert out["sources"]["google"] == "skipped: no key" and out["sources"]["usda"] == "skipped: no key"
    assert out["sources"]["osm"] == "ok (2)"
    assert h.GOOGLE_ATTRIBUTION not in out["attribution"]


def test_a_slow_source_is_named_and_does_not_fail_the_call(fakes: _Fakes, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(h, "SOURCE_TIMEOUT_S", 0.05)
    monkeypatch.setattr(h, "OSM_TIMEOUT_S", 0.05)
    fakes.osm_delay = 1.0
    out = asyncio.run(h.find("Vergennes, VT", 3, None, google_key="k"))
    assert out["success"], out
    assert out["sources"]["osm"] == "timed out"
    assert out["sources"]["google"] == "ok (3)"


def test_a_listing_placed_only_by_its_location_text_is_geocoded_once(fakes: _Fakes) -> None:
    out = asyncio.run(h.find("Vergennes, VT", 10, None))
    names = [s["name"] for s in out["sellers"]]
    assert "Bristol Comb & Creamed Honey" in names
    assert "Monkton Hollow Honey" in names


def test_the_second_call_in_a_day_reads_the_cell_from_memory(fakes: _Fakes) -> None:
    asyncio.run(h.find("Vergennes, VT", 3, None, google_key="k"))
    out = asyncio.run(h.find("Vergennes, VT", 3, None, google_key="k"))
    assert out["sources"]["osm"] == "cached" and out["sources"]["nostr"] == "cached"
    assert out["sources"]["google"] == "ok (3)", "Google is asked every time — its terms allow us to keep nothing"


def test_a_dead_website_is_flagged_when_it_is_needed_to_make_the_count(fakes: _Fakes) -> None:
    fakes.websites_alive = False
    out = asyncio.run(h.find("Vergennes, VT", 2, None))
    assert out["success"]
    assert all("website did not answer" in s["verify"] or "no website" in s["verify"] for s in out["sellers"])


def test_an_unknown_place_is_refused_before_any_source_is_asked(fakes: _Fakes) -> None:
    for near in ("", "95,0", "xyzzy nowhere at all"):
        out = asyncio.run(h.find(near, 3, None))
        assert out == {"success": False, "error_code": "no_location", "error": out["error"]}, near


def test_the_middle_of_the_ocean_is_refused_as_empty(fakes: _Fakes) -> None:
    out = asyncio.run(h.find("0,0", 3, None, google_key="k", usda_key="k"))
    assert out["success"] is False and out["error_code"] == "none_within_radius"
    assert out["sources"]["osm"] == "ok (2)", "the sources answered; nothing they hold is near"


def test_a_source_that_raises_is_named_not_raised(fakes: _Fakes, monkeypatch: pytest.MonkeyPatch) -> None:
    async def boom(origin: Any, key: str, client: Any) -> list[h.Seller]:
        raise httpx.ConnectError("no route")

    monkeypatch.setattr(h, "fetch_google", boom)
    out = asyncio.run(h.find("Vergennes, VT", 3, None, google_key="k"))
    assert out["success"] and out["sources"]["google"] == "failed: ConnectError"


def test_the_overpass_query_asks_for_sellers_not_suppliers() -> None:
    q = h.overpass_query(44.168, -73.252, 100)
    assert '"shop"="honey"' in q and '"craft"="beekeeper"' in q and "around:100000" in q
    assert "beekeeping" not in q

"""Where to buy honey near here.

No single directory of honey sellers exists, so this asks four that each hold a
corner of the answer — the USDA's local-food directories, OpenStreetMap, Google
Places and Nostr classified listings — then merges what they agree on, checks
that each website still answers, and ranks what is left by how sure we are it
sells honey, how complete the listing is, how many sources agree, and how near
it is.

The pure half (parsing, geohash, merging, scoring, picking) is at the top and
is what the tests exercise against recorded replies. The fetchers at the bottom
are thin and each one fails alone: a slow or dead source is named in the answer
and never fails the call.

Two sources need the operator's keys, delivered through Secure Courier like the
BTCPay trio. Without them the search runs on OpenStreetMap and Nostr and says so.

**The patron's position is never inferred from the request.** An MCP call
arrives from the agent's host — often a datacentre — and the web app asks the
browser, with consent, before it sends anything. `near` is what we are told.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import re
import time
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlsplit

import httpx

from beesknees_mcp import __version__

logger = logging.getLogger(__name__)

USER_AGENT = f"beesknees-mcp/{__version__} (https://beesknees.tollbooth-dpyc.com; honey finder)"

#: How long one source may take. The answer is only as slow as the slowest
#: source that answers in time; a slower one is reported, not waited for.
SOURCE_TIMEOUT_S = 4.0
#: Overpass is a shared volunteer service and a 100 km sweep takes it a few
#: seconds on a good day. Measured at 3–6 s for Vergennes; four would lose it.
OSM_TIMEOUT_S = 10.0
#: How long a seller's website may take to say it is still there.
WEBSITE_TIMEOUT_S = 3.0
#: The rings searched outward, in km. The answer names the smallest that holds
#: enough sellers; the largest is the hard edge of "near".
RINGS_KM: tuple[int, ...] = (15, 30, 60, 100)
MAX_RADIUS_KM = RINGS_KM[-1]
#: How far apart two listings may lie and still be one seller.
SAME_PLACE_M = 150.0
#: Scoring: how sure each grade of evidence makes us, and how fast "near" fades.
EVIDENCE_WEIGHT = {"explicit": 1.0, "strong": 0.8, "weak": 0.5}
DISTANCE_SCALE_KM = 25.0
#: How many addresses one call may ask Nominatim to fill. Their policy is one
#: request a second and these run in sequence, so this is also a latency cap.
REVERSE_GEOCODES_PER_CALL = 5
GEOCODES_PER_CALL = 10

CELL_TTL_S = 24 * 3600
WEBSITE_TTL_S = 7 * 24 * 3600

OSM_ATTRIBUTION = "© OpenStreetMap contributors, ODbL 1.0 — https://osm.org/copyright"
USDA_ATTRIBUTION = "USDA Agricultural Marketing Service, Local Food Directories"
GOOGLE_ATTRIBUTION = "Place data © Google"
NOSTR_ATTRIBUTION = "Listings published by their sellers on Nostr (NIP-99)"

NOMINATIM = "https://nominatim.openstreetmap.org"
#: Asked together; the first to answer wins. Two, not every mirror there is —
#: these are volunteer machines and this tool is not a crawler.
OVERPASS_ENDPOINTS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
)
GOOGLE_PLACES = "https://places.googleapis.com/v1/places:searchText"
USDA_PORTAL = "https://www.usdalocalfoodportal.com/api"
#: What the USDA host answers a bare client with is 403; it wants a browser.
USDA_USER_AGENT = "Mozilla/5.0 (compatible; beesknees-mcp honey finder; +https://beesknees.tollbooth-dpyc.com)"

#: NIP-99 hashtags a honey listing is likely to carry.
NOSTR_HONEY_TAGS = ("honey", "rawhoney", "localhoney", "beekeeper", "apiary")

# ─────────────────────────────────────────────────────────────────────────
# The record
# ─────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Seller:
    """One place that sells honey, as far as one or more sources can tell."""

    name: str
    lat: float
    lon: float
    source: str
    #: honey | beekeeper | farm | market | listing
    kind: str = "farm"
    #: explicit — a product list or listing says honey;
    #: strong — a beekeeper or apiary; weak — a farm stand that mentions honey.
    evidence: str = "weak"
    address: str = ""
    postcode: str = ""
    website: str = ""
    phone: str = ""
    #: When the source last touched it (ISO date), if the source says.
    observed: str = ""
    #: Opaque to us; Google's terms allow keeping this and nothing else.
    place_id: str = ""
    sources: tuple[str, ...] = ()
    #: Which source each filled field came from.
    fields_from: dict[str, str] = field(default_factory=dict)
    distance_km: float = 0.0
    bearing: float = 0.0
    #: What a patron should check before driving: a dead link, a missing field.
    verify: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "kind": self.kind,
            "address": self.address,
            "postcode": self.postcode,
            "website": self.website,
            "phone": self.phone,
            "lat": round(self.lat, 5),
            "lon": round(self.lon, 5),
            "distance_km": round(self.distance_km, 1),
            "bearing": compass(self.bearing),
            "bearing_deg": round(self.bearing),
            "honey_evidence": self.evidence,
            "sources": list(self.sources or (self.source,)),
            "fields_from": dict(self.fields_from),
            "observed": self.observed,
            "verify": list(self.verify),
        }


# ─────────────────────────────────────────────────────────────────────────
# Geometry
# ─────────────────────────────────────────────────────────────────────────

_EARTH_KM = 6371.0088


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * _EARTH_KM * math.asin(math.sqrt(a))


def bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Initial bearing from the first point to the second, 0–360."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    x = math.sin(dl) * math.cos(p2)
    y = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


_POINTS = ("N", "NE", "E", "SE", "S", "SW", "W", "NW")


def compass(deg: float) -> str:
    return _POINTS[int(((deg % 360) + 22.5) // 45) % 8]


_GH32 = "0123456789bcdefghjkmnpqrstuvwxyz"


def geohash_encode(lat: float, lon: float, precision: int = 5) -> str:
    lat_lo, lat_hi, lon_lo, lon_hi = -90.0, 90.0, -180.0, 180.0
    out, bits, ch, even = [], 0, 0, True
    while len(out) < precision:
        if even:
            mid = (lon_lo + lon_hi) / 2
            if lon >= mid:
                ch, lon_lo = ch * 2 + 1, mid
            else:
                ch, lon_hi = ch * 2, mid
        else:
            mid = (lat_lo + lat_hi) / 2
            if lat >= mid:
                ch, lat_lo = ch * 2 + 1, mid
            else:
                ch, lat_hi = ch * 2, mid
        even = not even
        bits += 1
        if bits == 5:
            out.append(_GH32[ch])
            bits, ch = 0, 0
    return "".join(out)


def geohash_decode(gh: str) -> tuple[float, float] | None:
    """The centre of the cell, or None for a string that is not a geohash."""
    lat_lo, lat_hi, lon_lo, lon_hi = -90.0, 90.0, -180.0, 180.0
    even = True
    for c in gh.lower():
        idx = _GH32.find(c)
        if idx < 0:
            return None
        for bit in (16, 8, 4, 2, 1):
            if even:
                mid = (lon_lo + lon_hi) / 2
                if idx & bit:
                    lon_lo = mid
                else:
                    lon_hi = mid
            else:
                mid = (lat_lo + lat_hi) / 2
                if idx & bit:
                    lat_lo = mid
                else:
                    lat_hi = mid
            even = not even
    if not gh:
        return None
    return ((lat_lo + lat_hi) / 2, (lon_lo + lon_hi) / 2)


# ─────────────────────────────────────────────────────────────────────────
# Where
# ─────────────────────────────────────────────────────────────────────────

_COORDS = re.compile(r"^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$")


def parse_near(near: str) -> tuple[float, float] | str | None:
    """A pair of coordinates, a place to geocode, or None for nothing usable.

    "44.17,-73.25" is a position. "95,0" looks like one and is off the planet,
    which is not a place name either — it is refused rather than sent to a
    geocoder that might helpfully find a street called "95".
    """
    s = (near or "").strip()
    if not s:
        return None
    m = _COORDS.match(s)
    if m:
        lat, lon = float(m.group(1)), float(m.group(2))
        if -90 <= lat <= 90 and -180 <= lon <= 180:
            return (lat, lon)
        return None
    return s


# ─────────────────────────────────────────────────────────────────────────
# Reading each source
# ─────────────────────────────────────────────────────────────────────────

_HONEY = re.compile(r"\bhoney", re.IGNORECASE)
_BEES = re.compile(r"\b(apiar(?:y|ies)|bee ?keep\w*|bees?|hives?)\b", re.IGNORECASE)
#: Sells bees to beekeepers rather than honey to people — unless it says honey.
_SUPPLIES = re.compile(r"\b(nucs?|queens?|suppl(?:y|ies)|equipment|poultry)\b", re.IGNORECASE)
_PO_BOX = re.compile(r"\bP\.?\s*O\.?\s*Box\b", re.IGNORECASE)
_URL = re.compile(r"https?://[^\s)\]>\"']+", re.IGNORECASE)


def sells_bees_not_honey(name: str, text: str = "", evidence: str = "weak") -> bool:
    """Birdseye Bee's & Poultry sells nucs and queens; it is not a honey stop."""
    if evidence == "explicit":
        return False
    return bool(_SUPPLIES.search(f"{name} {text}"))


def _evidence_from_words(text: str) -> str | None:
    """What a name or description says about honey, or None if nothing."""
    if _HONEY.search(text):
        return "explicit"
    if _BEES.search(text):
        return "strong"
    return None


def _osm_address(t: dict[str, str]) -> tuple[str, str]:
    street = " ".join(x for x in (t.get("addr:housenumber", ""), t.get("addr:street", "")) if x)
    town = t.get("addr:city") or t.get("addr:town") or t.get("addr:village") or ""
    parts = [p for p in (street, town, t.get("addr:state", "")) if p]
    return ", ".join(parts), t.get("addr:postcode", "")


def from_osm(payload: dict[str, Any]) -> list[Seller]:
    """Overpass elements → sellers. `shop=beekeeping` is equipment, not honey."""
    out: list[Seller] = []
    for e in payload.get("elements", []):
        t = e.get("tags") or {}
        name = t.get("name", "").strip()
        if not name:
            continue
        c = e.get("center") or e
        if "lat" not in c or "lon" not in c:
            continue
        shop, craft, produce = t.get("shop", ""), t.get("craft", ""), t.get("produce", "")
        if shop == "honey" or _HONEY.search(produce):
            kind, evidence = ("honey" if shop == "honey" else "farm"), "explicit"
        elif craft == "beekeeper":
            kind, evidence = "beekeeper", "strong"
        elif shop == "beekeeping":
            continue
        else:
            words = _evidence_from_words(f"{name} {t.get('description', '')}")
            if words is None:
                continue
            kind, evidence = "farm", ("weak" if words == "explicit" else words)
        if sells_bees_not_honey(name, t.get("description", ""), evidence):
            continue
        address, postcode = _osm_address(t)
        website = t.get("website") or t.get("contact:website") or ""
        phone = t.get("phone") or t.get("contact:phone") or ""
        observed = (e.get("timestamp") or "")[:10]
        out.append(Seller(
            name=name, lat=float(c["lat"]), lon=float(c["lon"]), source="osm", kind=kind,
            evidence=evidence, address=address, postcode=postcode, website=website,
            phone=phone, observed=observed,
        ))
    return out


def from_google(payload: dict[str, Any]) -> list[Seller]:
    """Places (New) Text Search → sellers. A place that never mentions honey or
    bees in its name is a grocer the search ranked for the word, and is dropped."""
    out: list[Seller] = []
    for p in payload.get("places", []):
        name = ((p.get("displayName") or {}).get("text") or "").strip()
        loc = p.get("location") or {}
        if not name or "latitude" not in loc:
            continue
        evidence = _evidence_from_words(name)
        if evidence is None:
            continue
        kind = "honey" if evidence == "explicit" else "beekeeper"
        if sells_bees_not_honey(name, " ".join(p.get("types") or []), evidence):
            continue
        out.append(Seller(
            name=name, lat=float(loc["latitude"]), lon=float(loc["longitude"]), source="google",
            kind=kind, evidence=evidence, address=p.get("formattedAddress") or "",
            website=p.get("websiteUri") or "", phone=p.get("nationalPhoneNumber") or "",
            place_id=p.get("id") or "",
        ))
    return out


def _first(row: dict[str, Any], *keys: str) -> str:
    for k in keys:
        v = row.get(k)
        if v not in (None, ""):
            return str(v).strip()
    return ""


def from_usda(payload: Any, directory: str) -> list[Seller]:
    """Local Food Portal rows → sellers, keeping only rows that mention honey.

    Field names are read tolerantly: the portal's documentation names
    `listing_name` / `location_x` / `location_y`, its exports say `market_name`
    / `longitude` / `latitude`, and both have changed before.
    """
    rows = payload.get("data", payload) if isinstance(payload, dict) else payload
    if not isinstance(rows, list):
        return []
    kind = "market" if directory == "farmersmarket" else "farm"
    out: list[Seller] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        blob = " ".join(str(v) for v in row.values() if isinstance(v, str))
        if not _HONEY.search(blob):
            continue
        name = _first(row, "listing_name", "market_name", "name")
        lat, lon = _first(row, "location_y", "latitude", "lat"), _first(row, "location_x", "longitude", "lon")
        if not name or not lat or not lon:
            continue
        try:
            la, lo = float(lat), float(lon)
        except ValueError:
            continue
        address = _first(row, "location_address", "address")
        town = ", ".join(x for x in (_first(row, "location_city", "city"), _first(row, "location_state", "state")) if x)
        if town and town.lower() not in address.lower():
            address = ", ".join(x for x in (address, town) if x)
        out.append(Seller(
            name=name, lat=la, lon=lo, source="usda", kind=kind, evidence="explicit",
            address=address, postcode=_first(row, "location_zipcode", "zipcode", "zip"),
            website=_first(row, "media_website", "website"),
            phone=_first(row, "contact_phone", "phone"),
            observed=_first(row, "update_time", "update_date", "updatetime")[:10],
        ))
    return out


def from_nostr(events: list[dict[str, Any]]) -> tuple[list[Seller], list[tuple[str, str]]]:
    """NIP-99 listings → sellers placed by their `g` geohash.

    A listing with only a `location` text is returned separately, as
    (name, text) pairs for the caller to geocode within its budget; one with
    neither cannot be placed and is dropped — it is a shipped good, not a
    place to drive to.
    """
    placed: list[Seller] = []
    to_geocode: list[tuple[str, str]] = []
    for ev in events:
        if ev.get("kind") != 30402:
            continue
        tags: dict[str, list[str]] = {}
        hashtags: list[str] = []
        for t in ev.get("tags") or []:
            if not t:
                continue
            if t[0] == "t" and len(t) > 1:
                hashtags.append(t[1].lower())
            elif len(t) > 1 and t[0] not in tags:
                tags[t[0]] = t[1:]
        if tags.get("status", [""])[0] == "sold":
            continue
        title = tags.get("title", [""])[0].strip()
        if not title:
            continue
        content = ev.get("content") or ""
        if not any(h in NOSTR_HONEY_TAGS for h in hashtags) and _evidence_from_words(f"{title} {content}") != "explicit":
            continue
        url = tags.get("r", [""])[0] or tags.get("website", [""])[0] or ""
        if not url:
            m = _URL.search(content)
            url = m.group(0) if m else ""
        seller = Seller(
            name=title, lat=0.0, lon=0.0, source="nostr", kind="listing", evidence="explicit",
            address=tags.get("location", [""])[0], website=url,
            observed=datetime.fromtimestamp(int(ev.get("created_at", 0) or 0), tz=UTC).date().isoformat(),
        )
        gh = tags.get("g", [""])[0]
        at = geohash_decode(gh) if gh else None
        if at:
            placed.append(replace(seller, lat=at[0], lon=at[1]))
        elif seller.address:
            to_geocode.append((title, seller.address))
            placed.append(seller)  # placed later, by address; dropped if it cannot be
    return placed, to_geocode


# ─────────────────────────────────────────────────────────────────────────
# Merging
# ─────────────────────────────────────────────────────────────────────────

_STOP = {"the", "and", "of", "llc", "inc", "co", "farm", "farms", "market", "honey"}


def _tokens(name: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", name.lower()) if w not in _STOP}


def token_jaccard(a: str, b: str) -> float:
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def domain(url: str) -> str:
    try:
        host = urlsplit(url if "://" in url else f"https://{url}").hostname or ""
    except ValueError:
        return ""
    return host.lower().removeprefix("www.")


def _digits(phone: str) -> str:
    return re.sub(r"\D", "", phone)[-10:]


def same_seller(a: Seller, b: Seller) -> bool:
    """Within 150 m with a similar name, or sharing a website or a phone."""
    if a.website and b.website and domain(a.website) == domain(b.website):
        return True
    if a.phone and b.phone and _digits(a.phone) and _digits(a.phone) == _digits(b.phone):
        return True
    if a.lat and b.lat and haversine_km(a.lat, a.lon, b.lat, b.lon) * 1000 <= SAME_PLACE_M:
        return token_jaccard(a.name, b.name) >= 0.5
    return False


def is_po_box(address: str) -> bool:
    return bool(_PO_BOX.search(address))


def address_quality(address: str) -> int:
    """Nothing < a P.O. box < a town alone < a street somebody can drive to."""
    if not address:
        return 0
    if is_po_box(address):
        return 1
    return 3 if re.search(r"\d", address) else 2


_RANK = {"explicit": 2, "strong": 1, "weak": 0}


def _fold(a: Seller, b: Seller) -> Seller:
    """Two records of one seller → one, each field remembering who gave it."""
    fields_from = dict(a.fields_from) or {}
    chosen: dict[str, Any] = {}
    for f in ("address", "postcode", "website", "phone", "observed", "place_id"):
        av, bv = getattr(a, f), getattr(b, f)
        take_b = (not av and bv) or (f == "address" and address_quality(bv) > address_quality(av))
        chosen[f] = bv if take_b else av
        if take_b:
            fields_from[f] = b.source
        elif av and f not in fields_from:
            fields_from[f] = a.source
    evidence = a.evidence if _RANK[a.evidence] >= _RANK[b.evidence] else b.evidence
    kind = a.kind if _RANK[a.evidence] >= _RANK[b.evidence] else b.kind
    sources = tuple(dict.fromkeys((*(a.sources or (a.source,)), *(b.sources or (b.source,)))))
    return replace(a, evidence=evidence, kind=kind, sources=sources, fields_from=fields_from, **chosen)


def merge(rows: list[Seller]) -> list[Seller]:
    """Fold duplicates across sources. Order of arrival never changes the result
    beyond which row's name is kept: the first seen is the name used."""
    out: list[Seller] = []
    for r in rows:
        r = replace(r, sources=r.sources or (r.source,),
                    fields_from=dict(r.fields_from) or {f: r.source for f in ("address", "postcode", "website", "phone") if getattr(r, f)})
        for i, kept in enumerate(out):
            if same_seller(kept, r):
                out[i] = _fold(kept, r)
                break
        else:
            out.append(r)
    return out


# ─────────────────────────────────────────────────────────────────────────
# Ranking
# ─────────────────────────────────────────────────────────────────────────


def with_distance(s: Seller, origin: tuple[float, float]) -> Seller:
    return replace(
        s,
        distance_km=haversine_km(origin[0], origin[1], s.lat, s.lon),
        bearing=bearing_deg(origin[0], origin[1], s.lat, s.lon),
    )


def completeness(s: Seller) -> float:
    return (0.5 if s.address else 0.0) + (0.5 if s.website else 0.0)


def score(s: Seller) -> float:
    """evidence × completeness × (1 + ½ per extra agreeing source) × e^(−d/25 km).

    A listing with neither address nor website is not worth zero — it is a
    lead — so completeness has a floor.
    """
    agreeing = max(0, len(s.sources or (s.source,)) - 1)
    return (
        EVIDENCE_WEIGHT.get(s.evidence, 0.5)
        * max(0.25, completeness(s))
        * (1 + 0.5 * agreeing)
        * math.exp(-s.distance_km / DISTANCE_SCALE_KM)
    )


def ring_for(sellers: list[Seller], count: int, max_km: float = MAX_RADIUS_KM) -> int | None:
    """The smallest ring that holds `count` sellers; the edge if any lie inside
    it; None when nothing does."""
    inside = [s for s in sellers if s.distance_km <= max_km]
    if not inside:
        return None
    for ring in RINGS_KM:
        if ring > max_km:
            break
        if sum(1 for s in inside if s.distance_km <= ring) >= count:
            return ring
    return int(min(max_km, MAX_RADIUS_KM))


def pick(sellers: list[Seller], count: int, alive: dict[str, bool]) -> list[Seller]:
    """The best `count`, each with an address and a website that answers.

    Fewer than `count` qualify → the rule on the website is relaxed, and each
    listing that got in that way says why it needs checking. The address is
    never relaxed: a seller nobody can drive to is not an answer.
    """
    ranked = sorted((s for s in sellers if s.address), key=score, reverse=True)
    good = [s for s in ranked if s.website and alive.get(s.website, False)]
    if len(good) >= count:
        return good[:count]
    out = list(good)
    for s in ranked:
        if len(out) >= count:
            break
        if s in out:
            continue
        hint = "website did not answer" if s.website else "no website"
        out.append(replace(s, verify=(*s.verify, hint)))
    out.sort(key=score, reverse=True)
    return out


# ─────────────────────────────────────────────────────────────────────────
# A small memory
# ─────────────────────────────────────────────────────────────────────────

_cache: dict[str, tuple[float, Any]] = {}


def _remember(key: str, value: Any) -> Any:
    _cache[key] = (time.monotonic(), value)
    return value


def _recall(key: str, ttl: float) -> Any | None:
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < ttl:
        return hit[1]
    return None


def forget_everything() -> None:
    _cache.clear()


# ─────────────────────────────────────────────────────────────────────────
# Fetchers
# ─────────────────────────────────────────────────────────────────────────


def _client(timeout: float = SOURCE_TIMEOUT_S) -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=timeout, headers={"User-Agent": USER_AGENT}, follow_redirects=True)


async def geocode(place: str, client: httpx.AsyncClient) -> tuple[float, float, str] | None:
    """Nominatim: a place name or postcode → (lat, lon, label). Cached a day."""
    key = f"geo:{place.lower()}"
    if (hit := _recall(key, CELL_TTL_S)) is not None:
        return hit or None
    r = await client.get(f"{NOMINATIM}/search", params={"q": place, "format": "jsonv2", "limit": 1})
    r.raise_for_status()
    rows = r.json()
    if not rows:
        _remember(key, ())
        return None
    row = rows[0]
    found = (float(row["lat"]), float(row["lon"]), row.get("display_name", place))
    return _remember(key, found)


async def reverse(lat: float, lon: float, client: httpx.AsyncClient) -> tuple[str, str]:
    """Nominatim: a point → (street address, postcode). Cached a day."""
    key = f"rev:{lat:.4f},{lon:.4f}"
    if (hit := _recall(key, CELL_TTL_S)) is not None:
        return hit
    r = await client.get(f"{NOMINATIM}/reverse", params={"lat": lat, "lon": lon, "format": "jsonv2"})
    r.raise_for_status()
    a = r.json().get("address") or {}
    street = " ".join(x for x in (a.get("house_number", ""), a.get("road", "")) if x)
    town = a.get("town") or a.get("village") or a.get("city") or a.get("hamlet") or ""
    parts = [p for p in (street, town, a.get("state", "")) if p]
    return _remember(key, (", ".join(parts), a.get("postcode", "")))


def overpass_query(lat: float, lon: float, radius_km: float) -> str:
    r = int(radius_km * 1000)
    around = f"(around:{r},{lat:.5f},{lon:.5f})"
    # Every clause is keyed on an exact tag first; a regex over a whole 100 km
    # circle of `produce=*` was what made the first draft of this time out.
    return (
        f"[out:json][timeout:{int(OSM_TIMEOUT_S)}];("
        f'nwr["shop"="honey"]{around};'
        f'nwr["craft"="beekeeper"]{around};'
        f'nwr["produce"="honey"]{around};'
        f'nwr["shop"="farm"]["name"~"honey|apiar|bee",i]{around};'
        ");out center meta;"
    )


async def _overpass(endpoint: str, query: str, client: httpx.AsyncClient) -> dict[str, Any]:
    r = await client.post(endpoint, data={"data": query}, timeout=OSM_TIMEOUT_S)
    r.raise_for_status()
    payload = r.json()
    # A query that ran out of time comes back 200 with no elements and a
    # remark saying so; that is not "nothing here".
    remark = str(payload.get("remark", ""))
    if "error" in remark.lower():
        raise RuntimeError(remark[:120])
    return payload


async def fetch_osm(origin: tuple[float, float], radius_km: float, client: httpx.AsyncClient) -> list[Seller]:
    """The first Overpass instance to answer. They are volunteer-run and any
    one of them spends part of most days overloaded; measured on 2026-10-08,
    the main instance took 3 s, then 30 s, then nothing, inside one hour."""
    query = overpass_query(origin[0], origin[1], radius_km)
    pending = {asyncio.ensure_future(_overpass(ep, query, client)) for ep in OVERPASS_ENDPOINTS}
    failures: list[BaseException] = []
    try:
        while pending:
            done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                if task.exception() is None:
                    return from_osm(task.result())
                failures.append(task.exception())  # type: ignore[arg-type]
    finally:
        for task in pending:
            task.cancel()
    raise failures[-1] if failures else RuntimeError("no Overpass instance answered")


GOOGLE_QUERIES = ("honey", "apiary", "honey farm stand")
GOOGLE_FIELDS = ",".join(f"places.{f}" for f in (
    "id", "displayName", "formattedAddress", "location", "types", "websiteUri", "nationalPhoneNumber",
))


async def fetch_google(origin: tuple[float, float], key: str, client: httpx.AsyncClient) -> list[Seller]:
    """Three text searches biased to a 50 km circle — the largest Google takes."""
    headers = {"X-Goog-Api-Key": key, "X-Goog-FieldMask": GOOGLE_FIELDS}
    found: list[Seller] = []
    for q in GOOGLE_QUERIES:
        body = {
            "textQuery": q,
            "locationBias": {"circle": {"center": {"latitude": origin[0], "longitude": origin[1]}, "radius": 50000.0}},
            "pageSize": 20,
        }
        r = await client.post(GOOGLE_PLACES, json=body, headers=headers)
        r.raise_for_status()
        found.extend(from_google(r.json()))
    return found


USDA_DIRECTORIES = ("onfarmmarket", "farmersmarket")


async def fetch_usda(origin: tuple[float, float], radius_km: float, key: str, client: httpx.AsyncClient) -> list[Seller]:
    """Both directories in one radius; the portal counts in miles, to 100."""
    miles = min(100, max(1, round(radius_km / 1.609344)))
    found: list[Seller] = []
    for d in USDA_DIRECTORIES:
        r = await client.get(
            f"{USDA_PORTAL}/{d}/",
            params={"apikey": key, "x": origin[1], "y": origin[0], "radius": miles},
            headers={"User-Agent": USDA_USER_AGENT},
        )
        r.raise_for_status()
        found.extend(from_usda(r.json(), d))
    return found


def _nostr_fetch_one(relay_url: str, sub_filter: dict[str, Any]) -> list[dict[str, Any]]:
    """One relay's listings for the filter; a dead relay returns nothing."""
    import websocket  # type: ignore[import-untyped]

    events: list[dict[str, Any]] = []
    try:
        ws = websocket.create_connection(relay_url, timeout=SOURCE_TIMEOUT_S)
        sub = f"honey-{int(time.time() * 1000)}"
        try:
            ws.settimeout(SOURCE_TIMEOUT_S)
            ws.send(json.dumps(["REQ", sub, sub_filter]))
            deadline = time.time() + SOURCE_TIMEOUT_S
            while time.time() < deadline:
                msg = json.loads(ws.recv())
                if msg[0] == "EOSE":
                    break
                if msg[0] == "EVENT" and len(msg) >= 3 and isinstance(msg[2], dict):
                    events.append(msg[2])
            ws.send(json.dumps(["CLOSE", sub]))
        finally:
            ws.close()
    except Exception as exc:  # noqa: BLE001 — one relay's failure is not the source's
        logger.debug("listings from %s failed: %s", relay_url, exc)
    return events


def fetch_nostr_events() -> list[dict[str, Any]]:
    """Every honey listing the fleet's relays hold, deduplicated by event id."""
    from tollbooth.relay_fanout import fan_out
    from tollbooth.relay_registry import get_relays

    flt = {"kinds": [30402], "#t": list(NOSTR_HONEY_TAGS), "limit": 200}
    seen: dict[str, dict[str, Any]] = {}
    # Inside the source's budget, with room to come back: the relays are asked
    # together and the slowest one is left talking to itself.
    for o in fan_out(get_relays(), lambda url: _nostr_fetch_one(url, flt), deadline=SOURCE_TIMEOUT_S - 0.5):
        if o.ok and o.value:
            for ev in o.value:
                seen.setdefault(str(ev.get("id")), ev)
    return list(seen.values())


async def check_website(url: str, client: httpx.AsyncClient) -> bool:
    """Does the site still answer? HEAD, then GET for hosts that refuse HEAD.
    The verdict is kept a week either way."""
    key = f"web:{url}"
    if (hit := _recall(key, WEBSITE_TTL_S)) is not None:
        return hit
    target = url if "://" in url else f"https://{url}"
    alive = False
    try:
        r = await client.head(target, timeout=WEBSITE_TIMEOUT_S)
        if r.status_code in (403, 404, 405, 501) or r.status_code >= 500:
            r = await client.get(target, timeout=WEBSITE_TIMEOUT_S)
        alive = r.status_code < 400
    except (httpx.HTTPError, ValueError) as exc:
        logger.debug("website %s did not answer: %s", url, exc)
    return _remember(key, alive)


# ─────────────────────────────────────────────────────────────────────────
# The answer
# ─────────────────────────────────────────────────────────────────────────


async def _timed(name: str, coro: Any) -> tuple[str, list[Seller] | str]:
    """One source, bounded. Its result or the one-line reason it has none."""
    # The relays are asked inside the source's budget; reading the relay
    # registry the first time in a process (1.4 s measured) is paid on top.
    budget = {"osm": OSM_TIMEOUT_S, "nostr": SOURCE_TIMEOUT_S + 2.0}.get(name, SOURCE_TIMEOUT_S) + 0.5
    try:
        return name, await asyncio.wait_for(coro, budget)
    except TimeoutError:
        return name, "timed out"
    except Exception as exc:  # noqa: BLE001 — named in the answer, never raised
        logger.warning("honey source %s failed: %r", name, exc)
        return name, f"failed: {type(exc).__name__}"


async def find(
    near: str,
    count: int = 3,
    radius_km: float | None = None,
    *,
    google_key: str = "",
    usda_key: str = "",
) -> dict[str, Any]:
    """Three (or `count`) honey sellers near `near`, or a refusal that says why."""
    want = parse_near(near)
    if want is None:
        return {"success": False, "error_code": "no_location",
                "error": "Say where: a place name, a postal code, or 'lat,lon'."}
    edge = float(min(MAX_RADIUS_KM, max(1.0, radius_km or MAX_RADIUS_KM)))
    sources: dict[str, str] = {}
    async with _client() as client:
        if isinstance(want, tuple):
            origin, label = want, f"{want[0]:.4f}, {want[1]:.4f}"
        else:
            try:
                found = await geocode(want, client)
            except (httpx.HTTPError, ValueError) as exc:
                logger.warning("geocoding %r failed: %s", want, exc)
                found = None
            if not found:
                return {"success": False, "error_code": "no_location",
                        "error": f"Nothing on the map answers to {near!r}."}
            origin, label = (found[0], found[1]), found[2]

        cell = geohash_encode(origin[0], origin[1], 5)
        cached = _recall(f"cell:{cell}:{int(edge)}", CELL_TTL_S)
        tasks = []
        if cached is None:
            tasks.append(_timed("osm", fetch_osm(origin, edge, client)))
            tasks.append(_timed("usda", fetch_usda(origin, edge, usda_key, client)) if usda_key
                         else _timed("usda", _skipped()))
            tasks.append(_timed("nostr", asyncio.to_thread(fetch_nostr_events)))
        # Google is asked every time: its terms allow us to keep nothing.
        tasks.append(_timed("google", fetch_google(origin, google_key, client)) if google_key
                     else _timed("google", _skipped()))
        results = await asyncio.gather(*tasks)

        rows: list[Seller] = list(cached or [])
        to_geocode: list[tuple[str, str]] = []
        for name, value in results:
            if isinstance(value, str):
                sources[name] = value
                continue
            if name == "nostr":
                placed, to_geocode = from_nostr(value)  # type: ignore[arg-type]
                value = placed
            sources[name] = f"ok ({len(value)})"
            rows.extend(value)
        if cached is not None:
            sources.update({"osm": "cached", "usda": "cached", "nostr": "cached"})

        # A Nostr listing placed only by its `location` text.
        for title, text in to_geocode[:GEOCODES_PER_CALL]:
            try:
                at = await geocode(text, client)
            except (httpx.HTTPError, ValueError):
                at = None
            rows = [replace(r, lat=at[0], lon=at[1]) if (r.source == "nostr" and r.name == title and at) else r
                    for r in rows]
        rows = [r for r in rows if r.lat or r.lon]

        if cached is None:
            _remember(f"cell:{cell}:{int(edge)}", [r for r in rows if r.source != "google"])

        sellers = [with_distance(s, origin) for s in merge(rows)]
        sellers = [s for s in sellers if s.distance_km <= edge]
        if not sellers:
            return {"success": False, "error_code": "none_within_radius",
                    "error": f"No honey seller is known within {int(edge)} km of {label}.",
                    "origin": {"lat": origin[0], "lon": origin[1], "label": label}, "sources": sources}

        # Fill the gaps the sources left, within a budget that keeps the call quick.
        filled = 0
        for i, s in enumerate(sorted(sellers, key=score, reverse=True)):
            if s.address or filled >= REVERSE_GEOCODES_PER_CALL:
                continue
            try:
                address, postcode = await reverse(s.lat, s.lon, client)
            except (httpx.HTTPError, ValueError):
                continue
            filled += 1
            if address:
                j = sellers.index(s)
                sellers[j] = replace(s, address=address, postcode=s.postcode or postcode,
                                     fields_from={**s.fields_from, "address": "nominatim"})

        urls = sorted({s.website for s in sellers if s.website})
        sem = asyncio.Semaphore(8)

        async def _check(u: str) -> tuple[str, bool]:
            async with sem:
                return u, await check_website(u, client)

        alive = dict(await asyncio.gather(*(_check(u) for u in urls)))

    # Outward until enough QUALIFY — an address and a website that answers —
    # and only if nothing qualifies anywhere does the ring widen on leads alone.
    qualifying = [s for s in sellers if s.address and s.website and alive.get(s.website, False)]
    ring = ring_for(qualifying, count, edge) or ring_for(sellers, count, edge)
    chosen = pick([s for s in sellers if ring is None or s.distance_km <= ring], count, alive)
    if not chosen:
        return {"success": False, "error_code": "none_within_radius",
                "error": f"No honey seller with an address is known within {int(edge)} km of {label}.",
                "origin": {"lat": origin[0], "lon": origin[1], "label": label}, "sources": sources}
    attribution = [OSM_ATTRIBUTION]
    if any("google" in (s.sources or ()) for s in chosen):
        attribution.append(GOOGLE_ATTRIBUTION)
    if any("usda" in (s.sources or ()) for s in chosen):
        attribution.append(USDA_ATTRIBUTION)
    if any("nostr" in (s.sources or ()) for s in chosen):
        attribution.append(NOSTR_ATTRIBUTION)
    return {
        "success": True,
        "near": near,
        "origin": {"lat": round(origin[0], 5), "lon": round(origin[1], 5), "label": label},
        "radius_used_km": ring,
        "coarse": False,
        "sellers": [s.to_dict() for s in chosen],
        "sources": sources,
        "attribution": attribution,
    }


async def _skipped() -> str:
    return "skipped: no key"

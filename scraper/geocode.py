"""Geocode scraped shops with OpenStreetMap Nominatim.

Many listings have an incomplete address (e.g. a US street with no city), so
each shop goes through a cascade of queries and every hit is validated against
the expected country (and state/province for US/Canada):

  1. free-form "<address>, <subregion>, <country>"
  2. structured street + state (+ ZIP if present)
  3. shop name, "<name>, <subregion>, <country>" (must hit an actual POI)
  4. the address with leading comma segments dropped (mall/level/unit names)
  5. the postal code alone
  6. the state/province/country itself

The first building-level hit wins ("address"), then a shop-name POI ("name").
Otherwise the most specific remaining hit is used, ranked by Nominatim's
place_rank: "street" (road, no house number), "city" (town/suburb/postcode),
then "region" (state/country centre).

Results are cached in data/geocache.json so reruns only hit the network for new
queries. Nominatim's usage policy (1 request/second, identifying User-Agent) is
respected.

Input:  data/shops_raw.json
Output: frontend/public/shops.json
"""
from __future__ import annotations

import json
import re
import sys
import time
import unicodedata
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "shops_raw.json"
CACHE = ROOT / "data" / "geocache.json"
OUT = ROOT / "frontend" / "public" / "shops.json"

NOMINATIM = "https://nominatim.openstreetmap.org/search"
HEADERS = {"User-Agent": "ws-store-finder/1.0 (personal map of Weiss Schwarz shops)"}

COUNTRY_CODES = {
    "United States": "us", "Canada": "ca", "Australia": "au", "New Zealand": "nz",
    "Indonesia": "id", "Philippines": "ph", "Singapore": "sg", "Taiwan": "tw",
    "Austria": "at", "Belgium": "be", "Denmark": "dk", "France": "fr", "Germany": "de",
    "Greece": "gr", "Hungary": "hu", "Italy": "it", "Lithuania": "lt", "Netherlands": "nl",
    "Portugal": "pt", "Slovenia": "si", "Spain": "es", "Sweden": "se", "Switzerland": "ch",
    "United Kingdom": "gb", "Chile": "cl", "Colombia": "co", "Costa Rica": "cr",
    "Dominican Republic": "do", "Ecuador": "ec", "Honduras": "hn", "Mexico": "mx", "Peru": "pe",
    "Israel": "il", "United Arab Emirates": "ae", "Saudi Arabia": "sa", "Qatar": "qa",
    "Kuwait": "kw", "Bahrain": "bh", "Oman": "om", "Jordan": "jo", "Lebanon": "lb",
}

# Unit/suite designators that confuse Nominatim. Matches e.g. "Suite # 4",
# "STE N", "Spc 2110", "# 106", "FLOOR 2", "Local 210", "2do Piso", "APT 2".
UNIT_RE = re.compile(
    r"(?:,?\s*\b\d+(?:st|nd|rd|th)\s+(?:floor|level|fl)\b"
    r"|,?\s*\blower level\b"
    r"|,?\s*\b(?:suite|ste|spc|space|unit|shop|apt|apartment|floor|fl|level|lvl|local|bldg|building|room|rm)\b\.?\s*#?\s*[\w-]+"
    r"|,?\s*#\s*[\w-]+"
    r"|,?\s*\b\d+\s*(?:do|er|ro|to|º|°)?\s*piso\b)",
    re.IGNORECASE,
)
US_ZIP_RE = re.compile(r"\b(\d{5})(?:-\d{4})?\s*$")
CA_POSTAL_RE = re.compile(r"\b([A-Z]\d[A-Z])\s?(\d[A-Z]\d)\b", re.I)
TRAILING_POSTAL_RE = re.compile(r"\b(\d{4,6})\s*$")


def clean_address(addr: str) -> str:
    addr = addr.replace(";", ", ")
    addr = re.sub(r"^\s*unit\s+[\w-]+\s*[-/,]\s*", "", addr, flags=re.I)  # "UNIT 22 - 4567 ..."
    addr = re.sub(r"^\s*\d+[A-Za-z]?\s*/\s*(?=\d)", "", addr)  # AU style "10/175 Anketell St"
    addr = UNIT_RE.sub("", addr)
    addr = re.sub(r"^\s*/\s*", "", addr)  # "Level 1/857 George St" -> "857 George St"
    addr = re.sub(r"(\d)([A-Za-z]{3,})", r"\1 \2", addr)  # "5701MOFFATT" -> "5701 MOFFATT"
    return re.sub(r"\s{2,}", " ", addr).strip(" ,")


class Geocoder:
    def __init__(self) -> None:
        self.cache: dict[str, list] = json.loads(CACHE.read_text()) if CACHE.exists() else {}
        self.session = requests.Session()
        self.last = 0.0
        self.calls = 0

    def search(self, **params) -> list:
        params = {k: v for k, v in params.items() if v}
        key = json.dumps(params, sort_keys=True)
        if key in self.cache:
            return self.cache[key]
        wait = 1.1 - (time.monotonic() - self.last)
        if wait > 0:
            time.sleep(wait)
        for attempt in range(4):
            try:
                resp = self.session.get(
                    NOMINATIM,
                    params={**params, "format": "jsonv2", "addressdetails": 1, "limit": 5},
                    headers=HEADERS,
                    timeout=30,
                )
                self.last = time.monotonic()
                if resp.status_code == 429 or resp.status_code >= 500:
                    time.sleep(5 * (attempt + 1))
                    continue
                resp.raise_for_status()
                results = resp.json()
                break
            except requests.RequestException as exc:
                print(f"    ! {exc}", file=sys.stderr)
                time.sleep(5 * (attempt + 1))
        else:
            return []  # don't cache failures
        self.calls += 1
        self.cache[key] = results
        if self.calls % 25 == 0:
            self.save()
        return results

    def save(self) -> None:
        CACHE.write_text(json.dumps(self.cache, ensure_ascii=False))


def fold(text: str) -> str:
    """Lowercase and strip accents, so "Québec" matches "Quebec"."""
    return "".join(
        c for c in unicodedata.normalize("NFD", text) if unicodedata.category(c) != "Mn"
    ).lower()


def matches_region(hit: dict, shop: dict) -> bool:
    if not shop["subregion"]:
        return True
    addr = hit.get("address", {})
    want = fold(shop["subregion"])
    return any(want == fold(addr.get(k) or "") for k in ("state", "province", "region"))


# Most specific first; a hit's precision comes from Nominatim's place_rank
# (30 = building/POI, 26-27 = road, 13-25 = locality/postcode, lower = region).
PRECISIONS = ["address", "name", "street", "city", "region"]


def precision_of(hit: dict) -> str:
    rank = int(hit.get("place_rank") or 0)
    if rank >= 28:
        return "address"
    if rank >= 26:
        return "street"
    if rank >= 13:
        return "city"
    return "region"


def postal_code(addr: str, cc: str | None) -> str | None:
    if cc == "ca":
        m = CA_POSTAL_RE.search(addr)
        return f"{m.group(1)} {m.group(2)}".upper() if m else None
    m = TRAILING_POSTAL_RE.search(addr)
    return m.group(1) if m else None


def geocode(g: Geocoder, shop: dict) -> tuple[float, float, str] | None:
    cc = COUNTRY_CODES.get(shop["country"])
    place = ", ".join(p for p in (shop["subregion"], shop["country"]) if p)
    raw = shop["address"].strip()
    addr = clean_address(raw)
    # Some addresses already end with the country ("..., Holbæk, Denmark").
    if fold(addr).rstrip(" ,").endswith(fold(shop["country"])):
        addr = addr.rstrip(" ,")[: -len(shop["country"])].rstrip(" ,")
    with_place = lambda a: f"{a}, {place}"  # noqa: E731

    attempts = []
    if addr:
        attempts.append(("addr", {"q": with_place(addr), "countrycodes": cc}))
        if raw != addr:
            attempts.append(("addr", {"q": with_place(raw), "countrycodes": cc}))
        if shop["subregion"]:
            zip_m = US_ZIP_RE.search(addr) if cc == "us" else None
            street = US_ZIP_RE.sub("", addr).strip(" ,") if zip_m else addr
            attempts.append(("addr", {
                "street": street.split(",")[0], "state": shop["subregion"],
                "postalcode": zip_m.group(1) if zip_m else None, "countrycodes": cc,
            }))
    attempts.append(("name", {"q": f"{shop['name']}, {place}", "countrycodes": cc}))
    # Mall/level/unit prefixes often defeat the full query; the trailing
    # segments usually still name the street or at least the city.
    parts = [p.strip() for p in addr.split(",") if p.strip()]
    for i in range(1, min(len(parts), 4)):
        attempts.append(("addr", {"q": with_place(", ".join(parts[i:])), "countrycodes": cc}))
    postal = postal_code(addr, cc)
    if postal:
        attempts.append(("addr", {"postalcode": postal, "countrycodes": cc}))
    attempts.append(("addr", {"q": place, "countrycodes": cc}))

    best, best_precision = None, None
    for kind, params in attempts:
        for hit in g.search(**params):
            if not matches_region(hit, shop):
                continue
            precision = precision_of(hit)
            if kind == "name":
                if precision != "address":
                    continue  # a town that shares the shop's name is not the shop
                precision = "name"
            if precision in ("address", "name"):
                return float(hit["lat"]), float(hit["lon"]), precision
            if best is None or PRECISIONS.index(precision) < PRECISIONS.index(best_precision):
                best, best_precision = hit, precision
            break
    if best:
        return float(best["lat"]), float(best["lon"]), best_precision
    return None


def main() -> None:
    shops = json.loads(RAW.read_text())
    g = Geocoder()
    out, missing = [], []
    try:
        for i, shop in enumerate(shops, 1):
            res = geocode(g, shop)
            if res is None:
                missing.append(shop)
                print(f"[{i}/{len(shops)}] MISSING {shop['name']} — {shop['address']}", file=sys.stderr)
                continue
            lat, lon, precision = res
            out.append({**shop, "lat": round(lat, 6), "lon": round(lon, 6), "precision": precision})
            if i % 20 == 0 or precision != "address":
                print(f"[{i}/{len(shops)}] {precision:8} {shop['name']}", file=sys.stderr)
    finally:
        g.save()

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    counts: dict[str, int] = {}
    for s in out:
        counts[s["precision"]] = counts.get(s["precision"], 0) + 1
    print(f"Wrote {len(out)} shops to {OUT} ({counts}); {len(missing)} not geocoded", file=sys.stderr)


if __name__ == "__main__":
    main()

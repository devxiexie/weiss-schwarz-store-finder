"""Scrape Weiß Schwarz shop listings from https://en.ws-tcg.com/shops/.

The index page links to one page per region (USA, Canada, Europe, ...). Each
region page groups shops under `.country-Wrapper` sections (a US state, a
Canadian province, or a country), and each shop is a `.shop-Data-Container`
with a name plus <dl> rows for Address / Website / TEL.

Output: data/shops_raw.json
"""
from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path
from urllib.parse import urldefrag, urljoin

import requests
from bs4 import BeautifulSoup

INDEX_URL = "https://en.ws-tcg.com/shops/"
# The site returns a 404 page to non-browser user agents.
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"
    )
}
OUT = Path(__file__).resolve().parent.parent / "data" / "shops_raw.json"

# Region pages whose sections are sub-national (state/province) rather than countries.
SUBNATIONAL = {"usa": "United States", "canada": "Canada"}


def fetch(session: requests.Session, url: str) -> BeautifulSoup:
    resp = session.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    return BeautifulSoup(resp.text, "lxml")


def region_urls(index: BeautifulSoup) -> list[str]:
    urls: list[str] = []
    for a in index.select("a[href]"):
        url, _ = urldefrag(urljoin(INDEX_URL, a["href"]))
        if re.fullmatch(r"https://en\.ws-tcg\.com/shops/[\w-]+/", url) and url not in urls:
            urls.append(url)
    return urls


def text(el) -> str:
    return re.sub(r"\s+", " ", el.get_text(" ", strip=True)).strip() if el else ""


def parse_region(soup: BeautifulSoup, slug: str) -> list[dict]:
    region_title = text(soup.select_one(".country_Head")) or slug
    shops = []
    for section in soup.select(".country-Wrapper"):
        section_name = text(section.select_one(".country-name")) or section.get("id", "")
        if slug in SUBNATIONAL:
            country, subregion = SUBNATIONAL[slug], section_name
        else:
            country, subregion = section_name, ""
        for box in section.select(".shop-Data-Container"):
            fields = {}
            for dl in box.find_all("dl"):
                key = text(dl.find("dt")).lower()
                dd = dl.find("dd")
                link = dd.find("a", href=True) if dd else None
                fields[key] = link["href"].strip() if (key == "website" and link) else text(dd)
            shops.append(
                {
                    "name": text(box.select_one(".shop-name")),
                    "address": fields.get("address", ""),
                    "website": fields.get("website", ""),
                    "phone": fields.get("tel", ""),
                    "region": region_title,
                    "country": country,
                    "subregion": subregion,
                }
            )
    return shops


def main() -> None:
    session = requests.Session()
    urls = region_urls(fetch(session, INDEX_URL))
    print(f"Found {len(urls)} region pages", file=sys.stderr)
    shops: list[dict] = []
    for url in urls:
        slug = url.rstrip("/").rsplit("/", 1)[-1]
        found = parse_region(fetch(session, url), slug)
        print(f"  {slug:15} {len(found):4} shops", file=sys.stderr)
        shops.extend(found)
        time.sleep(1)  # be polite

    for i, shop in enumerate(shops):
        shop["id"] = i
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(shops, ensure_ascii=False, indent=2))
    print(f"Wrote {len(shops)} shops to {OUT}", file=sys.stderr)


if __name__ == "__main__":
    main()

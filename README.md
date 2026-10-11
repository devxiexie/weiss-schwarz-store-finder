# Weiss Schwarz Store Finder

An interactive map of the official Weiß Schwarz retailers listed at
<https://en.ws-tcg.com/shops/>, which publishes the list as text only.

- **Search** stores by name, street, city, state, or country, and filter by country
- **Nearest store lookup**: type an address/city/ZIP, use your browser location, or
  pick a point on the map. Results are sorted by great-circle (haversine) distance,
  the map frames you and your closest stores, and a line points to the nearest one.
- Clustered markers on OpenStreetMap tiles, with popups showing address, phone, website,
  distance, and a directions link
- km / mi toggle (defaults by locale)

## How it works

```
en.ws-tcg.com/shops/*  ──scrape.py──▶  data/shops_raw.json  ──geocode.py──▶  frontend/public/shops.json  ──▶  React + Leaflet
   (BeautifulSoup)                                           (OSM Nominatim)
```

1. **`scraper/scrape.py`** finds each region page linked from the shops index and parses
   every `.shop-Data-Container` (name, address, website, phone) along with its state /
   province / country section.
2. **`scraper/geocode.py`** turns addresses into coordinates with OpenStreetMap's
   Nominatim. Many listings omit the city, so it runs a cascade of queries (full address,
   suite-stripped address, structured street+state+ZIP, the shop's name as an OSM point of
   interest, the address minus leading mall/unit segments, then the postal code) and
   rejects hits outside the expected state/country. Each shop gets a `precision`, based on
   Nominatim's `place_rank`:
   - `address` / `name` — pinned to the building or the shop's own OSM entry
   - `street` — matched the street only (no house number), so possibly the right street in
     the wrong town
   - `city` — matched the town, suburb, or postal code
   - `region` — nothing more specific matched, so it sits at the state/country centre

   Approximate pins (anything except `address`/`name`) are drawn hollow and tagged
   "approx." in the list. `region` pins are left out of nearest-store ranking and listed
   last with an unknown distance, since a state centroid says nothing about real distance.
   Responses are cached in `data/geocache.json`, so reruns are quick and only new shops
   hit the network. Nominatim's 1 request/second limit is respected, so a cold run takes
   about 45 minutes.
3. **`frontend/`** is a Vite + React app using react-leaflet and react-leaflet-cluster.
   It loads `shops.json` at startup; all searching and distance math happen in the
   browser.

## Running it

```bash
# 1. Scrape + geocode (Python 3.10+)
python3 -m venv .venv
.venv/bin/pip install -r scraper/requirements.txt
.venv/bin/python scraper/scrape.py
.venv/bin/python scraper/geocode.py

# 2. Frontend
cd frontend
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in frontend/dist/
```

To refresh the data later, rerun both Python scripts; cached geocodes are reused.

## Notes

- en.ws-tcg.com returns a 404 page to non-browser user agents, so the scraper sends a
  browser-like `User-Agent`.
- The "City, address, or ZIP" box geocodes through Nominatim only when you submit it,
  per the Nominatim usage policy (no autocomplete).
- Map data © OpenStreetMap contributors.

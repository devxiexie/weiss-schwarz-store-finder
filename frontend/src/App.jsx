import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Sidebar from './components/Sidebar.jsx'
import StoreMap from './components/StoreMap.jsx'
import { defaultUnit, haversineKm, normalize } from './geo.js'

export default function App() {
  const [shops, setShops] = useState([])
  const [loadError, setLoadError] = useState(null)
  const [query, setQuery] = useState('')
  const [country, setCountry] = useState('')
  const [origin, setOrigin] = useState(null)
  const [unit, setUnit] = useState(defaultUnit)
  const [selectedId, setSelectedId] = useState(null)
  const [picking, setPicking] = useState(false)
  const mapApi = useRef(null)

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}shops.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`Could not load shops.json (${res.status})`)
        return res.json()
      })
      .then((data) =>
        setShops(
          data.map((s) => ({
            ...s,
            searchText: normalize(
              [s.name, s.address, s.subregion, s.country, s.region].join(' '),
            ),
          })),
        ),
      )
      .catch((err) => setLoadError(err.message))
  }, [])

  const countries = useMemo(() => {
    const counts = new Map()
    for (const s of shops) counts.set(s.country, (counts.get(s.country) || 0) + 1)
    return [...counts].sort((a, b) => a[0].localeCompare(b[0]))
  }, [shops])

  // Shops matching the text search and country filter. Every whitespace-separated
  // term must appear somewhere in the shop's name/address/region.
  const filtered = useMemo(() => {
    const terms = normalize(query).split(/\s+/).filter(Boolean)
    return shops.filter(
      (s) =>
        (!country || s.country === country) &&
        terms.every((t) => s.searchText.includes(t)),
    )
  }, [shops, query, country])

  // With an origin set, attach distances and sort nearest-first. Shops only
  // placed at a state/country centre have no meaningful distance, so they go
  // last instead of masquerading as nearby.
  const results = useMemo(() => {
    if (!origin) {
      return [...filtered].sort((a, b) => a.name.localeCompare(b.name))
    }
    return filtered
      .map((s) => ({
        ...s,
        distanceKm: s.precision === 'region' ? Infinity : haversineKm(origin, s),
      }))
      .sort((a, b) => a.distanceKm - b.distanceKm || a.name.localeCompare(b.name))
  }, [filtered, origin])

  const selectShop = useCallback((shop) => {
    setSelectedId(shop.id)
    mapApi.current?.focusShop(shop.id)
  }, [])

  const handleOrigin = useCallback((point) => {
    setOrigin(point)
    setSelectedId(null)
    setPicking(false)
  }, [])

  return (
    <div className="app">
      <Sidebar
        loading={!shops.length && !loadError}
        loadError={loadError}
        total={shops.length}
        query={query}
        onQuery={setQuery}
        country={country}
        countries={countries}
        onCountry={setCountry}
        origin={origin}
        onOrigin={handleOrigin}
        picking={picking}
        onPicking={setPicking}
        unit={unit}
        onUnit={setUnit}
        results={results}
        selectedId={selectedId}
        onSelect={selectShop}
      />
      <StoreMap
        ref={mapApi}
        shops={filtered}
        nearest={origin ? results.slice(0, 5).filter((s) => s.distanceKm !== Infinity) : []}
        origin={origin}
        unit={unit}
        selectedId={selectedId}
        onSelect={setSelectedId}
        picking={picking}
        onPick={(latlng) =>
          handleOrigin({ lat: latlng.lat, lon: latlng.lng, label: 'Pinned location' })
        }
      />
    </div>
  )
}

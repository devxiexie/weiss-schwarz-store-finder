import { useState } from 'react'
import { formatDistance, geocodePlace, getBrowserLocation } from '../geo.js'

const PAGE_SIZE = 100

function OriginControls({ origin, onOrigin, picking, onPicking }) {
  const [place, setPlace] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function run(task) {
    setBusy(true)
    setError(null)
    try {
      const point = await task()
      if (point) onOrigin(point)
      else setError('No match for that place — try adding a city or country.')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel">
      <h2 className="panel__title">Find the nearest store</h2>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault()
          if (place.trim()) run(() => geocodePlace(place.trim()))
        }}
      >
        <input
          type="search"
          placeholder="City, address, or ZIP"
          value={place}
          onChange={(e) => setPlace(e.target.value)}
          aria-label="Your location"
        />
        <button type="submit" disabled={busy || !place.trim()}>
          Go
        </button>
      </form>
      <div className="row">
        <button type="button" className="secondary" disabled={busy} onClick={() => run(getBrowserLocation)}>
          Use my location
        </button>
        <button
          type="button"
          className={`secondary${picking ? ' active' : ''}`}
          aria-pressed={picking}
          onClick={() => onPicking(!picking)}
        >
          {picking ? 'Click the map…' : 'Pick on map'}
        </button>
      </div>
      {busy && <p className="muted small">Locating…</p>}
      {error && <p className="error small">{error}</p>}
      {origin && (
        <p className="origin small">
          <span className="origin__label" title={origin.label}>
            From: {origin.label}
          </span>
          <button type="button" className="link" onClick={() => onOrigin(null)}>
            Clear
          </button>
        </p>
      )}
    </section>
  )
}

function ShopItem({ shop, unit, selected, onSelect }) {
  const approx = !['address', 'name'].includes(shop.precision)
  return (
    <li>
      <button
        type="button"
        className={`shop${selected ? ' shop--selected' : ''}`}
        onClick={() => onSelect(shop)}
      >
        <span className="shop__top">
          <span className="shop__name">{shop.name}</span>
          {shop.distanceKm === Infinity ? (
            <span className="shop__distance muted" title="Address could not be pinned precisely">
              ? {unit}
            </span>
          ) : (
            shop.distanceKm != null && (
              <span className="shop__distance">{formatDistance(shop.distanceKm, unit)}</span>
            )
          )}
        </span>
        <span className="shop__addr">{shop.address}</span>
        <span className="shop__meta">
          {[shop.subregion, shop.country].filter(Boolean).join(', ')}
          {approx && (
            <span className="badge" title="Map position is approximate">
              approx.
            </span>
          )}
        </span>
      </button>
    </li>
  )
}

export default function Sidebar({
  loading,
  loadError,
  total,
  query,
  onQuery,
  country,
  countries,
  onCountry,
  origin,
  onOrigin,
  picking,
  onPicking,
  unit,
  onUnit,
  results,
  selectedId,
  onSelect,
}) {
  const [limit, setLimit] = useState(PAGE_SIZE)
  const visible = results.slice(0, limit)

  return (
    <aside className="sidebar">
      <header className="sidebar__header">
        <h1>Weiß Schwarz Store Finder</h1>
        <p className="muted small">
          {total ? `${total} official retailers` : 'Official retailers'} from{' '}
          <a href="https://en.ws-tcg.com/shops/" target="_blank" rel="noreferrer">
            en.ws-tcg.com
          </a>
        </p>
      </header>

      <OriginControls origin={origin} onOrigin={onOrigin} picking={picking} onPicking={onPicking} />

      <section className="panel">
        <div className="row">
          <input
            type="search"
            placeholder="Search stores, streets, states…"
            value={query}
            onChange={(e) => {
              onQuery(e.target.value)
              setLimit(PAGE_SIZE)
            }}
            aria-label="Search stores"
          />
        </div>
        <div className="row">
          <select
            value={country}
            onChange={(e) => {
              onCountry(e.target.value)
              setLimit(PAGE_SIZE)
            }}
            aria-label="Filter by country"
          >
            <option value="">All countries</option>
            {countries.map(([name, n]) => (
              <option key={name} value={name}>
                {name} ({n})
              </option>
            ))}
          </select>
          <div className="toggle" role="group" aria-label="Distance unit">
            {['km', 'mi'].map((u) => (
              <button
                key={u}
                type="button"
                className={unit === u ? 'active' : ''}
                aria-pressed={unit === u}
                onClick={() => onUnit(u)}
              >
                {u}
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="results">
        {loading && <p className="muted pad">Loading stores…</p>}
        {loadError && <p className="error pad">{loadError}</p>}
        {!loading && !loadError && (
          <p className="results__count muted small">
            {results.length} {results.length === 1 ? 'store' : 'stores'}
            {origin ? ', nearest first' : ''}
          </p>
        )}
        {!loading && !loadError && results.length === 0 && (
          <p className="muted pad">No stores match your search.</p>
        )}
        <ul className="shop-list">
          {visible.map((shop) => (
            <ShopItem
              key={shop.id}
              shop={shop}
              unit={unit}
              selected={shop.id === selectedId}
              onSelect={onSelect}
            />
          ))}
        </ul>
        {results.length > limit && (
          <button type="button" className="secondary more" onClick={() => setLimit(limit + PAGE_SIZE)}>
            Show more ({results.length - limit} remaining)
          </button>
        )}
      </div>
    </aside>
  )
}

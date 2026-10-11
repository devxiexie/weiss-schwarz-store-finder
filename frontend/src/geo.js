const EARTH_RADIUS_KM = 6371.0088
const KM_PER_MILE = 1.609344

const toRad = (deg) => (deg * Math.PI) / 180

/** Great-circle distance in kilometres between two {lat, lon} points. */
export function haversineKm(a, b) {
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h))
}

export function formatDistance(km, unit) {
  const value = unit === 'mi' ? km / KM_PER_MILE : km
  const digits = value < 10 ? 1 : 0
  return `${value.toFixed(digits)} ${unit}`
}

/** Locales that conventionally use miles. */
export function defaultUnit() {
  const region = (navigator.language || 'en-US').split('-')[1]
  return ['US', 'GB', 'LR', 'MM'].includes(region) ? 'mi' : 'km'
}

/**
 * Geocode a free-text place with Nominatim. Called only on explicit submit,
 * per the Nominatim usage policy (no autocomplete).
 */
export async function geocodePlace(query) {
  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.search = new URLSearchParams({ q: query, format: 'jsonv2', limit: '1' })
  const res = await fetch(url, { headers: { 'Accept-Language': 'en' } })
  if (!res.ok) throw new Error(`Geocoding failed (${res.status})`)
  const [hit] = await res.json()
  if (!hit) return null
  return { lat: Number(hit.lat), lon: Number(hit.lon), label: hit.display_name }
}

export function getBrowserLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by this browser'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, label: 'Your location' }),
      (err) => reject(new Error(err.message || 'Could not get your location')),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    )
  })
}

/** Lowercased, accent-stripped text for forgiving search matching. */
export function normalize(text) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

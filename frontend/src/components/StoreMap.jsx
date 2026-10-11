import { useEffect, useImperativeHandle, useRef } from 'react'
import L from 'leaflet'
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
import { formatDistance, haversineKm } from '../geo.js'

// Pins whose geocode only matched the street, city, or region are drawn
// hollow so it's clear the location is approximate.
const EXACT = new Set(['address', 'name'])

const pinIcon = (exact, selected) =>
  L.divIcon({
    className: '',
    html: `<span class="pin${exact ? '' : ' pin--approx'}${selected ? ' pin--selected' : ''}"></span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 22],
    popupAnchor: [0, -20],
  })

const ICONS = {
  exact: pinIcon(true, false),
  approx: pinIcon(false, false),
  exactSelected: pinIcon(true, true),
  approxSelected: pinIcon(false, true),
}

const originIcon = L.divIcon({
  className: '',
  html: '<span class="origin-dot"></span>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
})

function iconFor(shop, selected) {
  const exact = EXACT.has(shop.precision)
  if (selected) return exact ? ICONS.exactSelected : ICONS.approxSelected
  return exact ? ICONS.exact : ICONS.approx
}

const PRECISION_NOTE = {
  street: 'Approximate: matched the street only',
  city: 'Approximate: placed in the right town, not at the building',
  region: 'Approximate: placed at the state/country centre — check the address',
}

function directionsUrl(shop, origin) {
  if (origin) {
    const route = `${origin.lat},${origin.lon};${shop.lat},${shop.lon}`
    return `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${encodeURIComponent(route)}`
  }
  return `https://www.openstreetmap.org/?mlat=${shop.lat}&mlon=${shop.lon}#map=17/${shop.lat}/${shop.lon}`
}

function ShopPopup({ shop, origin, unit }) {
  const place = [shop.subregion, shop.country].filter(Boolean).join(', ')
  return (
    <div className="popup">
      <strong className="popup__name">{shop.name}</strong>
      <div>{shop.address}</div>
      <div className="muted">{place}</div>
      {shop.phone && (
        <div>
          <a href={`tel:${shop.phone.replace(/[^\d+]/g, '')}`}>{shop.phone}</a>
        </div>
      )}
      {shop.website && (
        <div className="popup__link">
          <a href={shop.website} target="_blank" rel="noreferrer">
            {shop.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
          </a>
        </div>
      )}
      {origin && shop.precision !== 'region' && (
        <div className="popup__distance">
          {formatDistance(haversineKm(origin, shop), unit)} away
        </div>
      )}
      {PRECISION_NOTE[shop.precision] && (
        <div className="popup__warn">{PRECISION_NOTE[shop.precision]}</div>
      )}
      <a href={directionsUrl(shop, origin)} target="_blank" rel="noreferrer">
        {origin ? 'Directions →' : 'Open in OpenStreetMap →'}
      </a>
    </div>
  )
}

/** Frames the origin together with its nearest few shops whenever the origin changes. */
function FitToOrigin({ origin, nearest }) {
  const map = useMap()
  const nearestRef = useRef(nearest)
  useEffect(() => {
    nearestRef.current = nearest
  })
  useEffect(() => {
    if (!origin) return
    const points = [[origin.lat, origin.lon], ...nearestRef.current.slice(0, 3).map((s) => [s.lat, s.lon])]
    map.flyToBounds(L.latLngBounds(points).pad(0.25), { maxZoom: 14, duration: 0.8 })
  }, [map, origin])
  return null
}

function PickHandler({ picking, onPick }) {
  const map = useMapEvents({
    click(e) {
      if (picking) onPick(e.latlng)
    },
  })
  useEffect(() => {
    map.getContainer().classList.toggle('map--picking', picking)
  }, [map, picking])
  return null
}

export default function StoreMap({ ref, shops, nearest, origin, unit, selectedId, onSelect, picking, onPick }) {
  const clusterRef = useRef(null)
  const markers = useRef(new Map())

  useImperativeHandle(ref, () => ({
    focusShop(id) {
      const marker = markers.current.get(id)
      const cluster = clusterRef.current
      if (!marker || !cluster) return
      cluster.zoomToShowLayer(marker, () => marker.openPopup())
    },
  }))

  const closest = nearest[0]

  return (
    <MapContainer
      className="map"
      center={[30, -40]}
      zoom={3}
      minZoom={2}
      worldCopyJump
      zoomControl
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      <PickHandler picking={picking} onPick={onPick} />
      <FitToOrigin origin={origin} nearest={nearest} />

      <MarkerClusterGroup ref={clusterRef} chunkedLoading maxClusterRadius={50} showCoverageOnHover={false}>
        {shops.map((shop) => (
          <Marker
            key={shop.id}
            position={[shop.lat, shop.lon]}
            icon={iconFor(shop, shop.id === selectedId)}
            title={shop.name}
            ref={(m) => {
              if (m) markers.current.set(shop.id, m)
              else markers.current.delete(shop.id)
            }}
            eventHandlers={{ click: () => onSelect(shop.id) }}
          >
            <Popup>
              <ShopPopup shop={shop} origin={origin} unit={unit} />
            </Popup>
          </Marker>
        ))}
      </MarkerClusterGroup>

      {origin && (
        <Marker position={[origin.lat, origin.lon]} icon={originIcon} zIndexOffset={1000}>
          <Popup>{origin.label}</Popup>
        </Marker>
      )}
      {origin && closest && (
        <Polyline
          positions={[
            [origin.lat, origin.lon],
            [closest.lat, closest.lon],
          ]}
          pathOptions={{ className: 'nearest-line', weight: 3, dashArray: '6 8' }}
        />
      )}
    </MapContainer>
  )
}

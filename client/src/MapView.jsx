import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Leaflet's default marker images break under Vite, so we draw our own round pins (no image files needed).
const pin = (label, color) => L.divIcon({
  className: 'fc-pin',
  html: `<span style="background:${color}">${label}</span>`,
  iconSize: [44, 44],
  iconAnchor: [22, 22],
});
const YOU = pin('You', '#ffb800'), MECH = pin('Mech', '#3df5ff');
const DEFAULT_CENTER = [14.5995, 120.9842];

// Keeps the map correctly sized even if its container was hidden or animated when it first rendered.
function SizeFix() {
  const map = useMap();
  useEffect(() => {
    const fix = () => map.invalidateSize();
    const t = setTimeout(fix, 250);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fix) : null;
    ro?.observe(map.getContainer());
    return () => { clearTimeout(t); ro?.disconnect(); };
  }, [map]);
  return null;
}

// <MapContainer center> is only read once, so move/zoom the map ourselves when the points change.
function Fit({ points }) {
  const map = useMap(), key = points.map(p => p.join()).join('|');
  useEffect(() => {
    if (!points.length) return;
    if (points.length > 1) { if (!points.every(p => map.getBounds().contains(p))) map.fitBounds(points, { padding: [60, 60], maxZoom: 16 }); }
    else if (!map.getBounds().contains(points[0])) map.setView(points[0], Math.max(map.getZoom(), 14));
  }, [key, map]);
  return null;
}

function Picker({ onPick }) {
  useMapEvents({ click: e => onPick({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

// pin = { lat, lng }   mechanic = { lat, lng }   radiusKm = number   onPick = ({ lat, lng }) => void (click to move the pin)
export default function MapView({ pin: p, mechanic, radiusKm, onPick, markers = [] }) {
  const a = p && Number.isFinite(p.lat) && Number.isFinite(p.lng) ? [p.lat, p.lng] : null;
  const b = mechanic && Number.isFinite(mechanic.lat) ? [mechanic.lat, mechanic.lng] : null;
  return (
    <div className="map">
      <MapContainer center={a || DEFAULT_CENTER} zoom={14} scrollWheelZoom={false} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <SizeFix />
        <Fit points={[a, b].filter(Boolean)} />
        {onPick && <Picker onPick={onPick} />}
        {a && <Marker position={a} icon={YOU} />}
        {a && radiusKm > 0 && <Circle center={a} radius={radiusKm * 1000} pathOptions={{ color: '#0a8cab', fillColor: '#3df5ff', fillOpacity: 0.15, weight: 2 }} />}
        {b && <Marker position={b} icon={MECH} />}
        {markers.map((m, i) => <Marker key={i} position={m.position} icon={YOU}>{m.popupText && <Popup>{m.popupText}</Popup>}</Marker>)}
      </MapContainer>
    </div>
  );
}
import { useEffect, useRef, useState } from 'react';
const KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY;
const DARK = [{ elementType: 'geometry', stylers: [{ color: '#0d1424' }] }, { elementType: 'labels.text.fill', stylers: [{ color: '#8d9bb5' }] }, { elementType: 'labels.text.stroke', stylers: [{ color: '#0d1424' }] }, { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#26324d' }] }, { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#050a14' }] }, { featureType: 'poi', stylers: [{ visibility: 'off' }] }];
let loading;
const load = () => loading ??= new Promise(ok => {
  if (window.google?.maps) return ok();
  const s = document.createElement('script');
  s.src = `https://maps.googleapis.com/maps/api/js?key=${KEY}`; s.onload = ok; document.head.append(s);
});

export default function MapView({ pin, mechanic, radiusKm, onPick }) {
  const el = useRef(), g = useRef({}), [ready, setReady] = useState(false);
  useEffect(() => {
    if (!KEY) return;
    load().then(() => {
      g.current.map = new google.maps.Map(el.current, { center: pin || { lat: 14.5995, lng: 120.9842 }, zoom: 14, disableDefaultUI: true, zoomControl: true, styles: DARK });
      if (onPick) g.current.map.addListener('click', e => onPick({ lat: e.latLng.lat(), lng: e.latLng.lng() }));
      setReady(true);
    });
  }, []);
  useEffect(() => {
    if (!ready) return;
    const { map } = g.current, G = google.maps;
    ['pin', 'mech', 'circle'].forEach(k => g.current[k]?.setMap(null));
    if (pin) {
      g.current.pin = new G.Marker({ map, position: pin, label: 'You' }); map.panTo(pin);
      if (radiusKm) g.current.circle = new G.Circle({ map, center: pin, radius: radiusKm * 1000, strokeColor: '#3df5ff', fillColor: '#3df5ff', fillOpacity: 0.15 });
    }
    if (mechanic) g.current.mech = new G.Marker({ map, position: mechanic, label: 'Mechanic' });
  }, [ready, pin?.lat, pin?.lng, radiusKm, mechanic?.lat, mechanic?.lng]);

  if (!KEY) return (
    <div className="nomap">
      <small>Map is off. Set VITE_GOOGLE_MAPS_KEY in client/.env to enable Google Maps.</small>
      {onPick
        ? <div className="coords"><input type="number" step="any" placeholder="Latitude" value={pin?.lat ?? ''} onChange={e => onPick({ lat: +e.target.value, lng: pin?.lng ?? 0 })} />
            <input type="number" step="any" placeholder="Longitude" value={pin?.lng ?? ''} onChange={e => onPick({ lat: pin?.lat ?? 0, lng: +e.target.value })} /></div>
        : <small>Mechanic position: {mechanic ? `${mechanic.lat.toFixed(4)}, ${mechanic.lng.toFixed(4)}` : 'not shared yet'}</small>}
    </div>);
  return <div ref={el} className="map" />;
}

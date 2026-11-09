import { useId } from 'react';

// FleetCare mark: map pin (breakdown location) + gear (mechanic) + radar ripples (distress radius).
const ARC1 = 'M81.90 11.80A44 44 0 0 1 104.20 34.10M23.80 34.10A44 44 0 0 1 46.10 11.80';
const ARC2 = 'M89.35 4.32A54 54 0 0 1 111.68 26.65M16.32 26.65A54 54 0 0 1 38.65 4.32';
const CYAN = '#3df5ff', GEAR = '#ffd24a';

export function LogoMark({ size = 32 }) {
  const id = 'pin' + useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 128 128" width={size} height={size} role="img" aria-label="FleetCare" focusable="false">
      <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffd84d" /><stop offset="1" stopColor="#ff8a00" /></linearGradient></defs>
      <g fill="none" stroke={CYAN} strokeLinecap="round">
        <ellipse cx="64" cy="108" rx="29" ry="8" strokeWidth="3.6" /><ellipse cx="64" cy="108" rx="46" ry="12.5" strokeWidth="3" strokeOpacity=".42" />
        <path d={ARC1} strokeWidth="3.8" /><path d={ARC2} strokeWidth="3.4" strokeOpacity=".5" />
      </g>
      <path fill={`url(#${id})`} fillRule="evenodd" d="M64 106C64 106 30 78 30 52A34 34 0 0 1 98 52C98 78 64 106 64 106ZM45 52a19 19 0 1 0 38 0a19 19 0 1 0-38 0Z" />
      <g fill={GEAR}>{[0, 1, 2, 3, 4, 5, 6, 7].map(k => <rect key={k} x="-2.7" y="-13.6" width="5.4" height="7" rx="1.3" transform={`translate(64 52) rotate(${k * 45})`} />)}<circle cx="64" cy="52" r="9" /></g>
      <circle cx="64" cy="52" r="3.5" fill={CYAN} />
    </svg>
  );
}

// Large logo + name, used at the top of the login pages.
export const BrandRow = ({ size = 64 }) => <div className="brand-row"><LogoMark size={size} /><Wordmark /></div>;
export const Wordmark = () => <b className="wordmark">Fleet<em>Care</em></b>;

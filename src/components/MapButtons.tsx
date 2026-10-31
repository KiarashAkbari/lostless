interface MapButtonsProps {
  follow: boolean;
  navigating: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onRecenter: () => void;
}

const iconProps = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export function MapButtons({ follow, navigating, onZoomIn, onZoomOut, onRecenter }: MapButtonsProps) {
  return (
    <div className="map-buttons">
      <button onClick={onZoomIn} aria-label="zoom in" title="zoom in">
        <svg {...iconProps}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
      </button>
      <button onClick={onZoomOut} aria-label="zoom out" title="zoom out">
        <svg {...iconProps}><line x1="5" y1="12" x2="19" y2="12" /></svg>
      </button>
      <button
        className={follow && navigating ? 'active' : ''}
        onClick={onRecenter}
        aria-label="center on my location"
        title="center on my location"
      >
        <svg {...iconProps}>
          <circle cx="12" cy="12" r="7" />
          <line x1="12" y1="1" x2="12" y2="4" />
          <line x1="12" y1="20" x2="12" y2="23" />
          <line x1="1" y1="12" x2="4" y2="12" />
          <line x1="20" y1="12" x2="23" y2="12" />
          <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
        </svg>
      </button>
    </div>
  );
}

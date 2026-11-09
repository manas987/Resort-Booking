import './loading-skeleton.css';

type Props = { label?: string; variant?: 'text' | 'cards' | 'table' | 'detail' | 'calendar' | 'photo'; rows?: number };

export function LoadingSkeleton({ label = 'Loading…', variant = 'text', rows = 3 }: Props) {
  return <div className={`loading-skeleton loading-skeleton-${variant}`} role="status" aria-label={label} aria-busy="true">
    <span className="loading-sr">{label}</span>
    <div aria-hidden="true">{Array.from({ length: rows }, (_, index) => <span className="loading-skeleton-block" key={index} />)}</div>
  </div>;
}

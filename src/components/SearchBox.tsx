import type { FormEvent } from 'react';

interface SearchBoxProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  loading: boolean;
}

/** Search field: fires on Enter only (Nominatim rate limit). */
export function SearchBox({ value, onChange, onSubmit, loading }: SearchBoxProps) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };
  return (
    <form className="search-box" onSubmit={submit}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden className="prompt">
        <circle cx="10.5" cy="10.5" r="6.5" />
        <line x1="15.5" y1="15.5" x2="21" y2="21" />
      </svg>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Where to?"
        aria-label="Where to?"
        autoComplete="off"
        enterKeyHint="search"
      />
      <button type="submit" className="go" disabled={loading} aria-label="Search">
        {loading ? '…' : 'Go'}
      </button>
    </form>
  );
}

import type { FormEvent } from 'react';

interface SearchBoxProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  loading: boolean;
}

/** Terminal-style search: fires on Enter only (Nominatim rate limit). */
export function SearchBox({ value, onChange, onSubmit, loading }: SearchBoxProps) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };
  return (
    <form className="search-box" onSubmit={submit}>
      <span className="prompt mono" aria-hidden>
        ▸
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="search a place — hit enter"
        aria-label="search a place"
        autoComplete="off"
        enterKeyHint="search"
      />
      <span className="caret mono" aria-hidden />
      <button type="submit" className="go mono" disabled={loading}>
        {loading ? '···' : 'GO ↵'}
      </button>
    </form>
  );
}

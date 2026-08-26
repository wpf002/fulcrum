"use client";

/** Shared list pager: Prev / page N of M / Next. Hidden for a single page. */
export function Pager({
  page,
  pageCount,
  onChange,
  label = "results",
}: {
  page: number;
  pageCount: number;
  onChange: (next: number) => void;
  label?: string;
}) {
  if (pageCount <= 1) return null;
  return (
    <nav className="pager" aria-label={`${label} pagination`}>
      <button
        className="pg-btn"
        onClick={() => onChange(page - 1)}
        disabled={page === 0}
        aria-label="Previous page"
      >
        ← Prev
      </button>
      <span className="pg-status">
        Page <b>{page + 1}</b> of {pageCount}
      </span>
      <button
        className="pg-btn"
        onClick={() => onChange(page + 1)}
        disabled={page >= pageCount - 1}
        aria-label="Next page"
      >
        Next →
      </button>
    </nav>
  );
}

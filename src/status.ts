/**
 * In-memory record of the most recent scrape result per PBS target.
 *
 * The exporter is otherwise stateless (Prometheus drives scrapes via
 * `/metrics?target=`), so this small store is what powers the status UI on `/`.
 * It holds only the latest result per target — not a history.
 */

export type ScrapeStatus = {
  /** Resolved PBS endpoint that was (or will be) scraped. */
  target: string;
  /** `true` up, `false` down, `null` seeded but not yet scraped. */
  up: boolean | null;
  /** PBS version string (e.g. "3.2.7"), when the last scrape succeeded. */
  version: string | null;
  /** PBS release string, when the last scrape succeeded. */
  release: string | null;
  /** Unix milliseconds of the last completed scrape, or `null` if never. */
  lastScrapeMs: number | null;
  /** Error message from the last scrape, when it failed. */
  error: string | null;
};

export type StatusSummary = {
  total: number;
  up: number;
  down: number;
  pending: number;
};

const store = new Map<string, ScrapeStatus>();

/** Register a target so it shows on the status page before its first scrape. */
export function seedTarget(target: string): void {
  if (!store.has(target)) {
    store.set(target, {
      target,
      up: null,
      version: null,
      release: null,
      lastScrapeMs: null,
      error: null,
    });
  }
}

/** Record the outcome of a completed scrape, replacing any prior result. */
export function recordScrape(update: {
  target: string;
  up: boolean;
  version?: string | null;
  release?: string | null;
  error?: string | null;
  nowMs: number;
}): void {
  store.set(update.target, {
    target: update.target,
    up: update.up,
    version: update.version ?? null,
    release: update.release ?? null,
    lastScrapeMs: update.nowMs,
    error: update.error ?? null,
  });
}

/** All known targets, ordered by endpoint for a stable UI. */
export function getStatuses(): ScrapeStatus[] {
  return store
    .values()
    .toArray()
    .toSorted((a, b) => a.target.localeCompare(b.target));
}

/** Aggregate up/down/pending counts across all known targets. */
export function getSummary(): StatusSummary {
  let up = 0;
  let down = 0;
  let pending = 0;
  for (const s of store.values()) {
    if (s.up === true) {
      up++;
    } else if (s.up === false) {
      down++;
    } else {
      pending++;
    }
  }
  return { total: store.size, up, down, pending };
}

/** Clear all recorded state — used by tests. */
export function resetStatuses(): void {
  store.clear();
}

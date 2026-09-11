// index.html is the only page with a map, but navigating to a different page
// (See List, ratings-explained, FAQ) and back is still a full page reload —
// the MapView gets destroyed and rebuilt from scratch. sessionStorage is what
// lets the next load pick up where the previous one left off, the same way
// js/rating-filter-sync.js carries the rating filter across pages.
const STORAGE_KEY = 'i2g-map-view-state';

export function loadMapViewState() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Merges rather than replaces so the extent-watcher and the selection-watcher
// (which save independently, on different triggers) never clobber each other.
export function saveMapViewState(partial) {
  try {
    const current = loadMapViewState() || {};
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...partial }));
  } catch {
    // Storage unavailable (private browsing, disabled, quota) - the view
    // just won't carry over between page loads.
  }
}

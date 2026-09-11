// index.html (map) and facility-list.html (See List) are separate page loads,
// not a single-page app, so the "Filter by rating" checkboxes can't share
// in-memory state directly — it has to round-trip through sessionStorage
// (scoped to the tab/session, unlike localStorage, so it doesn't quietly
// outlive the visit) so checking/unchecking a grade on one page carries over
// when the user navigates to the other.
const STORAGE_KEY = 'i2g-rating-filter-state';

function readStoredState() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStoredState(state) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable (private browsing, disabled, quota) - the filter
    // just won't carry over between pages.
  }
}

function currentCheckboxState(checkboxes) {
  const state = {};
  checkboxes.forEach((el) => {
    state[el.dataset.grade] = el.checked;
  });
  return state;
}

/**
 * Restores the .rating-check checkboxes on the current page from whatever was
 * last saved on either page, and keeps sessionStorage updated as the user
 * toggles them here. Call once per page after the checkboxes exist in the DOM.
 * @param {(checked: Record<string, boolean>) => void} [onRestore] called once
 *   with the restored state if storage had one, so callers can sync their own
 *   in-memory filter state (e.g. app.js's filterState.ratings) to match.
 */
export function syncRatingCheckboxesWithStorage(onRestore) {
  const checkboxes = document.querySelectorAll('.rating-check');

  // A plain browser refresh of this same page should show the filter's
  // default (everything checked), not silently keep whatever was last set —
  // same reasoning, and same Navigation Timing API check, as app.js's map
  // view state restore: sessionStorage alone can't tell a refresh apart from
  // a real cross-page visit, since a refresh doesn't clear it, but
  // performance's navigation entry reports "reload" only for an actual
  // F5/Ctrl+R/hard-refresh. The change listeners below still attach either
  // way, so unchecking something right after a refresh still saves normally
  // and still carries over to the other page from then on.
  const isReload = performance.getEntriesByType('navigation')[0]?.type === 'reload';
  const stored = isReload ? null : readStoredState();
  if (stored) {
    checkboxes.forEach((el) => {
      if (el.dataset.grade in stored) el.checked = stored[el.dataset.grade];
    });
    if (onRestore) onRestore(currentCheckboxState(checkboxes));
  }

  checkboxes.forEach((el) => {
    el.addEventListener('change', () => writeStoredState(currentCheckboxState(checkboxes)));
  });
}

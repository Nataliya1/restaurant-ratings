import * as reactiveUtils from 'https://js.arcgis.com/4.31/@arcgis/core/core/reactiveUtils.js';

/**
 * Layers accessibility behavior onto Esri's docked Popup widget that it doesn't
 * provide by default (verified by testing, not assumed from docs): opening a
 * popup never moves keyboard focus into it, closing one never returns focus to
 * where it came from, and clicking a different feature while the popup is
 * already open updates its content with nothing to announce that to a screen
 * reader.
 *
 * The map itself is canvas-rendered (WebGL), so individual points have no
 * corresponding DOM element a screen reader could ever reach directly — this
 * popup, kept docked to a predictable corner instead of floating beside
 * whatever was clicked, is the only accessible representation of a feature's
 * data. The facility list page is the fully keyboard/screen-reader-operable
 * alternative for browsing that same data without touching the map at all.
 *
 * @param {__esri.MapView} view
 * @param {string} nameField - attribute field holding the feature's display
 *   name (e.g. "est_name"). view.popup.title turned out unreliable here: this
 *   webmap's popup template renders the name as styled content rather than
 *   setting Popup's own title, so it's frequently empty, and — verified by
 *   testing — a location with multiple stacked inspection records (same
 *   address, different dates) pages between individual features without it
 *   ever populating at all. Reading the field directly off the currently
 *   selected feature's own attributes is what the popup's own content
 *   rendering is ultimately sourced from too, so it can't drift out of sync
 *   with what's actually on screen the way a scraped rendered-text guess could.
 */
export function enhancePopupAccessibility(view, nameField) {
  const liveRegion = document.getElementById('popupLiveRegion');
  let lastFocused = null;

  function currentLabel() {
    return view.popup.selectedFeature?.attributes?.[nameField] || 'Facility details';
  }

  // Esri fully replaces .esri-popup__main-container with a new element — not
  // just updating the old one in place — both on a fresh open and (verified by
  // testing) every time the docked popup swaps to a different feature without
  // closing first. Watching for the container's (re)appearance, rather than
  // tying setup to the popup's visible/false transition alone, is the one
  // mechanism that catches both cases; dataset.a11yReady stops it from
  // re-focusing the same container on every unrelated mutation elsewhere in the
  // view (graphics rendering, other widgets, etc.) that this broad an observer
  // also happens to see.
  const containerObserver = new MutationObserver(() => {
    const el = document.querySelector('.esri-popup__main-container');
    if (!el || el.dataset.a11yReady) return;
    el.dataset.a11yReady = 'true';
    // role="region", not "dialog": a docked popup isn't modal — the rest of the
    // page (filters, header, map) stays reachable while it's open. aria-label,
    // not aria-labelledby to a heading: the feature's name renders deep inside
    // Calcite's shadow DOM as styled content, not a stable, version-resistant
    // element there's an id to point to, so the name is supplied directly as a
    // string instead (see currentLabel above).
    el.setAttribute('role', 'region');
    el.setAttribute('tabindex', '-1');
    el.setAttribute('aria-label', currentLabel());
    el.focus();
  });
  containerObserver.observe(view.container, { childList: true, subtree: true });

  reactiveUtils.watch(
    () => view.popup.visible,
    (visible) => {
      if (visible) {
        lastFocused = document.activeElement;
      } else if (lastFocused && document.body.contains(lastFocused)) {
        // The map itself has no DOM node per feature to return focus to (see file
        // comment) — this restores focus to whatever *did* have it right before
        // the popup opened, which for a direct map click is the map's own view
        // surface, and for a search-result selection is the search input.
        lastFocused.focus();
        lastFocused = null;
      }
    }
  );

  // Also covers paging between stacked records at one location (the popup's own
  // "1 of 8"-style pager) — verified by testing to update selectedFeature and
  // reuse the same container node, so neither the MutationObserver above nor a
  // visible/false transition would otherwise catch it.
  reactiveUtils.watch(
    () => view.popup.selectedFeature,
    () => {
      if (!view.popup.visible) return;
      const label = currentLabel();
      document.querySelector('.esri-popup__main-container')?.setAttribute('aria-label', label);
      // The announcement itself lives in our own stable element (see
      // index.html), never destroyed/recreated the way Esri's popup DOM is —
      // reliable to hang aria-live off of regardless of that internal churn,
      // and it's what actually covers every update that isn't a fresh open:
      // paging, or switching feature without closing first, both move focus and
      // relabel per the observer above, but say nothing to a screen reader
      // that isn't currently focused inside the popup.
      if (liveRegion) liveRegion.textContent = `Showing details for ${label}.`;
    }
  );
}

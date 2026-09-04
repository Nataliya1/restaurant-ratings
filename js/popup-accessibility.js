import * as reactiveUtils from 'https://js.arcgis.com/4.31/@arcgis/core/core/reactiveUtils.js';

/**
 * Layers accessibility behavior onto the Features widget standing in for
 * view.popup (see app.js) that it doesn't provide by default: selecting a
 * feature never moves keyboard focus into its details, deselecting never
 * returns focus to where it came from, and switching to a different feature
 * updates content with nothing to announce that to a screen reader.
 *
 * The map itself is canvas-rendered (WebGL), so individual points have no
 * corresponding DOM element a screen reader could ever reach directly — the
 * Facility Details tab, rendered into its own stable container element (never
 * destroyed/recreated the way a floating popup's DOM would churn), is the only
 * accessible representation of a feature's data. The facility list page is the
 * fully keyboard/screen-reader-operable alternative for browsing that same data
 * without touching the map at all.
 *
 * @param {__esri.MapView} view
 * @param {string} nameField - attribute field holding the feature's display
 *   name (e.g. "est_name"). Read directly off the currently selected feature's
 *   own attributes — the same source the popup content itself renders from —
 *   rather than scraped from rendered text, so it can't drift out of sync with
 *   what's actually on screen, and stays populated even when a location has
 *   multiple stacked inspection records (same address, different dates) with no
 *   single stable title.
 * @param {{ container: HTMLElement, emptyStateEl: HTMLElement, onSelect: () => void }} options
 *   container - the Facility Details tabpanel: focused and (re)labeled whenever
 *     the selected feature changes.
 *   emptyStateEl - placeholder text shown when nothing is selected; toggled
 *     opposite of view.popup.visible.
 *   onSelect - called before focusing container, so the info panel is open and
 *     the Facility Details tab is active by the time focus/labeling happens
 *     (focusing a hidden element is a no-op).
 */
export function enhancePopupAccessibility(view, nameField, { container, emptyStateEl, onSelect }) {
  const liveRegion = document.getElementById('popupLiveRegion');
  let lastFocused = null;

  function currentLabel() {
    return view.popup.selectedFeature?.attributes?.[nameField] || 'Facility details';
  }

  reactiveUtils.watch(
    () => view.popup.visible,
    (visible) => {
      if (emptyStateEl) emptyStateEl.hidden = visible;

      if (visible) {
        lastFocused = document.activeElement;
      } else {
        // Reverts the container's accessible name from the last-shown facility
        // back to the tab's own static "Facility Details" label (via its
        // aria-labelledby) once nothing is selected, rather than leaving it
        // stuck announcing a facility that's no longer shown.
        container.removeAttribute('aria-label');

        if (lastFocused && document.body.contains(lastFocused)) {
          // The map itself has no DOM node per feature to return focus to (see
          // file comment) — this restores focus to whatever *did* have it right
          // before the popup opened, which for a direct map click is the map's
          // own view surface, and for a search-result selection is the search
          // input.
          lastFocused.focus();
          lastFocused = null;
        }
      }
    }
  );

  // Covers both a fresh selection and switching to a different feature (or
  // paging between stacked records at one location) while already open — both
  // update selectedFeature without necessarily toggling visible first.
  reactiveUtils.watch(
    () => view.popup.selectedFeature,
    (feature) => {
      if (!feature) return;
      onSelect();
      const label = currentLabel();
      container.setAttribute('aria-label', label);
      container.focus();
      if (liveRegion) liveRegion.textContent = `Showing details for ${label}.`;
    }
  );
}

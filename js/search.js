import Search from 'https://js.arcgis.com/4.31/@arcgis/core/widgets/Search.js';
import LocatorSearchSource from 'https://js.arcgis.com/4.31/@arcgis/core/widgets/Search/LocatorSearchSource.js';
import LayerSearchSource from 'https://js.arcgis.com/4.31/@arcgis/core/widgets/Search/LayerSearchSource.js';
import { CUSTOM_GEOCODER_URL, CUSTOM_GEOCODER_NAME, NAME_FIELD_RESTAURANT } from './config.js';

/**
 * Builds the Search widget as a single combined bar: every source (address
 * geocoder(s) + facility name) is queried at once via Search.ALL_INDEX, and the
 * source-picker dropdown is hidden in CSS so there's nothing to switch between.
 *
 * Deliberately does not include Esri's hosted World Geocoder: it's a credit-consuming
 * service that, without an ArcGIS API key configured, falls back to prompting the
 * user for an ArcGIS Online sign-in. The county's own geocoder is public and free.
 *
 * Note: facility name matching is "starts with" (Esri's default LayerSearchSource
 * behavior), not "contains" — e.g. "13th" matches "13th St. Brickhouse" but
 * "Brickhouse" alone won't. A custom "contains" override was attempted and
 * worked correctly in isolation (single-source mode), but Search.ALL_INDEX
 * silently drops results from any source with an async override that calls
 * ArcGIS's own request-backed APIs (layer.queryFeatures / locator.suggestLocations)
 * — the network calls complete, but the promise never resolves back to the
 * widget, and simpler sync/setTimeout-based stubs don't reproduce it. Shipping
 * the reliable default behavior rather than continuing to chase that.
 */
export function createSearchWidget({ view, restaurantLayer }) {
  const sources = [
    new LayerSearchSource({
      layer: restaurantLayer,
      name: 'Facility name (restaurants & schools)',
      searchFields: [NAME_FIELD_RESTAURANT],
      displayField: NAME_FIELD_RESTAURANT,
      // Shows "Name (Address)" in the suggestion dropdown so same-named
      // facilities at different locations (e.g. a chain's two locations) are
      // distinguishable before the user picks one.
      suggestionTemplate: `{${NAME_FIELD_RESTAURANT}} ({est_address})`,
      exactMatch: false,
      outFields: ['*'],
      placeholder: 'Search a facility name',
      maxSuggestions: 10,
      zoomScale: 2000
    })
  ];

  if (CUSTOM_GEOCODER_URL) {
    sources.push(
      new LocatorSearchSource({
        name: CUSTOM_GEOCODER_NAME,
        url: CUSTOM_GEOCODER_URL,
        singleLineFieldName: 'SingleLine',
        placeholder: `Search using ${CUSTOM_GEOCODER_NAME}`
      })
    );
  }

  const search = new Search({
    view,
    includeDefaultSources: false,
    sources,
    popupEnabled: true,
    activeSourceIndex: Search.ALL_INDEX
  });

  search.when(() => {
    search.activeSourceIndex = Search.ALL_INDEX;
  });

  // Placed on the map itself (rather than the sidebar) so it stays visible even
  // when the about panel is collapsed. Index 0 puts it above zoom/compass.
  view.ui.add(search, { position: 'top-left', index: 0 });

  return search;
}

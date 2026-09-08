import Search from 'https://js.arcgis.com/4.31/@arcgis/core/widgets/Search.js';
import LocatorSearchSource from 'https://js.arcgis.com/4.31/@arcgis/core/widgets/Search/LocatorSearchSource.js';
import LayerSearchSource from 'https://js.arcgis.com/4.31/@arcgis/core/widgets/Search/LayerSearchSource.js';
import * as geometryEngine from 'https://js.arcgis.com/4.31/@arcgis/core/geometry/geometryEngine.js';
import {
  CUSTOM_GEOCODER_URL,
  CUSTOM_GEOCODER_NAME,
  NAME_FIELD_RESTAURANT,
  FACILITY_ZOOM_SCALE,
  NEARBY_SEARCH_RADIUS_MILES,
  NEARBY_RESULT_LIMIT
} from './config.js';

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
export function createSearchWidget({ view, restaurantLayer, latestIdsPromise, onNoFacilityFound, onNearbyFacilities }) {
  const facilitySource = new LayerSearchSource({
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
    maxSuggestions: 10
  });

  // Without this, the source searches every historical inspection row, so a
  // facility with a long inspection history shows one near-duplicate
  // suggestion per past inspection date instead of one entry for the place
  // itself — this restricts it to the same "latest inspection only" set the
  // map itself is filtered to (see app.js).
  latestIdsPromise?.then(({ oidField, ids }) => {
    if (ids.length) facilitySource.filter = { where: `${oidField} IN (${ids.join(',')})` };
  }).catch(() => {});

  const sources = [facilitySource];

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
    // Selecting is handled entirely by the search-complete handler below
    // instead: Esri's own popupEnabled auto-open races that handler (both
    // call view.popup.open() — confirmed live, Esri's later call was
    // silently winning and clobbering the facility selection below with its
    // own generic, attribute-less "Search result" card), so it's turned off
    // here to leave exactly one thing opening the popup.
    popupEnabled: false,
    activeSourceIndex: Search.ALL_INDEX,
    // Esri's own default navigation zooms to fit *every* matching result
    // across all sources combined (e.g. typing "13th St" and picking one
    // facility still pulls in every unrelated street-address candidate the
    // geocoder also matched) rather than the one specific suggestion picked
    // — confirmed live, this zoomed out to nearly the whole county. Setting
    // goToParams.target.scale (the documented way to fix the zoom level)
    // didn't help, since the underlying target itself is already a combined
    // multi-result extent by that point. No-op it out entirely and drive the
    // zoom explicitly, from the resolved single facility, in the
    // search-complete handler below instead.
    goToOverride: () => Promise.resolve()
  });

  search.when(() => {
    search.activeSourceIndex = Search.ALL_INDEX;
  });

  // Picking a suggestion (rather than pressing Enter on free text) never
  // fires 'select-result' in this widget version/config — confirmed live by
  // logging every Search event during a suggestion click, only
  // 'search-complete' fired — so that's the hook used here. Only acts on a
  // single, unambiguous match (numResults === 1); a raw multi-result search
  // shows Esri's own results list for the user to pick from instead, and
  // auto-selecting one of those would be guessing on the user's behalf.
  //
  // Every result (facility-name or address) gets resolved through a fresh
  // proximity query rather than trusted as-is:
  //  - A facility-name result's graphic comes from a plain attribute search
  //    of the whole layer, which holds one point per historical inspection —
  //    a facility with a long inspection history can resolve to an *older*
  //    record rather than its current one.
  //  - An address/geocoder result's graphic is a bare locator candidate with
  //    no layer and no facility attributes — nothing to show on its own — so
  //    this finds whatever facility actually sits at that address instead.
  // Every historical record for a facility shares its exact location, so
  // querying a small radius around the result and keeping only the
  // newest-dated record per firm_number (pickLatestPerFirm, mirroring
  // js/lists.js's own dedupeToLatestPerFirm) reliably lands on the one
  // record that's actually current, regardless of which specific historical
  // record the original search matched.
  //
  // This does its own latest-per-firm reduction instead of querying through
  // view.whenLayerView(restaurantLayer)'s LayerView (which has an app.js-set
  // "latest inspection only" .filter that should, in principle, make this
  // unnecessary): confirmed live that a geometry-bearing
  // layerView.queryFeatures() call returns every historical record at that
  // point, unfiltered, not just the current one — so it's not relied on
  // here. queryFeatures() runs against the layer itself (not the LayerView)
  // for that reason.
  search.on('search-complete', (event) => {
    (event.results || []).forEach((group) => {
      if (group.results?.length !== 1) return;
      const graphic = group.results[0].feature;
      const point = graphic?.geometry;
      if (!point) return;
      // Only an address/geocoder result is a plain location that might
      // legitimately have no facility at it — a facility-name result is
      // already a specific facility, so a zero-match proximity query for one
      // (which shouldn't happen in practice) isn't "nothing at this address"
      // and doesn't fall back to a nearby-facilities search.
      const isAddressResult = graphic.layer !== restaurantLayer;

      findNearbyFacilities(point, 75, 'meters').then((exact) => {
        if (exact.length) {
          goToAndSelect(exact[0].graphic.geometry, exact.map((e) => e.graphic), point);
          return;
        }
        if (!isAddressResult) return;

        // Always zoom to the searched address itself first, even before
        // knowing whether anything is nearby — this still has to work as a
        // plain "go to this address" the way the geocoder alone would
        // (confirmed live: an earlier version of this only zoomed once a
        // facility match was found, so a plain address with nothing nearby
        // did nothing at all — no zoom, no feedback).
        view.goTo({ target: point, scale: FACILITY_ZOOM_SCALE }).catch(() => {}).then(() => {
          findNearbyFacilities(point, NEARBY_SEARCH_RADIUS_MILES, 'miles').then((nearby) => {
            if (nearby.length) {
              onNearbyFacilities?.(
                nearby.slice(0, NEARBY_RESULT_LIMIT),
                (graphic2) => goToAndSelect(graphic2.geometry, [graphic2], graphic2.geometry)
              );
            } else {
              onNoFacilityFound?.();
            }
          });
        });
      });
    });
  });

  // Zoomed in first, *then* the popup is opened: app.js has its own watch
  // that re-centers (at whatever the current scale already is, no scale of
  // its own) whenever the popup's selected feature changes — opening the
  // popup before this settles was confirmed live to cancel this animation
  // mid-flight, undoing the zoom back toward the wide starting view.
  // Finishing the zoom first means that later re-center is a same-position,
  // same-scale no-op instead. Same target + scale the facility card's own
  // "Zoom to" button uses (js/facility-details.js), so every way of landing
  // on a facility — name search, address search, the nearby list, or that
  // button — ends at the same view.
  function goToAndSelect(zoomTarget, features, location) {
    view.goTo({ target: zoomTarget, scale: FACILITY_ZOOM_SCALE })
      .catch(() => {})
      .then(() => openFacilityPopup(features, location));
  }

  // Queries facilities within `distance` `units` of `point`, deduped to each
  // one's current (latest-inspection) record, sorted nearest-first. Both
  // geometries are normalized to the search result's own spatial reference
  // (outSpatialReference below) before measuring, so geometryEngine.distance
  // — sync, but requires matching spatial references, unlike the
  // geodesicDistance() this first reached for, which turned out to not
  // actually be exported by this build's geometryEngine module (confirmed
  // live: threw "not a function") — compares like with like. That's Web
  // Mercator here, not a true-distance projection, but accurate enough at
  // county scale for a rough "X mi away" label.
  function findNearbyFacilities(point, distance, units) {
    const query = restaurantLayer.createQuery();
    query.geometry = point;
    query.distance = distance;
    query.units = units;
    query.spatialRelationship = 'intersects';
    query.outFields = ['*'];
    query.returnGeometry = true;
    query.outSpatialReference = point.spatialReference;

    return restaurantLayer.queryFeatures(query).then((results) =>
      pickLatestPerFirm(results.features)
        .map((graphic) => ({ graphic, distanceMiles: geometryEngine.distance(point, graphic.geometry, 'miles') }))
        .sort((a, b) => a.distanceMiles - b.distanceMiles)
    ).catch(() => []);
  }

  function pickLatestPerFirm(features) {
    const latestByFirm = new Map();
    features.forEach((f) => {
      const attrs = f.attributes;
      const key = attrs.firm_number ?? attrs[restaurantLayer.objectIdField];
      const existing = latestByFirm.get(key);
      if (!existing) {
        latestByFirm.set(key, f);
        return;
      }
      const a = existing.attributes;
      const isNewer =
        (attrs.inspection_date ?? 0) > (a.inspection_date ?? 0) ||
        ((attrs.inspection_date ?? 0) === (a.inspection_date ?? 0) && (attrs.inspection_id ?? 0) > (a.inspection_id ?? 0));
      if (isNewer) latestByFirm.set(key, f);
    });
    return Array.from(latestByFirm.values());
  }

  // queryFeatures()-returned graphics don't carry the layer's popupTemplate
  // the way a click-driven hit-test result does (confirmed live: without
  // this, view.popup.open() falls back to Esri's generic "Search result"
  // renderer instead of the facility's own Arcade-driven content) — attach
  // it explicitly before opening.
  function openFacilityPopup(features, location) {
    features.forEach((f) => { f.popupTemplate = restaurantLayer.popupTemplate; });
    view.popup.open({ features, location });
  }

  // Placed on the map itself (rather than the sidebar) so it stays visible even
  // when the about panel is collapsed. Index 0 puts it above zoom/compass.
  view.ui.add(search, { position: 'top-left', index: 0 });

  return search;
}

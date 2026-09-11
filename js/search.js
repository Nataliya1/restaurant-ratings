import Search from 'https://js.arcgis.com/4.31/@arcgis/core/widgets/Search.js';
import LocatorSearchSource from 'https://js.arcgis.com/4.31/@arcgis/core/widgets/Search/LocatorSearchSource.js';
import * as geometryEngine from 'https://js.arcgis.com/4.31/@arcgis/core/geometry/geometryEngine.js';
import {
  CUSTOM_GEOCODER_URL,
  CUSTOM_GEOCODER_NAME,
  NAME_FIELD_RESTAURANT,
  FACILITY_ZOOM_SCALE,
  NEARBY_SEARCH_RADIUS_MILES,
  NEARBY_RESULT_LIMIT
} from './config.js';
import { queryAllCurrentFacilities } from './lists.js';

// Treats "&" and the standalone word "and" as an interchangeable, ignorable
// joiner — "Hook & Lime", "Hook and Lime", and "Hook Lime" all normalize to
// the same "hook lime" — so a name search matches regardless of which one the
// user (or the data) happens to use. `\bAND\b` requires whole-word boundaries
// so it never eats the "and" inside e.g. "Andy's".
const JOINER_RE = /\s*&\s*|\band\b/gi;

function normalizeFacilityName(text) {
  return (text || '')
    .toLowerCase()
    .replace(JOINER_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Builds the Search widget as a single combined bar: every source (address
 * geocoder(s) + facility name) is queried at once via Search.ALL_INDEX, and the
 * source-picker dropdown is hidden in CSS so there's nothing to switch between.
 *
 * Deliberately does not include Esri's hosted World Geocoder: it's a credit-consuming
 * service that, without an ArcGIS API key configured, falls back to prompting the
 * user for an ArcGIS Online sign-in. The county's own geocoder is public and free.
 *
 * Note: facility name matching is still "starts with", not "contains" — e.g.
 * "13th" matches "13th St. Brickhouse" but "Brickhouse" alone won't. A custom
 * "contains" override on a *LayerSearchSource* was attempted once and worked
 * correctly in isolation (single-source mode), but Search.ALL_INDEX silently
 * dropped its results — confirmed live, the network calls completed but the
 * promise never resolved back to the widget. The facility-name source below
 * is a from-scratch custom source instead (see its own comment for why), and
 * unlike that attempt, does *not* run into the ALL_INDEX problem — its
 * getSuggestions/getResults never call a live ArcGIS request themselves (all
 * matching is synchronous, against data fetched once up front), which seems
 * to be the actual trigger for the bug rather than custom overrides in
 * general. Only "&"/"and" got normalized this way (see JOINER_RE) because
 * that's what was actually asked for; a full "contains" match was not
 * re-attempted.
 */
export function createSearchWidget({ view, restaurantLayer, onNoFacilityFound, onNearbyFacilities, onMultipleMatches }) {
  // Fetched once, up front, rather than queried live per keystroke: a plain
  // LayerSearchSource can only do a server-side "starts with" LIKE match
  // against the raw field text, which has no way to treat "&" and "and" as
  // equivalent (the literal "&" in the data has to line up with whatever the
  // user typed, character for character). Matching against normalized text
  // instead requires the actual candidate names in hand, so this holds them
  // in memory and getSuggestions/getResults below (a plain custom source
  // object, not LayerSearchSource) just filter it synchronously — no
  // per-keystroke network request at all, unlike the live layer.queryFeatures
  // calls Search.ALL_INDEX has been confirmed (see file comment above) to
  // silently swallow the results of. Already deduped to one row per firm at
  // its latest inspection (queryAllCurrentFacilities), so there's no separate
  // "latest IDs" filter to apply here the way the old LayerSearchSource
  // needed.
  const facilitiesPromise = queryAllCurrentFacilities(restaurantLayer);

  const MAX_SUGGESTIONS = 10;

  const facilitySource = {
    name: 'Facility name (restaurants & schools)',
    placeholder: 'Search a facility name',
    maxSuggestions: MAX_SUGGESTIONS,
    maxResults: MAX_SUGGESTIONS,
    getSuggestions: async (params) => {
      const query = normalizeFacilityName(params.suggestTerm ?? params.searchTerm ?? '');
      if (!query) return [];
      const facilities = await facilitiesPromise;
      return facilities
        .filter((f) => normalizeFacilityName(f.attributes[NAME_FIELD_RESTAURANT]).startsWith(query))
        .slice(0, MAX_SUGGESTIONS)
        .map((f) => ({
          key: 'facility-suggestion',
          text: `${f.attributes[NAME_FIELD_RESTAURANT]} (${f.attributes.est_address})`,
          sourceIndex: params.sourceIndex,
          facility: f
        }));
    },
    getResults: async (params) => {
      const facilities = await facilitiesPromise;
      // A clicked suggestion already identifies one exact facility (the
      // object we attached to it above survives the round trip back from
      // Esri) — no need to re-run the match. Free text submitted straight
      // (Enter with no suggestion picked) still needs a fresh match, and can
      // legitimately match more than one facility. Confirmed live: Esri
      // never puts that raw typed text in params.searchTerm (undefined here)
      // — it wraps it in a synthetic params.suggestResult of its own (one
      // with `text` set but no `key`/`facility`, standing in for "nothing was
      // actually picked from the list").
      const suggestFacility = params.suggestResult?.facility;
      const rawText = params.suggestResult?.text ?? params.searchTerm ?? '';
      const matches = suggestFacility
        ? [suggestFacility]
        : facilities.filter((f) => normalizeFacilityName(f.attributes[NAME_FIELD_RESTAURANT]).startsWith(normalizeFacilityName(rawText)));

      return matches.slice(0, MAX_SUGGESTIONS).map((f) => ({
        feature: f,
        name: f.attributes[NAME_FIELD_RESTAURANT],
        target: f
      }));
    }
  };

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
      // A facility-name search (typed and submitted directly, e.g. "early
      // bird" — not a suggestion pick, which always resolves to exactly one
      // facility already) can genuinely match more than one facility.
      // Auto-picking one would be guessing on the user's behalf, so this
      // surfaces a real, selectable list instead — same reasoning as the
      // address-search "nearby facilities" list below, and reuses its "back
      // to results" affordance (see app.js's onMultipleMatches wiring).
      // Matched by name, not object identity: confirmed live that
      // group.source is some internal Esri wrapper, not the exact object we
      // put in `sources` above, so `=== facilitySource` never matches.
      if (group.source?.name === facilitySource.name && group.results?.length > 1) {
        // Kept even when a candidate has no geometry (a real, known data gap
        // — some facilities' addresses have never been geocoded) rather than
        // silently dropped: selectFacility below still shows its details, it
        // just can't zoom to it. facility-details.js flags those entries with
        // a note so the choice list itself isn't misleading about it either.
        const entries = group.results.map((r) => ({ graphic: r.feature }));
        if (entries.length) {
          onMultipleMatches?.(entries, selectFacility, search.searchTerm);
        }
        return;
      }
      if (group.results?.length !== 1) return;
      const graphic = group.results[0].feature;
      const point = graphic?.geometry;
      if (!point) {
        // A facility-name result is already one specific business — unlike
        // an address result, there's no "look nearby instead" fallback that
        // makes sense here. Show what's known about it directly rather than
        // doing nothing; facility-details.js explains the missing location.
        selectFacility(graphic);
        return;
      }
      // Only an address/geocoder result is a plain location that might
      // legitimately have no facility at it — a facility-name result is
      // already a specific facility, so a zero-match proximity query for one
      // (which shouldn't happen in practice) isn't "nothing at this address"
      // and doesn't fall back to a nearby-facilities search.
      const isAddressResult = graphic.layer !== restaurantLayer;

      findNearbyFacilities(point, 75, 'meters').then((exact) => {
        // A facility-name result already identifies one specific business —
        // narrow this radius lookup (whose job is only to land on that same
        // business's *current* record; see the comment above) back down to
        // that one firm, rather than keeping every other business it happens
        // to share a radius with (e.g. neighboring storefronts) that a name
        // search never actually matched. An address result has no such
        // anchor, so every facility near that address is a legitimate match.
        const matches = isAddressResult
          ? exact
          : exact.filter((e) => e.graphic.attributes.firm_number === graphic.attributes.firm_number);

        if (matches.length) {
          goToAndSelect(matches[0].graphic.geometry, matches.map((e) => e.graphic), point);
          return;
        }
        // Same-firm current record wasn't found within the radius (shouldn't
        // normally happen) — fall back to the originally matched record
        // itself rather than silently dropping a valid facility-name match.
        if (exact.length && !isAddressResult) {
          goToAndSelect(graphic.geometry, [graphic], point);
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
                (graphic2) => selectFacility(graphic2)
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

  // Every path that lands on a single facility (a suggestion pick, a
  // disambiguated name match, a nearby-list pick) goes through this, so any
  // of them can hand it a facility with no geometry — a real, known data gap
  // (some addresses have never been geocoded) — without special-casing it at
  // each call site. There's nothing to zoom to, so this just opens its
  // details in place; facility-details.js is what actually explains the
  // missing location to the user.
  function selectFacility(graphic) {
    if (!graphic.geometry) {
      openFacilityPopup([graphic], null);
      return;
    }
    goToAndSelect(graphic.geometry, [graphic], graphic.geometry);
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
    // Cloned rather than opened directly: confirmed live that view.popup.open()
    // silently no-ops (view.popup.features never actually updates, so nothing
    // re-renders) when handed the *exact same* Graphic object reference that
    // was already the last-shown feature — which happens here because
    // facilitiesPromise's cache means re-selecting the same facility (e.g.
    // picking it again off a "multiple matches" list after having reached it
    // some other way first) hands back that identical object. A fresh clone
    // is always a new reference, regardless of which facility it represents.
    const opened = features.map((f) => f.clone());
    opened.forEach((f) => { f.popupTemplate = restaurantLayer.popupTemplate; });
    view.popup.open({ features: opened, location });
  }

  // Placed on the map itself (rather than the sidebar) so it stays visible even
  // when the about panel is collapsed. Index 0 puts it above zoom/compass.
  view.ui.add(search, { position: 'top-left', index: 0 });

  return search;
}

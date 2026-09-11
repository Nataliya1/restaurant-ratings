import WebMap from 'https://js.arcgis.com/4.31/@arcgis/core/WebMap.js';
import MapView from 'https://js.arcgis.com/4.31/@arcgis/core/views/MapView.js';
import Extent from 'https://js.arcgis.com/4.31/@arcgis/core/geometry/Extent.js';
import * as reactiveUtils from 'https://js.arcgis.com/4.31/@arcgis/core/core/reactiveUtils.js';
import Basemap from 'https://js.arcgis.com/4.31/@arcgis/core/Basemap.js';
import BasemapGallery from 'https://js.arcgis.com/4.31/@arcgis/core/widgets/BasemapGallery.js';
import Expand from 'https://js.arcgis.com/4.31/@arcgis/core/widgets/Expand.js';
import Home from 'https://js.arcgis.com/4.31/@arcgis/core/widgets/Home.js';
import Locate from 'https://js.arcgis.com/4.31/@arcgis/core/widgets/Locate.js';
import Features from 'https://js.arcgis.com/4.31/@arcgis/core/widgets/Features.js';

import { WEBMAP_ITEM_ID, RESTAURANT_LAYER_TITLE, NAME_FIELD_RESTAURANT, NEARBY_SEARCH_RADIUS_MILES } from './js/config.js';
import { buildRestaurantDefinitionExpression } from './js/filters.js';
import { syncRatingCheckboxesWithStorage } from './js/rating-filter-sync.js';
import { loadMapViewState, saveMapViewState } from './js/map-view-state.js';
import { queryLatestObjectIds } from './js/lists.js';
import { createSearchWidget } from './js/search.js';
import { setupHeader } from './js/header.js';
import { setupInfoPanel } from './js/info-panel.js';
import { renderFacilityDetails } from './js/facility-details.js';
import { enhancePopupAccessibility } from './js/popup-accessibility.js';

const container = document.getElementById('viewDiv');

const webmap = new WebMap({
  portalItem: {
    id: WEBMAP_ITEM_ID
  }
});

// A plain browser refresh of this same page should behave like a fresh visit
// (home extent, nothing selected) — only actually navigating to a different
// page and back should bring the saved view state back. sessionStorage alone
// can't tell those two apart (a refresh doesn't clear it), but the Navigation
// Timing API can: performance's navigation entry reports "reload" for
// F5/Ctrl+R/hard-refresh and "navigate" for a real cross-page visit (both
// leaving and returning). Treating a reload as if nothing were stored also
// means the save-on-interaction watches below start overwriting it again
// right away, so it doesn't linger stale — the very next click or pan simply
// becomes the new saved state.
const isReload = performance.getEntriesByType('navigation')[0]?.type === 'reload';

// Read once, synchronously, before the view is even constructed: passing a
// restored extent straight into the MapView constructor is what lets a
// returning visit land there directly, instead of flashing the web map's own
// default extent first and then jumping.
const storedViewState = isReload ? null : loadMapViewState();

const view = new MapView({
  container,
  map: webmap,
  ui: {
    components: ['zoom', 'attribution']
  },
  ...(storedViewState?.extent ? { extent: Extent.fromJSON(storedViewState.extent) } : {})
});

const homeWidget = new Home({ view });
view.ui.add(homeWidget, 'top-right');

// Basemap portal items pulled from the county's own default basemap gallery
// group (dogis.maps.arcgis.com, group ab72ca4702a24b9c86a45a0b80e7dca8),
// confirmed live via that group's item listing — "Enhanced Contrast Map" /
// "Enhanced Contrast Dark Map" are Esri's actual titles for what's commonly
// called "High Contrast Light/Dark". Built after webmap.load() (see below)
// so `webmap.basemap` — the map's own current basemap, kept as the gallery's
// first/default entry — is actually populated instead of undefined.
const EXTRA_BASEMAP_ITEM_IDS = {
  imageryHybrid: '86265e5a4bbb4187a59719cf134e0018',
  highContrastLight: '084291b0ecad4588b8c8853898d72445',
  highContrastDark: '3e23478909194c54992eaaee78b5f754'
};

// Replaces the default 'compass' (reset map orientation) component, in the same
// top-left slot below the zoom control. Requires a secure context (HTTPS or
// localhost) — browsers silently deny geolocation on plain HTTP.
const locateWidget = new Locate({ view });
view.ui.add(locateWidget, 'top-left');

const filterState = {
  showRestaurants: true,
  showSchools: true,
  ratings: { A: true, B: true, C: true, D: true, F: true, OTHER: true }
};

// index.html is the only page with an info panel — a static, collapsible left
// sidebar, open by default — so it's the only page whose header has an info icon
// at all; the other pages just call setupHeader() with no options.
const { setupDropdown } = setupHeader();
setupDropdown('mapLayersToggle', 'mapLayersPanel');

const infoPanel = setupInfoPanel({
  toggleButtonId: 'infoToggle',
  panelId: 'infoPanel',
  closeButtonId: 'infoPanelCloseBtn',
  tabs: [
    { tabId: 'aboutTab', panelId: 'aboutTabPanel' },
    { tabId: 'detailsTab', panelId: 'detailsTabPanel' }
  ],
  detailsTabId: 'detailsTab'
});

view.when(
  async () => {
    console.log('ArcGIS web map loaded successfully.');

    // Assigning a Features widget to view.popup is Esri's documented way to
    // redirect the view's normal click-to-select/search-result-select behavior
    // (hit-testing, highlighting, etc.) away from the default floating popup —
    // those built-in interactions don't need to be hand-rolled. Its own rendering
    // goes unused, though: Features shows one selected feature at a time with
    // next/previous paging (confirmed by reading its source — there's no built-in
    // "list every selected feature at once" mode), which both looks like a popup
    // still embedded in the panel and hides facilities beyond the first. So
    // js/facility-details.js renders every one of view.popup.features into the
    // actual visible Facility Details tab itself, and this widget's own container
    // (popupHost below) is never shown to anyone.
    //
    // popupHost still has to be a real, attached DOM node, though — a detached
    // `document.createElement('div')` that's never inserted into the page was
    // tried first and broke click-to-select entirely (confirmed live: nothing
    // happened on a map click), so the widget genuinely needs to be mounted in
    // the document to do its selection/hit-testing work, even though nothing it
    // renders is ever supposed to be seen. `inert` drops it from both the tab
    // order and the accessibility tree; the 1x1px/overflow:hidden sizing keeps it
    // off-screen without `display: none`, in case that also interferes with its
    // internal rendering the way full detachment did.
    const popupHost = document.createElement('div');
    popupHost.inert = true;
    Object.assign(popupHost.style, {
      position: 'absolute',
      left: '-9999px',
      width: '1px',
      height: '1px',
      overflow: 'hidden'
    });
    document.body.appendChild(popupHost);

    // view.popup isn't fully initialized (watch() isn't callable on the default
    // one yet) until view.when() resolves, so this has to happen here rather than
    // right after `new MapView(...)`.
    view.popup = new Features({ view, container: popupHost });

    const facilityDetails = renderFacilityDetails({
      view,
      container: document.getElementById('facilityFeaturesContainer')
    });

    // Set (alongside pendingBackToList) right before opening a facility that
    // was picked off a choice list — either "nearby facilities" (address
    // search with no exact match) or "multiple matches" (an ambiguous
    // facility-name search) — see onNearbyFacilities/onMultipleMatches below
    // — so the very next features-change this watch sees knows to show a
    // "back to results" button. Reset once consumed by a real (non-empty)
    // selection, so it doesn't linger onto some later, unrelated click or
    // search that has nothing to do with that list. pendingBackToList holds a
    // closure that just re-renders whichever list it was (renderNearbyList or
    // renderMultipleMatches, each already bound to their own entries) rather
    // than hardcoding one — selectFromChoiceList below builds it.
    let nearbySelectPending = false;
    let pendingBackToList = null;

    reactiveUtils.watch(
      () => view.popup.features,
      (features) => {
        const showBack = !!(features?.length && nearbySelectPending && pendingBackToList);
        facilityDetails.render(features, {
          onBackToNearby: showBack ? () => clearSelectionThenRender(pendingBackToList) : null
        });
        if (features?.length) nearbySelectPending = false;
      }
    );

    // Shared by onNearbyFacilities and onMultipleMatches below: builds the
    // "render this list" closure and a selectFacility wrapper that, when
    // called, stores that same closure as pendingBackToList before deferring
    // to the real selectFacility — so picking an entry off either kind of
    // list leaves a "back to results" link once its facility details are
    // showing. renderList and wrapped reference each other (the list needs
    // to hand its buttons the wrapped selector; the wrapped selector needs to
    // hand back the exact list it came from) via ordinary closure, not
    // execution order — wrapped is only ever called later, from a click.
    function makeChoiceList(entries, renderFn, selectFacility) {
      function wrapped(graphic) {
        nearbySelectPending = true;
        pendingBackToList = renderList;
        selectFacility(graphic);
      }
      function renderList() {
        renderFn(entries, { onSelect: wrapped });
      }
      return renderList;
    }

    // Set right before restoring a selection on load (below) so that one
    // restored selection doesn't steal keyboard/screen-reader focus or
    // trigger a live-region announcement the way a real click or search
    // selection should — nothing the user did on *this* page load caused it.
    let silentSelect = false;

    enhancePopupAccessibility(view, NAME_FIELD_RESTAURANT, {
      container: document.getElementById('detailsTabPanel'),
      emptyStateEl: document.getElementById('facilityDetailsEmpty'),
      onSelect: infoPanel.showDetailsTab,
      consumeSilentSelect: () => {
        if (!silentSelect) return false;
        silentSelect = false;
        return true;
      }
    });

    // Carries the map's extent across navigation to a different page (See
    // List, ratings-explained, FAQ) and back — those are full page reloads,
    // so this is the only way the map doesn't reset to its home extent every
    // time. Keyed off view.stationary (true once panning/zooming settles)
    // rather than every extent change, so a drag or zoom animation writes to
    // sessionStorage once at the end instead of dozens of times mid-gesture.
    reactiveUtils.watch(
      () => view.stationary,
      (stationary) => {
        if (stationary && view.extent) saveMapViewState({ extent: view.extent.toJSON() });
      }
    );

    // Pans (without changing zoom) so the clicked feature stays centered in the
    // remaining map space next to the open info panel — fires on every
    // selectedFeature change, so this also re-centers when picking a different
    // feature, or paging between multiple stacked records, while its details
    // stay shown.
    reactiveUtils.watch(
      () => view.popup.selectedFeature,
      (feature) => {
        if (!feature?.geometry) return;
        view.goTo({ target: feature.geometry }).catch(() => {});
      }
    );

    // Google Translate rewrites DOM text as it walks the page, and garbles this
    // Esri-owned attribution control while doing so (ends up with an empty link and
    // no accessible name — a real, verified WCAG failure, not hypothetical). `notranslate`
    // is Google's own documented way to exempt an element from that rewrite; there's
    // nothing here worth translating anyway (just the "Powered by Esri" credit).
    container.querySelector('.esri-attribution')?.classList.add('notranslate');

    await webmap.load();

    const basemapGallery = new BasemapGallery({
      view,
      source: [
        webmap.basemap,
        new Basemap({ portalItem: { id: EXTRA_BASEMAP_ITEM_IDS.imageryHybrid } }),
        new Basemap({ portalItem: { id: EXTRA_BASEMAP_ITEM_IDS.highContrastLight } }),
        new Basemap({ portalItem: { id: EXTRA_BASEMAP_ITEM_IDS.highContrastDark } })
      ]
    });
    const basemapExpand = new Expand({
      view,
      content: basemapGallery,
      expandIcon: 'basemap',
      expandTooltip: 'Basemap gallery',
      collapseTooltip: 'Basemap gallery'
    });
    view.ui.add(basemapExpand, 'top-right');

    const restaurantLayer = webmap.allLayers.find((l) => l.title === RESTAURANT_LAYER_TITLE);

    if (!restaurantLayer) {
      console.error('Expected layer not found in web map.', { restaurantLayer });
      return;
    }

    await restaurantLayer.load();

    // The map should show one point per place (its most recent inspection only),
    // not one per historical inspection row — AGOL's Map Viewer can't express that
    // "latest per group" filter itself, so it's computed here instead. Queried once
    // and shared: the map applies it as a LayerView filter below, and the search
    // widget applies the same OID list to its facility-name source so its
    // suggestion dropdown doesn't list a separate entry per historical inspection
    // either (confirmed live: without this, searching a facility with a long
    // inspection history shows one nearly-identical suggestion per past inspection
    // date). Applied as a LayerView filter (client-side, draw-only) rather than
    // folded into definitionExpression below: definitionExpression restricts the
    // layer's own queryable dataset, and the webmap's popup reads its multi-row
    // inspection history from that same dataset — narrowing it would leave only
    // the one visible row for every popup. A LayerView filter only hides the older
    // points from view; the full history stays queryable for the popup.
    const latestIdsPromise = queryLatestObjectIds(restaurantLayer);

    // Clears out whatever facility a *previous* search or click had selected
    // (view.popup.close(), rather than leaving it stuck on screen showing a
    // place that has nothing to do with the new search) and swaps in
    // `render()`'s content instead of the usual feature cards. Deferred a
    // tick: close() triggers this file's own features/visible watches
    // (above), which re-render facilityFeaturesContainer and un-hide the
    // default "Search for a facility..." placeholder — asynchronously, so
    // running this in the same tick raced them and lost (confirmed live:
    // both ended up stacked on screen). A tick lets those settle first so
    // this genuinely runs last.
    function clearSelectionThenRender(render) {
      view.popup.close();
      setTimeout(() => {
        document.getElementById('facilityDetailsEmpty')?.setAttribute('hidden', '');
        render();
        infoPanel.showDetailsTab();
      }, 0);
    }

    createSearchWidget({
      view,
      restaurantLayer,
      // An address search found nothing within a mile of it either — rare,
      // but still possible toward the county's edges.
      onNoFacilityFound: () => clearSelectionThenRender(() =>
        facilityDetails.renderMessage(`No food facility was found within ${NEARBY_SEARCH_RADIUS_MILES} mile of this address.`)
      ),
      // An address search found no facility at that exact address, but did
      // find some nearby — listed as real, selectable choices (a "look at
      // the map" instruction alone isn't usable for a screen-reader or
      // low-vision user, raised directly in conversation) rather than
      // requiring the map itself to find them.
      onNearbyFacilities: (entries, selectFacility) => {
        clearSelectionThenRender(makeChoiceList(entries, facilityDetails.renderNearbyList, selectFacility));
      },
      // A facility-name search (typed and submitted directly, not picked
      // from the suggestion dropdown) matched more than one facility — e.g.
      // "early bird" matching "Early Bird", "Early Bird Brunch", etc. Same
      // "real selectable list, don't guess" treatment as onNearbyFacilities.
      onMultipleMatches: (entries, selectFacility, query) => {
        const renderList = makeChoiceList(
          entries,
          (e, opts) => facilityDetails.renderMultipleMatches(e, { ...opts, query }),
          selectFacility
        );
        clearSelectionThenRender(renderList);
      }
    });

    function applyMapFilter() {
      restaurantLayer.definitionExpression = buildRestaurantDefinitionExpression(filterState);
    }

    // Restore whatever rating filter was last set on this page or the See List
    // page (they're separate page loads, so this is the only way the two stay
    // in sync) before the first filter is applied, so the map doesn't briefly
    // show every rating before snapping to the restored selection.
    syncRatingCheckboxesWithStorage((restoredRatings) => {
      filterState.ratings = restoredRatings;
    });
    applyMapFilter();

    // Carries the selected facility across navigation the same way the
    // extent is carried above — saved here (after applyMapFilter, so a
    // restored selection is queried under the same rating/type filter it'll
    // actually be viewed under) as view.popup.features changes, whether from
    // a click, a search result, or (below) restoring a previous selection.
    reactiveUtils.watch(
      () => view.popup.features,
      (features) => {
        const ids = (features || [])
          .map((f) => f.attributes?.[restaurantLayer.objectIdField])
          .filter((id) => id != null);
        saveMapViewState({ selectedObjectIds: ids });
      }
    );

    if (storedViewState?.selectedObjectIds?.length) {
      restaurantLayer.queryFeatures({
        objectIds: storedViewState.selectedObjectIds,
        outFields: ['*'],
        returnGeometry: true
      }).then((result) => {
        if (!result.features.length) return;
        // queryFeatures()-returned graphics don't carry the layer's
        // popupTemplate the way a click-driven hit-test result does (same
        // gotcha js/search.js documents for its own queryFeatures() calls) —
        // attach it explicitly before opening.
        result.features.forEach((f) => { f.popupTemplate = restaurantLayer.popupTemplate; });
        silentSelect = true;
        view.popup.open({ features: result.features, location: result.features[0].geometry });
      }).catch(() => {});
    }

    latestIdsPromise.then(async ({ oidField, ids }) => {
      if (!ids.length) return;
      const layerView = await view.whenLayerView(restaurantLayer);
      layerView.filter = { where: `${oidField} IN (${ids.join(',')})` };
    });

    document.getElementById('showRestaurants').addEventListener('change', (e) => {
      filterState.showRestaurants = e.target.checked;
      applyMapFilter();
    });
    document.getElementById('showSchools').addEventListener('change', (e) => {
      filterState.showSchools = e.target.checked;
      applyMapFilter();
    });
    document.querySelectorAll('.rating-check').forEach((el) => {
      el.addEventListener('change', () => {
        filterState.ratings[el.dataset.grade] = el.checked;
        applyMapFilter();
      });
    });
  },
  (error) => {
    container.innerHTML = '<div class="error-state">Unable to load the web map. Check that the item ID is valid and the map is shared publicly.</div>';
    console.error(error);
  }
);

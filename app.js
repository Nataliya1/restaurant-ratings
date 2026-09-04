import WebMap from 'https://js.arcgis.com/4.31/@arcgis/core/WebMap.js';
import MapView from 'https://js.arcgis.com/4.31/@arcgis/core/views/MapView.js';
import * as reactiveUtils from 'https://js.arcgis.com/4.31/@arcgis/core/core/reactiveUtils.js';
import BasemapGallery from 'https://js.arcgis.com/4.31/@arcgis/core/widgets/BasemapGallery.js';
import Expand from 'https://js.arcgis.com/4.31/@arcgis/core/widgets/Expand.js';
import Home from 'https://js.arcgis.com/4.31/@arcgis/core/widgets/Home.js';
import Locate from 'https://js.arcgis.com/4.31/@arcgis/core/widgets/Locate.js';

import { WEBMAP_ITEM_ID, RESTAURANT_LAYER_TITLE, NAME_FIELD_RESTAURANT } from './js/config.js';
import { buildRestaurantDefinitionExpression } from './js/filters.js';
import { queryLatestObjectIds } from './js/lists.js';
import { createSearchWidget } from './js/search.js';
import { setupHeader } from './js/header.js';
import { enhancePopupAccessibility } from './js/popup-accessibility.js';

const container = document.getElementById('viewDiv');

const webmap = new WebMap({
  portalItem: {
    id: WEBMAP_ITEM_ID
  }
});

const view = new MapView({
  container,
  map: webmap,
  ui: {
    components: ['zoom', 'attribution']
  }
});

const homeWidget = new Home({ view });

const basemapGallery = new BasemapGallery({ view });
const basemapExpand = new Expand({
  view,
  content: basemapGallery,
  expandIcon: 'basemap',
  expandTooltip: 'Basemap gallery',
  collapseTooltip: 'Basemap gallery'
});

view.ui.add([homeWidget, basemapExpand], 'top-right');

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

// index.html is the only page with an About panel — a static, collapsible left
// sidebar, open by default — so it's the only page whose header has an info icon
// at all; the other pages just call setupHeader() with no options.
const { setupDropdown } = setupHeader({ aboutPanelId: 'aboutPanel' });
setupDropdown('mapLayersToggle', 'mapLayersPanel');

view.when(
  async () => {
    console.log('ArcGIS web map loaded successfully.');

    // Docked (rather than floating next to whatever was clicked) so the popup always
    // lands in a predictable spot — easier to find with a screen reader, and never
    // covers the point you just selected. buttonEnabled: false hides Esri's own
    // dock-toggle button, since docking is no longer optional here. view.popup isn't
    // the fully-initialized widget instance (watch() isn't callable on it yet) until
    // view.when() resolves, so this has to happen here rather than right after
    // `new MapView(...)`.
    view.popup.dockEnabled = true;
    view.popup.dockOptions = {
      buttonEnabled: false,
      breakpoint: false,
      position: 'bottom-right'
    };
    enhancePopupAccessibility(view, NAME_FIELD_RESTAURANT);

    // Pans (without changing zoom) so the clicked feature stays centered rather
    // than possibly landing behind the now-docked popup — fires on every
    // selectedFeature change, so this also re-centers when picking a different
    // feature, or paging between multiple stacked records, while the popup
    // stays open.
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
    const restaurantLayer = webmap.allLayers.find((l) => l.title === RESTAURANT_LAYER_TITLE);

    if (!restaurantLayer) {
      console.error('Expected layer not found in web map.', { restaurantLayer });
      return;
    }

    await restaurantLayer.load();

    createSearchWidget({ view, restaurantLayer });

    function applyMapFilter() {
      restaurantLayer.definitionExpression = buildRestaurantDefinitionExpression(filterState);
    }
    applyMapFilter();

    // The map should show one point per place (its most recent inspection only),
    // not one per historical inspection row — AGOL's Map Viewer can't express that
    // "latest per group" filter itself, so it's computed here instead. This is
    // applied as a LayerView filter (client-side, draw-only) rather than folded
    // into definitionExpression above: definitionExpression restricts the layer's
    // own queryable dataset, and the webmap's popup reads its multi-row inspection
    // history from that same dataset — narrowing it would leave only the one
    // visible row for every popup. A LayerView filter only hides the older points
    // from view; the full history stays queryable for the popup.
    queryLatestObjectIds(restaurantLayer).then(async ({ oidField, ids }) => {
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

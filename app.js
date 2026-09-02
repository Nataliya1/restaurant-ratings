import WebMap from 'https://js.arcgis.com/4.31/@arcgis/core/WebMap.js';
import MapView from 'https://js.arcgis.com/4.31/@arcgis/core/views/MapView.js';
import BasemapGallery from 'https://js.arcgis.com/4.31/@arcgis/core/widgets/BasemapGallery.js';
import Expand from 'https://js.arcgis.com/4.31/@arcgis/core/widgets/Expand.js';
import Home from 'https://js.arcgis.com/4.31/@arcgis/core/widgets/Home.js';
import Locate from 'https://js.arcgis.com/4.31/@arcgis/core/widgets/Locate.js';

import { WEBMAP_ITEM_ID, RESTAURANT_LAYER_TITLE, MOBILE_TABLE_TITLE, NAME_FIELD_RESTAURANT, NAME_FIELD_MOBILE } from './js/config.js';
import { buildRestaurantDefinitionExpression, buildRatingClause } from './js/filters.js';
import { queryFacilityList, queryMobileList, queryAllFacilities, queryAllMobile } from './js/lists.js';
import { createSearchWidget } from './js/search.js';
import { toCsv, downloadCsv } from './js/csv.js';

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

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

const openDropdowns = new Map(); // panel -> button, for outside-click/Escape close

function closeDropdown(panel) {
  const button = openDropdowns.get(panel);
  if (!button) return;
  button.setAttribute('aria-expanded', 'false');
  panel.hidden = true;
  openDropdowns.delete(panel);
}

// restoreFocus matters for keyboard users: hiding a panel that contains the
// currently-focused button (the one that opened it) silently drops focus to
// <body>, since a focused element inside a newly-hidden ancestor can't stay
// focused. Pass true when the close is a deliberate user action (Escape,
// selecting a list item) so focus lands back on the toggle button instead of
// vanishing. Left false for incidental closes (e.g. clicking elsewhere on the
// page), where yanking focus back to the button would be surprising.
function closeAllDropdowns({ restoreFocus = false } = {}) {
  openDropdowns.forEach((button, panel) => {
    closeDropdown(panel);
    if (restoreFocus) button.focus();
  });
}

function setupDropdown(buttonId, panelId) {
  const button = document.getElementById(buttonId);
  const panel = document.getElementById(panelId);
  let loaded = false;

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    const expanded = button.getAttribute('aria-expanded') === 'true';

    // Only one dropdown open at a time.
    openDropdowns.forEach((_openButton, openPanel) => closeDropdown(openPanel));

    if (expanded) return;

    button.setAttribute('aria-expanded', 'true');
    panel.hidden = false;
    openDropdowns.set(panel, button);

    if (!loaded) {
      loaded = true;
      panel.dispatchEvent(new CustomEvent('first-open'));
    }
  });

  panel.addEventListener('click', (event) => event.stopPropagation());
}

const menuToggleBtn = document.getElementById('menuToggle');
const headerActionsMenu = document.getElementById('headerActionsMenu');

// Below the 720px breakpoint, the header icons collapse into this hamburger-triggered
// menu (see the .header-actions rules in that media query). Kept separate from
// setupDropdown/openDropdowns above: that mechanism closes every other open dropdown
// whenever one opens, which would immediately close this menu when its own nested
// "Contact us" dropdown (setupDropdown('contactToggle', ...) below) is opened from inside it.
function setHeaderMenuOpen(open) {
  headerActionsMenu.classList.toggle('is-open', open);
  menuToggleBtn.setAttribute('aria-expanded', String(open));
  const label = open ? 'Close menu' : 'Open menu';
  menuToggleBtn.setAttribute('aria-label', label);
  menuToggleBtn.setAttribute('title', label);
}

menuToggleBtn.addEventListener('click', (event) => {
  event.stopPropagation();
  setHeaderMenuOpen(!headerActionsMenu.classList.contains('is-open'));
});

headerActionsMenu.addEventListener('click', (event) => event.stopPropagation());

document.addEventListener('click', () => {
  closeAllDropdowns();
  setHeaderMenuOpen(false);
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  closeAllDropdowns({ restoreFocus: true });
  if (headerActionsMenu.classList.contains('is-open')) {
    setHeaderMenuOpen(false);
    menuToggleBtn.focus();
  }
});

const ABOUT_DIALOG_STORAGE_KEY = 'i2g-hide-about-dialog';

const aboutDialog = document.getElementById('aboutDialog');
const infoToggleBtn = document.getElementById('infoToggle');
const hideAboutCheckbox = document.getElementById('hideAboutCheckbox');

function getHideAboutPreference() {
  try {
    return localStorage.getItem(ABOUT_DIALOG_STORAGE_KEY) === 'true';
  } catch {
    // localStorage can throw in private-browsing/storage-blocked contexts —
    // fall back to always showing the dialog on load in that case.
    return false;
  }
}

function openAboutDialog() {
  hideAboutCheckbox.checked = getHideAboutPreference();
  aboutDialog.showModal();
}

// Fires on every close, whether via the X button, the Continue button, or
// Escape — each is the user's chance to set (or clear) their preference.
aboutDialog.addEventListener('close', () => {
  try {
    localStorage.setItem(ABOUT_DIALOG_STORAGE_KEY, String(hideAboutCheckbox.checked));
  } catch {
    // Ignore storage failures — worst case the dialog just shows again next time.
  }
});

infoToggleBtn.addEventListener('click', () => {
  openAboutDialog();
});

if (!getHideAboutPreference()) {
  openAboutDialog();
}

setupDropdown('contactToggle', 'contactPanel');

function renderFacilityList(listEl, statusEl, features, { nameField, spatial, onSelect }) {
  listEl.innerHTML = '';

  if (!features.length) {
    statusEl.textContent = 'No results found.';
    return;
  }
  statusEl.textContent = `${features.length} result${features.length === 1 ? '' : 's'} found.`;

  features.forEach((feature) => {
    const attrs = feature.attributes;
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'facility-item';

    const name = attrs[nameField] || '(Unnamed)';
    const address = attrs.est_address ? `, ${attrs.est_address}${attrs.est_city ? ', ' + attrs.est_city : ''}` : '';
    const rating = attrs.rating ? ` — Rating: ${attrs.rating}` : '';
    btn.textContent = `${name}${address}${rating}`;

    if (spatial) {
      btn.addEventListener('click', () => {
        // restoreFocus:true because this closes the panel btn itself lives in —
        // without it, focus would silently drop to <body> after selecting a result.
        closeAllDropdowns({ restoreFocus: true });
        onSelect(feature);
      });
    } else {
      btn.setAttribute('aria-expanded', 'false');
      const detail = document.createElement('div');
      detail.className = 'facility-detail';
      detail.hidden = true;
      const permit = attrs.permit_number ? `Permit #${attrs.permit_number}` : '';
      const inspected = attrs.inspection_date ? `Last inspected: ${new Date(attrs.inspection_date).toLocaleDateString()}` : '';
      detail.textContent = [permit, inspected].filter(Boolean).join(' — ') || 'No additional details available.';
      btn.addEventListener('click', () => {
        const expanded = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', String(!expanded));
        detail.hidden = expanded;
      });
      li.appendChild(btn);
      li.appendChild(detail);
      listEl.appendChild(li);
      return;
    }

    li.appendChild(btn);
    listEl.appendChild(li);
  });
}

async function goToFeature(restaurantLayer, feature) {
  feature.popupTemplate = restaurantLayer.popupTemplate;
  await view.goTo({ target: feature.geometry, zoom: 18 }).catch(() => {});
  view.popup.open({ location: feature.geometry, features: [feature] });
}

view.when(
  async () => {
    console.log('ArcGIS web map loaded successfully.');

    await webmap.load();
    const restaurantLayer = webmap.allLayers.find((l) => l.title === RESTAURANT_LAYER_TITLE);
    const mobileTable = webmap.allTables.find((t) => t.title === MOBILE_TABLE_TITLE);

    if (!restaurantLayer || !mobileTable) {
      console.error('Expected layer/table not found in web map.', { restaurantLayer, mobileTable });
      return;
    }

    await Promise.all([restaurantLayer.load(), mobileTable.load()]);

    createSearchWidget({ view, restaurantLayer });

    function applyMapFilter() {
      restaurantLayer.definitionExpression = buildRestaurantDefinitionExpression(filterState);
    }
    applyMapFilter();

    const restaurantListEl = document.getElementById('restaurantList');
    const restaurantStatusEl = document.getElementById('restaurantStatus');
    const restaurantNameFilter = document.getElementById('restaurantNameFilter');

    async function refreshRestaurantList() {
      restaurantStatusEl.textContent = 'Loading…';
      const { features } = await queryFacilityList(restaurantLayer, {
        isSchool: false,
        nameFilter: restaurantNameFilter.value.trim(),
        ratingClause: buildRatingClause(filterState.ratings)
      });
      renderFacilityList(restaurantListEl, restaurantStatusEl, features, {
        nameField: NAME_FIELD_RESTAURANT,
        spatial: true,
        onSelect: (f) => goToFeature(restaurantLayer, f)
      });
    }

    const schoolListEl = document.getElementById('schoolList');
    const schoolStatusEl = document.getElementById('schoolStatus');
    const schoolNameFilter = document.getElementById('schoolNameFilter');

    async function refreshSchoolList() {
      schoolStatusEl.textContent = 'Loading…';
      const { features } = await queryFacilityList(restaurantLayer, {
        isSchool: true,
        nameFilter: schoolNameFilter.value.trim(),
        ratingClause: buildRatingClause(filterState.ratings)
      });
      renderFacilityList(schoolListEl, schoolStatusEl, features, {
        nameField: NAME_FIELD_RESTAURANT,
        spatial: true,
        onSelect: (f) => goToFeature(restaurantLayer, f)
      });
    }

    const mobileListEl = document.getElementById('mobileList');
    const mobileStatusEl = document.getElementById('mobileStatus');
    const mobileNameFilter = document.getElementById('mobileNameFilter');

    async function refreshMobileList() {
      mobileStatusEl.textContent = 'Loading…';
      const { features } = await queryMobileList(mobileTable, {
        nameFilter: mobileNameFilter.value.trim()
      });
      renderFacilityList(mobileListEl, mobileStatusEl, features, {
        nameField: NAME_FIELD_MOBILE,
        spatial: false
      });
    }

    setupDropdown('restaurantsToggle', 'restaurantsPanel');
    setupDropdown('schoolsToggle', 'schoolsPanel');
    setupDropdown('mobileToggle', 'mobilePanel');

    document.getElementById('restaurantsPanel').addEventListener('first-open', refreshRestaurantList);
    document.getElementById('schoolsPanel').addEventListener('first-open', refreshSchoolList);
    document.getElementById('mobilePanel').addEventListener('first-open', refreshMobileList);

    async function downloadCategoryCsv(button, filename, columns, fetchRows) {
      const originalText = button.textContent;
      button.disabled = true;
      button.textContent = 'Preparing download…';
      try {
        const features = await fetchRows();
        downloadCsv(filename, toCsv(features.map((f) => f.attributes), columns));
      } catch (error) {
        console.error(`Failed to build CSV for ${filename}.`, error);
      } finally {
        button.disabled = false;
        button.textContent = originalText;
      }
    }

    const formatInspectionDate = (a) => (a.inspection_date ? new Date(a.inspection_date).toLocaleDateString() : '');

    const facilityCsvColumns = [
      { label: 'Name', value: (a) => a[NAME_FIELD_RESTAURANT] },
      { label: 'Address', value: (a) => a.est_address },
      { label: 'City', value: (a) => a.est_city },
      { label: 'Rating', value: (a) => a.rating },
      { label: 'Inspection Date', value: formatInspectionDate }
    ];

    document.getElementById('restaurantsCsvBtn').addEventListener('click', (e) => {
      downloadCategoryCsv(e.currentTarget, 'restaurants.csv', facilityCsvColumns, () =>
        queryAllFacilities(restaurantLayer, { isSchool: false })
      );
    });
    document.getElementById('schoolsCsvBtn').addEventListener('click', (e) => {
      downloadCategoryCsv(e.currentTarget, 'schools.csv', facilityCsvColumns, () =>
        queryAllFacilities(restaurantLayer, { isSchool: true })
      );
    });
    document.getElementById('mobileCsvBtn').addEventListener('click', (e) => {
      downloadCategoryCsv(
        e.currentTarget,
        'mobile-food-trucks.csv',
        [
          { label: 'Name', value: (a) => a[NAME_FIELD_MOBILE] },
          { label: 'Address', value: (a) => a.est_address },
          { label: 'City', value: (a) => a.est_city },
          { label: 'Rating', value: (a) => a.rating },
          { label: 'Permit #', value: (a) => a.permit_number },
          { label: 'Inspection Date', value: formatInspectionDate }
        ],
        () => queryAllMobile(mobileTable)
      );
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
        refreshRestaurantList();
        refreshSchoolList();
      });
    });

    restaurantNameFilter.addEventListener('input', debounce(refreshRestaurantList, 300));
    schoolNameFilter.addEventListener('input', debounce(refreshSchoolList, 300));
    mobileNameFilter.addEventListener('input', debounce(refreshMobileList, 300));
  },
  (error) => {
    container.innerHTML = '<div class="error-state">Unable to load the web map. Check that the item ID is valid and the map is shared publicly.</div>';
    console.error(error);
  }
);

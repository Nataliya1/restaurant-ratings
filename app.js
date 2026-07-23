import WebMap from 'https://js.arcgis.com/4.31/@arcgis/core/WebMap.js';
import MapView from 'https://js.arcgis.com/4.31/@arcgis/core/views/MapView.js';

import { WEBMAP_ITEM_ID, RESTAURANT_LAYER_TITLE, MOBILE_TABLE_TITLE, NAME_FIELD_RESTAURANT, NAME_FIELD_MOBILE } from './js/config.js';
import { buildRestaurantDefinitionExpression, buildRatingClause } from './js/filters.js';
import { queryFacilityList, queryMobileList } from './js/lists.js';
import { createSearchWidget } from './js/search.js';

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
    components: ['zoom', 'compass', 'attribution']
  }
});

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

function setupDisclosure(buttonId, panelId) {
  const button = document.getElementById(buttonId);
  const panel = document.getElementById(panelId);
  let loaded = false;

  button.addEventListener('click', () => {
    const expanded = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', String(!expanded));
    panel.hidden = expanded;
    button.querySelector('.disclosure-icon').textContent = expanded ? '+' : '−';

    if (!expanded && !loaded) {
      loaded = true;
      panel.dispatchEvent(new CustomEvent('first-open'));
    }
  });
}

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
      btn.addEventListener('click', () => onSelect(feature));
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

    createSearchWidget({ view, container: 'searchContainer', restaurantLayer });

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
        nameFilter: schoolNameFilter.value.trim()
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

    setupDisclosure('restaurantsToggle', 'restaurantsPanel');
    setupDisclosure('schoolsToggle', 'schoolsPanel');
    setupDisclosure('mobileToggle', 'mobilePanel');

    document.getElementById('restaurantsPanel').addEventListener('first-open', refreshRestaurantList);
    document.getElementById('schoolsPanel').addEventListener('first-open', refreshSchoolList);
    document.getElementById('mobilePanel').addEventListener('first-open', refreshMobileList);

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

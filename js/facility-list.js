import WebMap from 'https://js.arcgis.com/4.31/@arcgis/core/WebMap.js';

import {
  WEBMAP_ITEM_ID,
  RESTAURANT_LAYER_TITLE,
  MOBILE_TABLE_TITLE,
  NAME_FIELD_RESTAURANT,
  NAME_FIELD_MOBILE,
  RATING_GRADES
} from './config.js';
import { buildRatingClause } from './filters.js';
import { queryFacilityList, queryMobileList } from './lists.js';
import { toCsv, downloadCsv } from './csv.js';
import { setupHeader } from './header.js';
import { syncRatingCheckboxesWithStorage } from './rating-filter-sync.js';

setupHeader();

// This page has no MapView/rendering — just WebMap.load() to reach the same two
// data sources app.js uses, reusing its query/dedupe functions so "grouped by
// type, most recent inspection only" always matches what the map itself shows.
const webmap = new WebMap({ portalItem: { id: WEBMAP_ITEM_ID } });

const ALL_RATINGS_ON = { A: true, B: true, C: true, D: true, F: true, OTHER: true };
const GRADE_VALUES = new Set(RATING_GRADES.map((g) => g.value));

function gradeImageSrc(rating) {
  const grade = (rating || '').toUpperCase();
  return GRADE_VALUES.has(grade) ? `./images/rating-${grade.toLowerCase()}.png` : './images/rating-nr.png';
}

function formatDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString();
}

function matchesRatingFilter(rating, ratingState) {
  const grade = (rating || '').toUpperCase();
  if (GRADE_VALUES.has(grade)) return !!ratingState[grade];
  return !!ratingState.OTHER;
}

/** Builds one <li><article> card. `kind` controls which fields are shown (mobile trucks lack a few). */
function buildCard(feature, { nameField, kind }) {
  const attrs = feature.attributes;
  const name = attrs[nameField] || '(Unnamed)';
  const address = [attrs.est_address, attrs.est_city].filter(Boolean).join(', ');
  const rating = attrs.rating || '';
  const inspectionDate = formatDate(attrs.inspection_date);

  const li = document.createElement('li');
  li.className = 'facility-card-item';
  li.dataset.name = name.toLowerCase();
  li.dataset.rating = rating.toUpperCase();

  const article = document.createElement('article');
  article.className = 'facility-card';
  const headingId = `fc-${kind}-${attrs.ObjectID ?? attrs.ObjectId}`;
  article.setAttribute('aria-labelledby', headingId);

  const heading = document.createElement('h4');
  heading.id = headingId;
  heading.className = 'facility-card-name';
  heading.textContent = name;
  article.appendChild(heading);

  if (address) {
    const addressEl = document.createElement('p');
    addressEl.className = 'facility-card-address';
    addressEl.textContent = address;
    article.appendChild(addressEl);
  }

  const meta = document.createElement('dl');
  meta.className = 'facility-card-meta';

  function addMetaRow(term, valueText) {
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = valueText;
    meta.appendChild(dt);
    meta.appendChild(dd);
  }

  if (rating) {
    const dt = document.createElement('dt');
    dt.textContent = 'Rating';
    const dd = document.createElement('dd');
    dd.className = 'facility-card-rating';
    const img = document.createElement('img');
    img.src = gradeImageSrc(rating);
    img.alt = rating;
    img.width = 22;
    img.height = 22;
    dd.appendChild(img);
    meta.appendChild(dt);
    meta.appendChild(dd);
  }

  if (inspectionDate) addMetaRow('Last inspected', inspectionDate);
  if (kind !== 'mobile' && attrs.inspection_frequency) addMetaRow('Inspection frequency', `${attrs.inspection_frequency} days`);
  if (kind === 'mobile' && attrs.permit_number) addMetaRow('Permit #', String(attrs.permit_number));

  article.appendChild(meta);

  if (kind !== 'mobile' && attrs.downloadDetailsUrl) {
    const link = document.createElement('a');
    link.className = 'facility-card-link';
    link.href = attrs.downloadDetailsUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'View document';
    const hidden = document.createElement('span');
    hidden.className = 'visually-hidden';
    hidden.textContent = ' (opens in a new tab)';
    link.appendChild(hidden);
    article.appendChild(link);
  }

  li.appendChild(article);
  return li;
}

function appendCards(listEl, features, { nameField, kind }) {
  const frag = document.createDocumentFragment();
  features.forEach((feature) => frag.appendChild(buildCard(feature, { nameField, kind })));
  listEl.appendChild(frag);
}

// Thousands of cards up front is a lot for a screen reader or keyboard user to page
// through, so each group renders only its first RENDER_LIMIT cards until the user
// asks for more — via its "Show all" button, or (for the groups that start
// collapsed) by opening the <details> itself. All of a group's data is already in
// memory from the fetch below, so "load more" is just building/appending more <li>
// elements, never an extra request.
const RENDER_LIMIT = 15;

function createGroupState({ listEl, countEl, statusEl, loadAllBtn, detailsEl, features, nameField, kind, label }) {
  countEl.textContent = `(${features.length})`;
  return { listEl, countEl, statusEl, loadAllBtn, detailsEl, features, nameField, kind, label, rendered: 0 };
}

function updateLoadMoreUi(state) {
  const total = state.features.length;
  if (state.rendered >= total) {
    state.loadAllBtn.hidden = true;
    state.statusEl.textContent = total > RENDER_LIMIT ? `Showing all ${total.toLocaleString()} ${state.label}.` : '';
  } else {
    state.loadAllBtn.hidden = false;
    state.loadAllBtn.textContent = `Show all ${total.toLocaleString()} ${state.label}`;
    state.statusEl.textContent = `Showing ${state.rendered.toLocaleString()} of ${total.toLocaleString()} ${state.label}.`;
  }
}

function renderMore(state, count) {
  const start = state.rendered;
  const end = Math.min(state.features.length, start + count);
  appendCards(state.listEl, state.features.slice(start, end), { nameField: state.nameField, kind: state.kind });
  state.rendered = end;
  updateLoadMoreUi(state);
}

function ensureBuilt(state) {
  if (state.rendered === 0) renderMore(state, RENDER_LIMIT);
}

function ensureFullyLoaded(state) {
  if (state.rendered < state.features.length) renderMore(state, state.features.length - state.rendered);
}

const LIST_ID_TO_COUNT_ID = {
  restaurantCards: 'restaurantsCount',
  schoolCards: 'schoolsCount',
  mobileCards: 'mobileCount'
};

function applyFilters({ nameQuery, ratingState }) {
  const query = nameQuery.trim().toLowerCase();
  let visibleTotal = 0;

  document.querySelectorAll('.facility-cards').forEach((list) => {
    const applyRating = list.dataset.ratingFilterable === 'true';
    let visibleInGroup = 0;
    list.querySelectorAll('.facility-card-item').forEach((li) => {
      const nameMatches = !query || li.dataset.name.includes(query);
      const ratingMatches = !applyRating || matchesRatingFilter(li.dataset.rating, ratingState);
      const show = nameMatches && ratingMatches;
      li.hidden = !show;
      if (show) visibleInGroup += 1;
    });
    visibleTotal += visibleInGroup;
    const countEl = document.getElementById(LIST_ID_TO_COUNT_ID[list.id]);
    if (countEl) countEl.textContent = `(${visibleInGroup})`;
  });

  return visibleTotal;
}

(async () => {
  const statusEl = document.getElementById('facilityListStatus');
  const restaurantCardsEl = document.getElementById('restaurantCards');
  const schoolCardsEl = document.getElementById('schoolCards');
  const mobileCardsEl = document.getElementById('mobileCards');
  const nameFilterEl = document.getElementById('facilityNameFilter');

  restaurantCardsEl.dataset.ratingFilterable = 'true';
  schoolCardsEl.dataset.ratingFilterable = 'true';
  mobileCardsEl.dataset.ratingFilterable = 'false';

  try {
    await webmap.load();
    const restaurantLayer = webmap.allLayers.find((l) => l.title === RESTAURANT_LAYER_TITLE);
    const mobileTable = webmap.allTables.find((t) => t.title === MOBILE_TABLE_TITLE);

    if (!restaurantLayer || !mobileTable) {
      statusEl.textContent = 'Unable to load facility data right now. Please try again later.';
      return;
    }

    await Promise.all([restaurantLayer.load(), mobileTable.load()]);

    const ratingClause = buildRatingClause(ALL_RATINGS_ON);
    const [{ features: restaurants }, { features: schools }, { features: mobileTrucks }] = await Promise.all([
      queryFacilityList(restaurantLayer, { isSchool: false, nameFilter: '', ratingClause }),
      queryFacilityList(restaurantLayer, { isSchool: true, nameFilter: '', ratingClause }),
      queryMobileList(mobileTable, { nameFilter: '' })
    ]);

    const restaurantsState = createGroupState({
      listEl: restaurantCardsEl,
      countEl: document.getElementById('restaurantsCount'),
      statusEl: document.getElementById('restaurantsLoadStatus'),
      loadAllBtn: document.getElementById('restaurantsLoadAllBtn'),
      detailsEl: document.getElementById('restaurantsGroup'),
      features: restaurants,
      nameField: NAME_FIELD_RESTAURANT,
      kind: 'restaurant',
      label: 'restaurants'
    });
    const schoolsState = createGroupState({
      listEl: schoolCardsEl,
      countEl: document.getElementById('schoolsCount'),
      statusEl: document.getElementById('schoolsLoadStatus'),
      loadAllBtn: document.getElementById('schoolsLoadAllBtn'),
      detailsEl: document.getElementById('schoolsGroup'),
      features: schools,
      nameField: NAME_FIELD_RESTAURANT,
      kind: 'school',
      label: 'schools'
    });
    const mobileState = createGroupState({
      listEl: mobileCardsEl,
      countEl: document.getElementById('mobileCount'),
      statusEl: document.getElementById('mobileLoadStatus'),
      loadAllBtn: document.getElementById('mobileLoadAllBtn'),
      detailsEl: document.getElementById('mobileGroup'),
      features: mobileTrucks,
      nameField: NAME_FIELD_MOBILE,
      kind: 'mobile',
      label: 'mobile food trucks'
    });
    const groupStates = [restaurantsState, schoolsState, mobileState];

    // Restaurants' <details> starts open, so build its first page right away.
    // Schools/Mobile start collapsed — build their first page only once a user
    // actually opens them, so that work isn't spent on sections nobody looks at.
    ensureBuilt(restaurantsState);
    [schoolsState, mobileState].forEach((state) => {
      state.detailsEl.addEventListener('toggle', () => {
        if (state.detailsEl.open) ensureBuilt(state);
      });
    });

    const total = restaurants.length + schools.length + mobileTrucks.length;
    statusEl.textContent = `${total} facilities loaded: ${restaurants.length} restaurants, ${schools.length} schools, ${mobileTrucks.length} mobile food trucks.`;

    // The data for these is already in memory from the queries above (both
    // queried with every rating on, same as app.js's own CSV buttons on the map
    // page), so — unlike app.js's downloadCategoryCsv — there's no extra fetch
    // needed here, just build and download.
    const formatInspectionDate = (a) => (a.inspection_date ? new Date(a.inspection_date).toLocaleDateString() : '');
    const facilityCsvColumns = [
      { label: 'Name', value: (a) => a[NAME_FIELD_RESTAURANT] },
      { label: 'Address', value: (a) => a.est_address },
      { label: 'City', value: (a) => a.est_city },
      { label: 'Rating', value: (a) => a.rating },
      { label: 'Inspection Date', value: formatInspectionDate },
      { label: 'Inspection Frequency', value: (a) => a.inspection_frequency }
    ];
    const mobileCsvColumns = [
      { label: 'Name', value: (a) => a[NAME_FIELD_MOBILE] },
      { label: 'Address', value: (a) => a.est_address },
      { label: 'City', value: (a) => a.est_city },
      { label: 'Rating', value: (a) => a.rating },
      { label: 'Inspection Date', value: formatInspectionDate },
      { label: 'Inspection Frequency', value: (a) => a.inspection_frequency }
    ];

    document.getElementById('restaurantsCsvBtn').addEventListener('click', () => {
      downloadCsv('restaurants.csv', toCsv(restaurants.map((f) => f.attributes), facilityCsvColumns));
    });
    document.getElementById('schoolsCsvBtn').addEventListener('click', () => {
      downloadCsv('schools.csv', toCsv(schools.map((f) => f.attributes), facilityCsvColumns));
    });
    document.getElementById('mobileCsvBtn').addEventListener('click', () => {
      downloadCsv('mobile-food-trucks.csv', toCsv(mobileTrucks.map((f) => f.attributes), mobileCsvColumns));
    });

    function getRatingState() {
      const state = {};
      document.querySelectorAll('.rating-check').forEach((el) => {
        state[el.dataset.grade] = el.checked;
      });
      return state;
    }

    function refresh() {
      const nameQuery = nameFilterEl.value;
      const ratingState = getRatingState();
      const filtersActive = nameQuery.trim() !== '' || Object.values(ratingState).some((on) => !on);

      if (filtersActive) {
        // Filtering only ever shows/hides cards already in the DOM (see applyFilters
        // above), so an active filter has to force every group fully loaded and
        // expanded first — otherwise a match sitting past the initial page, or inside
        // a still-collapsed section, would silently be missed instead of just not yet
        // visible.
        groupStates.forEach((state) => {
          ensureFullyLoaded(state);
          if (!state.detailsEl.open) state.detailsEl.open = true;
        });
        const visibleTotal = applyFilters({ nameQuery, ratingState });
        statusEl.textContent = `${visibleTotal} of ${total} facilities shown.`;
      } else {
        // Nothing to filter — every card should be visible and each heading count
        // should read its group's true total. Reset explicitly instead of running
        // applyFilters, which would scan (and wrongly zero out the count of) any
        // group that's still collapsed and hasn't rendered any cards yet.
        document.querySelectorAll('.facility-card-item').forEach((li) => {
          li.hidden = false;
        });
        groupStates.forEach((state) => {
          state.countEl.textContent = `(${state.features.length})`;
        });
        statusEl.textContent = `${total} of ${total} facilities shown.`;
      }
    }

    groupStates.forEach((state) => {
      state.loadAllBtn.addEventListener('click', () => {
        ensureFullyLoaded(state);
        refresh();
        // The button that was just focused is now hidden (everything's loaded), which
        // would otherwise silently drop keyboard focus to <body>. Move it to the status
        // message instead, so a keyboard user's next Tab continues from the same spot
        // rather than restarting from the top of the page.
        state.statusEl.focus();
      });
    });

    document.querySelectorAll('.rating-check').forEach((el) => {
      el.addEventListener('change', refresh);
    });
    nameFilterEl.addEventListener('input', refresh);

    // Restore whatever rating filter was last set here or on the map page
    // (separate page loads, so sessionStorage is the only way the two stay in
    // sync), then reapply filtering/expansion immediately if that restored a
    // non-default selection.
    syncRatingCheckboxesWithStorage(() => refresh());
  } catch (err) {
    console.error('Failed to load facility list.', err);
    statusEl.textContent = 'Unable to load facility data right now. Please try again later.';
  }
})();

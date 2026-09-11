import Feature from 'https://js.arcgis.com/4.31/@arcgis/core/widgets/Feature.js';
import { FACILITY_ZOOM_SCALE, NAME_FIELD_RESTAURANT } from './config.js';

/**
 * Renders every currently-selected facility's popup content into `container` as
 * its own list item, instead of Esri's default one-at-a-time-with-a-pager
 * behavior (confirmed, by reading esri/widgets/Features' own source, to be
 * next()/previous() over a single displayed feature — there's no built-in
 * "show all selected features at once" mode to opt into). One esri/widgets/Feature
 * (singular) instance per graphic gives each its own content and its own "Zoom
 * to" button, with a visible divider between records so multiple stacked
 * inspection rows at one location (or multiple nearby facilities caught by one
 * click) read as clearly separate entries rather than one ambiguous block.
 *
 * @param {{ view: __esri.MapView, container: HTMLElement }} options
 * @returns {{ render: (features: __esri.Graphic[]) => void }}
 */
export function renderFacilityDetails({ view, container }) {
  let currentWidgets = [];

  function clear() {
    currentWidgets.forEach((widget) => widget.destroy());
    currentWidgets = [];
    container.replaceChildren();
  }

  // Used for feedback that isn't a facility at all (e.g. an address search
  // that found no facility nearby) — a plain message in place of the usual
  // feature cards, still inside the same container so it appears/disappears
  // exactly where facility results normally do.
  function renderMessage(text) {
    clear();
    const message = document.createElement('p');
    message.className = 'facility-details-empty';
    message.textContent = text;
    container.appendChild(message);
  }

  // Shared by renderNearbyList and renderMultipleMatches below — both are
  // "here are some real, selectable facilities, pick one" lists that only
  // differ in their intro sentence and whether a distance is shown.
  // Real keyboard/screen-reader-operable buttons rather than a "look at the
  // map" instruction, which is unusable for a screen-reader or low-vision
  // user (raised directly in conversation). Activating one selects it
  // exactly the way picking it from the search bar directly would
  // (js/search.js's onSelect callback drives that).
  function renderChoiceList(entries, { onSelect, introText }) {
    clear();

    const intro = document.createElement('p');
    intro.className = 'facility-details-empty';
    intro.textContent = introText;
    container.appendChild(intro);

    const list = document.createElement('ul');
    list.className = 'facility-nearby-list';

    entries.forEach(({ graphic, distanceMiles }) => {
      const item = document.createElement('li');

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'facility-nearby-item';

      const nameEl = document.createElement('span');
      nameEl.className = 'facility-nearby-name';
      nameEl.textContent = graphic.attributes[NAME_FIELD_RESTAURANT] || 'Unnamed facility';

      const metaEl = document.createElement('span');
      metaEl.className = 'facility-nearby-meta';
      const address = graphic.attributes.est_address;
      const distanceText = distanceMiles != null ? formatDistance(distanceMiles) : null;
      metaEl.textContent = address && distanceText ? `${address} — ${distanceText}` : (address || distanceText || '');

      btn.append(nameEl, metaEl);

      // A real, known data gap (some addresses have never been geocoded) —
      // flagged here too, not just after picking it, so it isn't a surprise
      // that this particular choice won't be able to zoom to anything.
      if (!graphic.geometry) {
        const noLocationEl = document.createElement('span');
        noLocationEl.className = 'facility-nearby-no-location';
        noLocationEl.textContent = 'Map location unavailable';
        btn.appendChild(noLocationEl);
      }
      btn.addEventListener('click', () => onSelect(graphic));

      item.appendChild(btn);
      list.appendChild(item);
    });

    container.appendChild(list);
  }

  // Used when an address search lands nowhere near an actual facility.
  function renderNearbyList(entries, { onSelect }) {
    renderChoiceList(entries, {
      onSelect,
      introText: entries.length === 1
        ? 'No food facility was found at this exact address. 1 nearby option:'
        : `No food facility was found at this exact address. ${entries.length} nearby options, closest first:`
    });
  }

  // Used when a facility-name search (typed and submitted directly, not
  // picked from the suggestion dropdown) matches more than one facility —
  // e.g. "early bird" matching "Early Bird", "Early Bird Brunch", etc.
  // Auto-selecting the first one would be guessing on the user's behalf
  // (same reasoning as renderNearbyList above); a real list lets them pick
  // the one they actually meant.
  function renderMultipleMatches(entries, { onSelect, query }) {
    renderChoiceList(entries, {
      onSelect,
      introText: entries.length === 1
        ? `1 facility matches "${query}":`
        : `${entries.length} facilities match "${query}". Choose one:`
    });
  }

  function formatDistance(miles) {
    if (miles < 0.1) {
      const feet = Math.round((miles * 5280) / 10) * 10;
      return `${feet} ft away`;
    }
    return `${miles.toFixed(1)} mi away`;
  }

  // Shown above the selected facility's card(s) only when that selection was
  // reached by picking an entry off one of the choice lists above (nearby
  // facilities, or multiple name matches — see app.js's use of both)
  // — otherwise there's nothing to go back *to*. onBack re-renders that same
  // list from the entries the caller already has in hand rather than
  // re-querying.
  function renderBackToNearbyButton(onBack) {
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'facility-back-to-nearby-btn';
    backBtn.textContent = '← Back to results';
    backBtn.addEventListener('click', onBack);
    container.appendChild(backBtn);
  }

  function render(features, { onBackToNearby } = {}) {
    clear();
    if (!features || !features.length) return;

    if (onBackToNearby) renderBackToNearbyButton(onBackToNearby);

    const list = document.createElement('ul');
    list.className = 'facility-feature-list';

    features.forEach((graphic) => {
      const item = document.createElement('li');
      item.className = 'facility-feature-item';

      // A real, known data gap, not a bug here: some facilities' addresses
      // have never been geocoded, so there's nothing for the map to show or
      // zoom to. Still shows the rest of its details below (name, rating,
      // inspection history) rather than hiding the whole record — just says
      // so plainly instead of silently omitting the zoom button.
      if (!graphic.geometry) {
        const noLocationNote = document.createElement('p');
        noLocationNote.className = 'facility-missing-location-note';
        noLocationNote.textContent = 'Map location unavailable for this facility — its address has a known data issue that needs correcting at the source.';
        item.appendChild(noLocationNote);
      }

      const featureContainer = document.createElement('div');
      item.appendChild(featureContainer);

      const featureWidget = new Feature({
        view,
        graphic,
        container: featureContainer,
        visibleElements: { title: true, content: true, lastEditedInfo: false }
      });
      currentWidgets.push(featureWidget);

      if (graphic.geometry) {
        const zoomBtn = document.createElement('button');
        zoomBtn.type = 'button';
        zoomBtn.className = 'facility-feature-zoom-btn';
        zoomBtn.setAttribute('aria-label', 'Zoom to this facility');
        zoomBtn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
            <circle cx="10" cy="10" r="6" />
            <line x1="14.5" y1="14.5" x2="20" y2="20" />
          </svg>
          Zoom to
        `;
        zoomBtn.addEventListener('click', () => {
          view.goTo({ target: graphic.geometry, scale: FACILITY_ZOOM_SCALE }).catch(() => {});
        });
        item.appendChild(zoomBtn);
      }

      list.appendChild(item);
    });

    container.appendChild(list);
  }

  return { render, clear, renderMessage, renderNearbyList, renderMultipleMatches };
}

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

  // Used when an address search lands nowhere near an actual facility: a
  // "look at the map" instruction is unusable for a screen-reader or
  // low-vision user (raised directly in conversation), so this offers real,
  // keyboard/screen-reader-operable choices instead — the nearest facilities
  // within a search radius, closest first, each with its own distance.
  // Activating one selects it exactly the way picking it from the search bar
  // directly would (js/search.js's onSelect callback drives that).
  function renderNearbyList(entries, { onSelect }) {
    clear();

    const intro = document.createElement('p');
    intro.className = 'facility-details-empty';
    intro.textContent = entries.length === 1
      ? 'No food facility was found at this exact address. 1 nearby option:'
      : `No food facility was found at this exact address. ${entries.length} nearby options, closest first:`;
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
      metaEl.textContent = address ? `${address} — ${formatDistance(distanceMiles)}` : formatDistance(distanceMiles);

      btn.append(nameEl, metaEl);
      btn.addEventListener('click', () => onSelect(graphic));

      item.appendChild(btn);
      list.appendChild(item);
    });

    container.appendChild(list);
  }

  function formatDistance(miles) {
    if (miles < 0.1) {
      const feet = Math.round((miles * 5280) / 10) * 10;
      return `${feet} ft away`;
    }
    return `${miles.toFixed(1)} mi away`;
  }

  function render(features) {
    clear();
    if (!features || !features.length) return;

    const list = document.createElement('ul');
    list.className = 'facility-feature-list';

    features.forEach((graphic) => {
      const item = document.createElement('li');
      item.className = 'facility-feature-item';

      const featureContainer = document.createElement('div');
      item.appendChild(featureContainer);

      const featureWidget = new Feature({
        view,
        graphic,
        container: featureContainer,
        visibleElements: { title: true, content: true, lastEditedInfo: false }
      });
      currentWidgets.push(featureWidget);

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
        if (graphic.geometry) {
          view.goTo({ target: graphic.geometry, scale: FACILITY_ZOOM_SCALE }).catch(() => {});
        }
      });
      item.appendChild(zoomBtn);

      list.appendChild(item);
    });

    container.appendChild(list);
  }

  return { render, clear, renderMessage, renderNearbyList };
}

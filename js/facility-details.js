import Feature from 'https://js.arcgis.com/4.31/@arcgis/core/widgets/Feature.js';

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
      zoomBtn.textContent = 'Zoom to';
      zoomBtn.setAttribute('aria-label', 'Zoom to this facility');
      zoomBtn.addEventListener('click', () => {
        if (graphic.geometry) view.goTo(graphic.geometry).catch(() => {});
      });
      item.appendChild(zoomBtn);

      list.appendChild(item);
    });

    container.appendChild(list);
  }

  return { render, clear };
}

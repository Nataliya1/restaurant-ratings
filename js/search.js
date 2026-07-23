import Search from 'https://js.arcgis.com/4.31/@arcgis/core/widgets/Search.js';
import LocatorSearchSource from 'https://js.arcgis.com/4.31/@arcgis/core/widgets/Search/LocatorSearchSource.js';
import LayerSearchSource from 'https://js.arcgis.com/4.31/@arcgis/core/widgets/Search/LayerSearchSource.js';
import { CUSTOM_GEOCODER_URL, CUSTOM_GEOCODER_NAME, NAME_FIELD_RESTAURANT } from './config.js';

const ESRI_WORLD_GEOCODER_URL = 'https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer';

/**
 * Builds the Search widget with multiple, independently-selectable sources:
 * an address geocoder (Esri now, your custom one once CUSTOM_GEOCODER_URL is set)
 * plus a facility-name lookup against the Restaurant Inspections layer (covers
 * both restaurants and schools, since they share that layer).
 */
export function createSearchWidget({ view, container, restaurantLayer }) {
  const sources = [
    new LocatorSearchSource({
      name: 'Address (Esri World Geocoder)',
      url: ESRI_WORLD_GEOCODER_URL,
      singleLineFieldName: 'SingleLine',
      placeholder: 'Search an address'
    }),
    new LayerSearchSource({
      layer: restaurantLayer,
      name: 'Facility name (restaurants & schools)',
      searchFields: [NAME_FIELD_RESTAURANT],
      displayField: NAME_FIELD_RESTAURANT,
      exactMatch: false,
      outFields: ['*'],
      placeholder: 'Search a facility name',
      maxSuggestions: 10,
      zoomScale: 2000
    })
  ];

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

  return new Search({
    view,
    container,
    includeDefaultSources: false,
    sources,
    popupEnabled: true
  });
}

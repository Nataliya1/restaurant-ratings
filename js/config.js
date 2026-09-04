export const WEBMAP_ITEM_ID = '9eedc8e4e4b345a08521ca2d6c946f2b';

export const RESTAURANT_LAYER_TITLE = 'Restaurant Inspections';
export const MOBILE_TABLE_TITLE = 'MobileFoodInspections';

// facility_types_primary can hold a comma-separated list of codes (e.g. "01A, 20A").
// Douglas County confirmed: any record whose code list includes 20A is a school;
// everything else in the Restaurant Inspections layer is a restaurant.
export const SCHOOL_TOKEN = '20A';

export const NAME_FIELD_RESTAURANT = 'est_name';
export const NAME_FIELD_MOBILE = 'unit_name';

// `color` mirrors the fill color baked into images/rating-*.png (sampled from the icons
// the county produced from the AGOL web map's point renderer), kept here only as reference
// documentation — the filter ribbon renders the icons directly, not these values.
export const RATING_GRADES = [
  { value: 'A', label: 'A', color: [21, 67, 96] },
  { value: 'B', label: 'B', color: [33, 97, 140] },
  { value: 'C', label: 'C', color: [125, 102, 8] },
  { value: 'D', label: 'D', color: [184, 92, 0] },
  { value: 'F', label: 'F', color: [146, 43, 33] }
];

export const OTHER_RATING = { value: 'OTHER', label: 'Not rated / other', color: [89, 89, 89] };

// Set to '' to hide this source (search will then only match facility names, no address geocoding).
export const CUSTOM_GEOCODER_URL = 'https://dcgis.org/server/rest/services/Geocoders/PointAddress_and_Street_Roles/GeocodeServer';
export const CUSTOM_GEOCODER_NAME = 'Douglas County Geocoder';

// Map scale (1:N) to zoom to when centering on a single facility — selecting a
// search result (js/search.js) and clicking a facility card's "Zoom to" button
// (js/facility-details.js) both use this, so either path lands at the same zoom.
export const FACILITY_ZOOM_SCALE = 5000;

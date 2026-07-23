export const WEBMAP_ITEM_ID = '9eedc8e4e4b345a08521ca2d6c946f2b';

export const RESTAURANT_LAYER_TITLE = 'Restaurant Inspections';
export const MOBILE_TABLE_TITLE = 'MobileFoodInspections';

// facility_types_primary can hold a comma-separated list of codes (e.g. "01A, 20A").
// Douglas County confirmed: any record whose code list includes 20A is a school;
// everything else in the Restaurant Inspections layer is a restaurant.
export const SCHOOL_TOKEN = '20A';

export const NAME_FIELD_RESTAURANT = 'est_name';
export const NAME_FIELD_MOBILE = 'unit_name';

// Colors copied from the web map's own uniqueValue renderer (field: rating) so the
// legend/filter swatches always match what's actually drawn on the map.
export const RATING_GRADES = [
  { value: 'A', label: 'A', color: [90, 133, 90] },
  { value: 'B', label: 'B', color: [139, 224, 78] },
  { value: 'C', label: 'C', color: [239, 242, 61] },
  { value: 'D', label: 'D', color: [247, 184, 37] },
  { value: 'F', label: 'F', color: [255, 41, 26] }
];

export const OTHER_RATING = { value: 'OTHER', label: 'Not rated / other', color: [170, 170, 170] };

// Set to '' to hide this source and fall back to the Esri World Geocoder only.
export const CUSTOM_GEOCODER_URL = 'https://dcgis.org/server/rest/services/Geocoders/PointAddress_and_Street_Roles/GeocodeServer';
export const CUSTOM_GEOCODER_NAME = 'Douglas County Geocoder';

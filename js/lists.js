import { SCHOOL_TOKEN, NAME_FIELD_RESTAURANT, NAME_FIELD_MOBILE } from './config.js';

const RESTAURANT_FIELDS = [
  'ObjectID',
  NAME_FIELD_RESTAURANT,
  'est_address',
  'est_city',
  'rating',
  'facility_types_primary',
  'firm_number',
  'inspection_id',
  'inspection_date',
  // Not used by the list/CSV UI, but referenced by the webmap layer's own popup
  // template — needed so clicking a list item opens a fully-populated popup.
  'inspection_frequency',
  'downloadDetailsUrl'
];
const MOBILE_FIELDS = [
  'ObjectId',
  NAME_FIELD_MOBILE,
  'est_address',
  'est_city',
  'rating',
  'permit_number',
  'firm_number',
  'inspection_id',
  'inspection_date'
];

function escapeForSql(value) {
  return value.replace(/'/g, "''").toUpperCase();
}

/**
 * A place (firm_number) has one row per inspection. Keeps only the most recent
 * inspection per firm_number (by inspection_date, tying-broken by inspection_id),
 * so lists/downloads show unique places instead of one row per historical inspection.
 * Falls back to the OID when firm_number is missing, so those rows aren't merged together.
 */
function dedupeToLatestPerFirm(features) {
  const latestByKey = new Map();

  for (const feature of features) {
    const attrs = feature.attributes;
    const key = attrs.firm_number != null ? `firm:${attrs.firm_number}` : `oid:${attrs.ObjectID ?? attrs.ObjectId}`;
    const existing = latestByKey.get(key);

    if (!existing) {
      latestByKey.set(key, feature);
      continue;
    }

    const existingAttrs = existing.attributes;
    const isNewer =
      (attrs.inspection_date ?? 0) > (existingAttrs.inspection_date ?? 0) ||
      ((attrs.inspection_date ?? 0) === (existingAttrs.inspection_date ?? 0) && (attrs.inspection_id ?? 0) > (existingAttrs.inspection_id ?? 0));

    if (isNewer) {
      latestByKey.set(key, feature);
    }
  }

  return Array.from(latestByKey.values());
}

const PAGE_SIZE = 1000;

/** Pages through queryFeatures until every matching record has been fetched. */
async function queryAllPages(layerOrTable, baseParams) {
  let start = 0;
  let all = [];
  for (;;) {
    const result = await layerOrTable.queryFeatures({ returnGeometry: false, ...baseParams, num: PAGE_SIZE, start });
    all = all.concat(result.features);
    if (result.features.length < PAGE_SIZE) break;
    start += PAGE_SIZE;
  }
  return all;
}

/**
 * Queries the shared Restaurant Inspections layer, scoped to either the restaurant
 * or school subset (via SCHOOL_TOKEN), optionally filtered by name and by the same
 * rating clause applied to the map (ratings are grouped across both subsets).
 * Returns one row per unique place (firm_number), keeping its most recent inspection.
 */
export async function queryFacilityList(layer, { isSchool, nameFilter, ratingClause } = {}) {
  const categoryClause = isSchool
    ? `UPPER(facility_types_primary) LIKE '%${SCHOOL_TOKEN}%'`
    : `UPPER(facility_types_primary) NOT LIKE '%${SCHOOL_TOKEN}%'`;
  const nameClause = nameFilter
    ? `UPPER(${NAME_FIELD_RESTAURANT}) LIKE '%${escapeForSql(nameFilter)}%'`
    : '1=1';
  const ratingWhere = ratingClause ? ` AND ${ratingClause}` : '';

  const features = await queryAllPages(layer, {
    where: `${categoryClause} AND ${nameClause}${ratingWhere}`,
    outFields: RESTAURANT_FIELDS,
    orderByFields: [`${NAME_FIELD_RESTAURANT} ASC`],
    returnGeometry: true
  });
  return { features: dedupeToLatestPerFirm(features) };
}

/**
 * Queries the non-spatial MobileFoodInspections table, optionally filtered by name.
 * Returns one row per unique place (firm_number), keeping its most recent inspection.
 */
export async function queryMobileList(table, { nameFilter } = {}) {
  const nameClause = nameFilter
    ? `UPPER(${NAME_FIELD_MOBILE}) LIKE '%${escapeForSql(nameFilter)}%'`
    : '1=1';

  const features = await queryAllPages(table, {
    where: nameClause,
    outFields: MOBILE_FIELDS,
    orderByFields: [`${NAME_FIELD_MOBILE} ASC`]
  });
  return { features: dedupeToLatestPerFirm(features) };
}

/** Fetches every restaurant or school place (ignores name/rating filters) for CSV export, most recent inspection only. */
export async function queryAllFacilities(layer, { isSchool }) {
  const categoryClause = isSchool
    ? `UPPER(facility_types_primary) LIKE '%${SCHOOL_TOKEN}%'`
    : `UPPER(facility_types_primary) NOT LIKE '%${SCHOOL_TOKEN}%'`;

  const features = await queryAllPages(layer, {
    where: categoryClause,
    outFields: RESTAURANT_FIELDS,
    orderByFields: [`${NAME_FIELD_RESTAURANT} ASC`]
  });
  return dedupeToLatestPerFirm(features);
}

/** Fetches every mobile food truck place (ignores the name filter) for CSV export, most recent inspection only. */
export async function queryAllMobile(table) {
  const features = await queryAllPages(table, {
    where: '1=1',
    outFields: MOBILE_FIELDS,
    orderByFields: [`${NAME_FIELD_MOBILE} ASC`]
  });
  return dedupeToLatestPerFirm(features);
}

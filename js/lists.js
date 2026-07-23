import { SCHOOL_TOKEN, NAME_FIELD_RESTAURANT, NAME_FIELD_MOBILE } from './config.js';

const RESTAURANT_FIELDS = ['ObjectID', NAME_FIELD_RESTAURANT, 'est_address', 'est_city', 'rating', 'facility_types_primary'];
const MOBILE_FIELDS = ['ObjectId', NAME_FIELD_MOBILE, 'est_address', 'est_city', 'rating', 'permit_number', 'inspection_date'];

const MAX_RESULTS = 75;

function escapeForSql(value) {
  return value.replace(/'/g, "''").toUpperCase();
}

/**
 * Queries the shared Restaurant Inspections layer, scoped to either the restaurant
 * or school subset (via SCHOOL_TOKEN), optionally filtered by name and (for
 * restaurants) by the same rating clause applied to the map.
 */
export async function queryFacilityList(layer, { isSchool, nameFilter, ratingClause } = {}) {
  const categoryClause = isSchool
    ? `UPPER(facility_types_primary) LIKE '%${SCHOOL_TOKEN}%'`
    : `UPPER(facility_types_primary) NOT LIKE '%${SCHOOL_TOKEN}%'`;
  const nameClause = nameFilter
    ? `UPPER(${NAME_FIELD_RESTAURANT}) LIKE '%${escapeForSql(nameFilter)}%'`
    : '1=1';
  const ratingWhere = !isSchool && ratingClause ? ` AND ${ratingClause}` : '';

  const result = await layer.queryFeatures({
    where: `${categoryClause} AND ${nameClause}${ratingWhere}`,
    outFields: RESTAURANT_FIELDS,
    orderByFields: [`${NAME_FIELD_RESTAURANT} ASC`],
    num: MAX_RESULTS,
    returnGeometry: true
  });
  return { features: result.features, exceededLimit: result.exceededTransferLimit };
}

/** Queries the non-spatial MobileFoodInspections table, optionally filtered by name. */
export async function queryMobileList(table, { nameFilter } = {}) {
  const nameClause = nameFilter
    ? `UPPER(${NAME_FIELD_MOBILE}) LIKE '%${escapeForSql(nameFilter)}%'`
    : '1=1';

  const result = await table.queryFeatures({
    where: nameClause,
    outFields: MOBILE_FIELDS,
    orderByFields: [`${NAME_FIELD_MOBILE} ASC`],
    num: MAX_RESULTS,
    returnGeometry: false
  });
  return { features: result.features, exceededLimit: result.exceededTransferLimit };
}

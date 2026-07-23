import { SCHOOL_TOKEN, RATING_GRADES } from './config.js';

const ALL_GRADE_VALUES = RATING_GRADES.map((g) => `'${g.value}'`).join(',');

/**
 * Builds just the rating predicate, shared by the map filter and the restaurant list query.
 * Note: this service's standardized-query engine rejects TRIM(), so we only wrap with UPPER().
 */
export function buildRatingClause(ratings) {
  const selectedGrades = RATING_GRADES.filter((g) => ratings[g.value]).map((g) => `'${g.value}'`);
  const ratingParts = [];
  if (selectedGrades.length) {
    ratingParts.push(`UPPER(rating) IN (${selectedGrades.join(',')})`);
  }
  if (ratings.OTHER) {
    ratingParts.push(`UPPER(rating) NOT IN (${ALL_GRADE_VALUES})`);
  }
  return ratingParts.length ? `(${ratingParts.join(' OR ')})` : '1=0';
}

/**
 * Builds the SQL definitionExpression for the shared Restaurant Inspections layer
 * (it holds both restaurant and school records, distinguished by SCHOOL_TOKEN).
 * @param {{ showRestaurants: boolean, showSchools: boolean, ratings: Record<string, boolean> }} state
 */
export function buildRestaurantDefinitionExpression(state) {
  const { showRestaurants, showSchools, ratings } = state;

  const restaurantPredicate = `UPPER(facility_types_primary) NOT LIKE '%${SCHOOL_TOKEN}%'`;
  const schoolPredicate = `UPPER(facility_types_primary) LIKE '%${SCHOOL_TOKEN}%'`;
  const ratingClause = buildRatingClause(ratings);

  const clauses = [];
  if (showRestaurants) clauses.push(`(${restaurantPredicate} AND ${ratingClause})`);
  if (showSchools) clauses.push(`(${schoolPredicate})`);

  return clauses.length ? clauses.join(' OR ') : '1=0';
}

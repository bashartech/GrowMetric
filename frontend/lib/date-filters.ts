/**
 * A `<input type="date">` yields a bare `YYYY-MM-DD` string. Passing that
 * straight to `new Date(...)` yields UTC midnight, which is wrong for the
 * "To" bound: the range predicates are inclusive (`value <= ?`), so a filter
 * of "through 30 September" would silently exclude every row on 30 September.
 *
 * Dates are treated as UTC throughout to match how the stored ISO strings are
 * echoed back into the inputs (`.split("T")[0]`), so a chosen day round-trips
 * to the same day.
 */
const toUtcStartOfDay = (value: string): string =>
  new Date(`${value}T00:00:00.000Z`).toISOString();

const toUtcEndOfDay = (value: string): string =>
  new Date(`${value}T23:59:59.999Z`).toISOString();

/** Inclusive lower bound for a picked day. */
export const dateInputToStartOfDay = toUtcStartOfDay;

/** Inclusive upper bound for a picked day, so the whole day is included. */
export const dateInputToEndOfDay = toUtcEndOfDay;

import { z } from "zod";

/**
 * Default and maximum page size for every paginated list endpoint.
 *
 * A shared constant keeps `?limit=` from meaning something different per
 * endpoint, and the ceiling is what stops a caller from asking for an entire
 * tenant's table in one response.
 */
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

/**
 * `?page=` / `?limit=` query fragment for list endpoints.
 *
 * `positive()` rather than `min(1)` is deliberate: `page=0` or `page=-1` would
 * produce a negative `skip`, which Prisma rejects at runtime with a 500. It is
 * a client mistake, so it has to be a 400.
 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

export interface PageMeta {
  page: number;
  perPage: number;
  total: number;
}

/**
 * Runs a `findMany` and a `count` for the same filter as one round trip pair.
 *
 * Every list endpoint needs both halves; deriving `total` from the returned
 * rows would report the page length as the total and make the pager useless.
 */
export async function findPage<T>(
  findMany: () => Promise<T[]>,
  count: () => Promise<number>,
  page: number,
  perPage: number,
): Promise<{ items: T[]; meta: PageMeta }> {
  const [items, total] = await Promise.all([findMany(), count()]);
  return { items, meta: { page, perPage, total } };
}
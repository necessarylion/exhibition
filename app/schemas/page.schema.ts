import { z } from "@hono/zod-openapi";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "../constants/paging.constants";
import { text } from "./fields";

/**
 * The paging and search part of a list query. The number of rows that match is in the
 * `X-Total-Count` response header.
 */
export const PageQuerySchema = z.object({
  q: text("Search", 100).optional().openapi({
    description: "Only the rows with this text. Upper and lower case are the same.",
  }),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_LIMIT)
    .default(DEFAULT_PAGE_LIMIT)
    .openapi({ type: "integer", description: "How many rows to return.", example: 100 }),
  offset: z.coerce
    .number()
    .int()
    .min(0)
    .default(0)
    .openapi({ type: "integer", description: "How many rows to skip.", example: 0 }),
});

export type PageQuery = z.infer<typeof PageQuerySchema>;

/** One page of a list, and the number of rows in the whole list. */
export interface Page<T> {
  rows: T[];
  total: number;
  /** More numbers of the whole list, like the rows per status. See `X-Counts`. */
  counts?: Record<string, number>;
}

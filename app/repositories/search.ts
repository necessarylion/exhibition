import type { SQL } from "bun";

/**
 * The search part of a list query: `AND (a LIKE … OR b LIKE …)`. Every list uses it.
 * An empty search gives nothing, so the list is not filtered. Upper and lower case count
 * as the same. `%` and `_` in the search text are plain characters, not wildcards.
 */
// ponytail: LOWER() of SQLite knows only A-Z. A search for "é" does not find "É" there.
// PostgreSQL (production) knows every letter.
export function searchSql(
  db: SQL,
  q: string | undefined,
  columns: readonly SQL.Query<unknown>[],
): SQL.Query<unknown> {
  const text = (q ?? "").trim().toLowerCase();
  if (text === "") {
    return db``;
  }
  const pattern = `%${text.replace(/[\\%_]/g, "\\$&")}%`;
  let any = db`1 = 0`;
  for (const column of columns) {
    any = db`${any} OR LOWER(${column}) LIKE ${pattern} ESCAPE '\\'`;
  }
  return db`AND (${any})`;
}

const SQLITE_CODES = ["SQLITE_CONSTRAINT_UNIQUE", "SQLITE_CONSTRAINT_PRIMARYKEY"];
const POSTGRES_UNIQUE_VIOLATION = "23505";

/** True when the database refused a row because of a UNIQUE index. SQLite and PostgreSQL. */
export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const { code, errno } = error as { code?: unknown; errno?: unknown };
  return SQLITE_CODES.includes(String(code)) || String(errno) === POSTGRES_UNIQUE_VIOLATION;
}

/** True when the database refused a row because the row it points to is gone. */
export function isForeignKeyViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const { code, errno } = error as { code?: unknown; errno?: unknown };
  return String(code) === "SQLITE_CONSTRAINT_FOREIGNKEY" || String(errno) === "23503";
}

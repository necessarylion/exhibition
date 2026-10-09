-- A supplier that signs up by itself waits for an admin. `approved_at` is empty until then.
-- Its items are in no catalog before that. Every company that exists now is approved.
ALTER TABLE companies ADD COLUMN approved_at TEXT;
UPDATE companies SET approved_at = created_at;

-- Two companies cannot have the same name. `name_key` is the name in lower case with no
-- spaces at the ends. The app writes it with every name.
ALTER TABLE companies ADD COLUMN name_key TEXT NOT NULL DEFAULT '';
UPDATE companies SET name_key = LOWER(TRIM(name));

-- Old data can have the same name twice. The oldest company keeps the key.
-- Each later one gets its id at the end of the key, so the index below can be made.
-- Their names stay as they are. An admin can rename them.
UPDATE companies SET name_key = name_key || ' #' || id
WHERE EXISTS (
  SELECT 1 FROM companies older
  WHERE older.name_key = companies.name_key
    AND (older.created_at < companies.created_at
      OR (older.created_at = companies.created_at AND older.id < companies.id))
);

CREATE UNIQUE INDEX companies_name_key_index ON companies (name_key);

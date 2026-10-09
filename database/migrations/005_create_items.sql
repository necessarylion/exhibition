-- An item belongs to one company. Every company type can own items.
-- There is no photo column yet. File upload comes later.
CREATE TABLE items (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies (id),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  -- NULL means the item is listed in the catalog.
  hidden_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX items_company_id_index ON items (company_id);

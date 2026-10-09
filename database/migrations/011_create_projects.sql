-- An exhibition project of one customer company.
-- The status is not stored. It comes from `cancelled_at`, `done_at` and the orders.
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies (id),
  name TEXT NOT NULL,
  venue TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  hall TEXT NOT NULL DEFAULT '',
  booth_number TEXT NOT NULL DEFAULT '',
  booth_width_cm INTEGER CHECK (booth_width_cm > 0),
  booth_depth_cm INTEGER CHECK (booth_depth_cm > 0),
  -- Dates are YYYY-MM-DD text. Text in this form sorts like a date.
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  setup_on TEXT,
  notes TEXT NOT NULL DEFAULT '',
  cancelled_at TEXT,
  done_at TEXT,
  -- Empty when the user was removed.
  created_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  CHECK (ends_on >= starts_on),
  CHECK (setup_on IS NULL OR setup_on <= starts_on)
);

CREATE INDEX projects_company_id_index ON projects (company_id);

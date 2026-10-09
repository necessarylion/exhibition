-- A request of a customer to one owner company for the items of one project.
-- The supplier company is the owner of the items. It can be the admin company.
CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL REFERENCES projects (id),
  customer_company_id TEXT NOT NULL REFERENCES companies (id),
  supplier_company_id TEXT NOT NULL REFERENCES companies (id),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled', 'completed')),
  note TEXT NOT NULL DEFAULT '',
  reject_reason TEXT,
  -- BIGINT: a total can be bigger than one price.
  total_cents BIGINT NOT NULL CHECK (total_cents >= 0),
  decided_at TEXT,
  decided_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX orders_project_id_index ON orders (project_id);
CREATE INDEX orders_customer_company_id_index ON orders (customer_company_id);
CREATE INDEX orders_supplier_company_id_index ON orders (supplier_company_id);

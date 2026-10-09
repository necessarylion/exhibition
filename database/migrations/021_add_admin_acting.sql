-- An admin can act as a customer. The token of that session keeps the id of the admin.
-- When the admin user is removed, the token is removed too.
ALTER TABLE access_tokens ADD COLUMN impersonator_id TEXT REFERENCES users (id) ON DELETE CASCADE;

CREATE INDEX access_tokens_impersonator_id_index ON access_tokens (impersonator_id);

-- One row each time an admin starts to act as a customer. Rows are never changed.
-- The name of the admin is a copy, so the row still says who it was after the user is removed.
CREATE TABLE admin_actions (
  id TEXT PRIMARY KEY,
  admin_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  admin_name TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES companies (id),
  user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX admin_actions_company_id_index ON admin_actions (company_id, created_at);

-- Set when an admin made the project or the order while acting as the customer.
ALTER TABLE projects ADD COLUMN created_by_admin_id TEXT REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE projects ADD COLUMN created_by_admin_name TEXT;
ALTER TABLE orders ADD COLUMN created_by_admin_id TEXT REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN created_by_admin_name TEXT;

-- Who cancelled the order: 'customer', 'supplier' or 'admin'. Empty on an old order.
ALTER TABLE orders ADD COLUMN cancelled_by TEXT;

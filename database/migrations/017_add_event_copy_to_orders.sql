-- An order keeps its own copy of the event facts from the moment of sending.
-- A later change of the project does not change the order.
ALTER TABLE orders ADD COLUMN project_name TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN venue TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN city TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN hall TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN booth_number TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN booth_width_cm INTEGER;
ALTER TABLE orders ADD COLUMN booth_depth_cm INTEGER;
-- Dates are YYYY-MM-DD text. An accepted or completed order holds its items from
-- `setup_on` (or `starts_on` when there is no setup date) to `ends_on`.
ALTER TABLE orders ADD COLUMN starts_on TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN ends_on TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN setup_on TEXT;
ALTER TABLE orders ADD COLUMN project_notes TEXT NOT NULL DEFAULT '';

-- The orders that exist get the facts of their project as it is now.
UPDATE orders SET
  project_name = (SELECT name FROM projects WHERE projects.id = orders.project_id),
  venue = (SELECT venue FROM projects WHERE projects.id = orders.project_id),
  city = (SELECT city FROM projects WHERE projects.id = orders.project_id),
  hall = (SELECT hall FROM projects WHERE projects.id = orders.project_id),
  booth_number = (SELECT booth_number FROM projects WHERE projects.id = orders.project_id),
  booth_width_cm = (SELECT booth_width_cm FROM projects WHERE projects.id = orders.project_id),
  booth_depth_cm = (SELECT booth_depth_cm FROM projects WHERE projects.id = orders.project_id),
  starts_on = (SELECT starts_on FROM projects WHERE projects.id = orders.project_id),
  ends_on = (SELECT ends_on FROM projects WHERE projects.id = orders.project_id),
  setup_on = (SELECT setup_on FROM projects WHERE projects.id = orders.project_id),
  project_notes = (SELECT notes FROM projects WHERE projects.id = orders.project_id);

CREATE INDEX orders_status_dates_index ON orders (status, ends_on);

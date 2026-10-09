-- One item in a project. `order_id` is set when the line was sent in an order.
-- A sent line does not change any more.
CREATE TABLE project_lines (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items (id),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 10000),
  order_id TEXT REFERENCES orders (id),
  -- The place of the line in the project. A new line goes to the end.
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX project_lines_project_id_index ON project_lines (project_id);
CREATE INDEX project_lines_item_id_index ON project_lines (item_id);
CREATE INDEX project_lines_order_id_index ON project_lines (order_id);

-- A project has at most one line of an item that is not sent yet.
CREATE UNIQUE INDEX project_lines_one_open_index ON project_lines (project_id, item_id)
  WHERE order_id IS NULL;

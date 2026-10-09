-- One item in an order. The name, unit and price are copies from the moment of sending.
-- A later change of the item does not change the order.
CREATE TABLE order_lines (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items (id),
  item_name TEXT NOT NULL,
  unit TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 10000),
  line_total_cents BIGINT NOT NULL CHECK (line_total_cents >= 0)
);

CREATE INDEX order_lines_order_id_index ON order_lines (order_id);
CREATE INDEX order_lines_item_id_index ON order_lines (item_id);

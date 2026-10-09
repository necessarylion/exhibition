-- The category and the SKU of the item at the moment of sending. Old lines have none.
ALTER TABLE order_lines ADD COLUMN category TEXT;
ALTER TABLE order_lines ADD COLUMN sku TEXT;

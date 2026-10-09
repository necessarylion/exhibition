-- A short message for one user, shown inside the app. No email is sent.
-- An event writes one row for every user of the company that should know.
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  -- The page that opens when the user clicks it, like /orders/<id>.
  link TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX notifications_user_id_index ON notifications (user_id, created_at);

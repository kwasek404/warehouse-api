CREATE TABLE IF NOT EXISTS tokens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE TABLE IF NOT EXISTS boxes (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  parent_id TEXT REFERENCES boxes(id),
  description TEXT,
  photo_url TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  box_id TEXT REFERENCES boxes(id),
  photo_url TEXT,
  tags TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS checkouts (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  reason TEXT,
  checked_out_at INTEGER NOT NULL,
  returned_at INTEGER,
  returned_quantity INTEGER
);

CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
  name,
  description,
  tags,
  content='items',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS items_ai AFTER INSERT ON items BEGIN
  INSERT INTO items_fts(rowid, name, description, tags)
  VALUES (new.rowid, new.name, new.description, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS items_ad AFTER DELETE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, name, description, tags)
  VALUES ('delete', old.rowid, old.name, old.description, old.tags);
END;

CREATE TRIGGER IF NOT EXISTS items_au AFTER UPDATE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, name, description, tags)
  VALUES ('delete', old.rowid, old.name, old.description, old.tags);
  INSERT INTO items_fts(rowid, name, description, tags)
  VALUES (new.rowid, new.name, new.description, new.tags);
END;

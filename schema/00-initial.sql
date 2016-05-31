CREATE TABLE endpoints (
  id text PRIMARY KEY,
  owner text,
  created_at date DEFAULT current_date,
  definition text,
  url text,
  headers jsonb,
  data jsonb,

  UNIQUE(owner, definition, url, headers)
);

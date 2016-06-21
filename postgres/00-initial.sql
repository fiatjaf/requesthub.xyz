CREATE TYPE method AS ENUM ('GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH');

CREATE TABLE endpoints (
  id text PRIMARY KEY,
  owner text NOT NULL,
  created_at date DEFAULT current_date,
  method method NOT NULL,
  url text NOT NULL,
  definition text NOT NULL,
  pass_headers boolean NOT NULL,
  headers jsonb NOT NULL,
  data jsonb NOT NULL,

  UNIQUE(owner, definition, url, headers)
);

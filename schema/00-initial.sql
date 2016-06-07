CREATE TYPE method AS ENUM ('GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH');

CREATE TABLE endpoints (
  id text PRIMARY KEY,
  owner text,
  created_at date DEFAULT current_date,
  method method,
  url text,
  definition text,
  pass_headers boolean,
  headers jsonb,
  data jsonb,

  UNIQUE(owner, definition, url, headers)
);

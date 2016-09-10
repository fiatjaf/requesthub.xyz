CREATE TYPE method AS ENUM ('GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH');

CREATE TABLE users (
  id serial PRIMARY KEY,
  email text,
  github_id int
);

CREATE TABLE endpoints (
  id text PRIMARY KEY,
  owner_id int REFERENCES users(id),
  created_at date DEFAULT current_date,
  method method NOT NULL,
  url text,
  url_dynamic boolean NOT NULL DEFAULT false,
  definition text NOT NULL,
  pass_headers boolean NOT NULL,
  headers jsonb NOT NULL,

  UNIQUE(owner, definition, url, headers)
);

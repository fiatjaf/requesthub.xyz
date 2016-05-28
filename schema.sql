CREATE TABLE users (
  id char(30) PRIMARY KEY,
  username char(50),
  email text
);

CREATE TABLE endpoints (
  id char(30) PRIMARY KEY,
  owner_id char(30) REFERENCES users(id),
  enabled boolean DEFAULT true,
  data jsonb
);

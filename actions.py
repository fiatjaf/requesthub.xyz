import os
import jwt
import json
import pg8000
from flask import request
from helpers import is_valid_modifier, is_valid_url, is_valid_headers


def logged_user():
    if 'Authorization' not in request.headers:
        return None
    _, token = request.headers['Authorization'].split(' ', 1)
    if not token:
        return None

    try:
        d = jwt.decode(token, os.getenv('SECRET'), algorithms=['HS256'])
    except jwt.DecodeError:
        return None

    return d.get('email')


def make_jwt(email):
    return jwt.encode({'email': email}, os.getenv('SECRET'), algorithm='HS256')


def set_endpoint(identifier, method, target_url, definition,
                 pass_headers, headers, owner=None):
    method = method.upper()
    identifier = identifier.strip()
    definition = definition.strip()
    target_url = target_url.strip()
    data = {}

    if not is_valid_modifier(definition):
        return None, 'please provide a valid jq definition'

    if not is_valid_url(target_url):
        # url is not static, but a modifier also
        data['url:d'] = True
        if not is_valid_modifier(target_url):
            return None, 'please provide a valid url'

    if not is_valid_headers(headers):
        return None, 'headers are invalid somehow'

    with pg() as cur:
        try:
            cur.execute('''
INSERT INTO endpoints
(id, owner, definition, method, url, pass_headers, headers, data)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
ON CONFLICT (id) DO UPDATE SET
    method = EXCLUDED.method,
    url = EXCLUDED.url,
    definition = EXCLUDED.definition,
    pass_headers = EXCLUDED.pass_headers,
    headers = EXCLUDED.headers,
    data = EXCLUDED.data
  WHERE endpoints.owner = EXCLUDED.owner''', (
                identifier,
                owner,
                definition,
                method,
                target_url,
                bool(pass_headers),
                json.dumps(headers),
                json.dumps(data)
            ))
            return identifier, ''
        except pg8000.ProgrammingError as e:
            if e[1] == '23505':
                # an endpoint like this already exists
                cur.execute('''
SELECT id FROM endpoints WHERE
owner = %s AND definition = %s AND url = %s AND headers = %s
''', (owner, definition, target_url, json.dumps(headers)))
                return cur.fetchone()[0], ''
            else:
                raise e

    return None, 'mysterious error'


def get_endpoints(owner):
    with pg() as cur:
        cur.execute('''
SELECT id, created_at, method, url
FROM endpoints
WHERE owner = %s
ORDER BY created_at
LIMIT 20''',
                    (owner,))
        return dict([(row[0], {
            'identifier': row[0],
            'created_at': row[1].isoformat(),
            'method': row[2],
            'url': row[3]
        }) for row in cur.fetchall()])
    return {}


def get_endpoint(identifier, owner):
    with pg() as cur:
        cur.execute('''
SELECT
  id, created_at, definition, method, url, headers, pass_headers, data
  FROM endpoints
WHERE identifier = %s AND owner = %s''',
                    (owner,))
        row = cur.fetchone()
        if row:
            return {
                'identifier': row[0],
                'created_at': row[1].isoformat(),
                'definition': row[2],
                'method': row[3],
                'url': row[4],
                'headers': row[5],
                'pass_headers': row[6],
                'data': row[7]
            }
    return {}


def remove_endpoint(identifier, owner):
    with pg() as cur:
        cur.execute('''
DELETE FROM endpoints WHERE id = %s
AND owner = %s OR owner IS NULL
''', (identifier, owner))
        return True
    return False

import os
import re
import jwt
import rsa
import json
import time
import base64
import requests
from third import pg
from flask import request
from urlparse import urlparse
from graphql.language import ast
from subprocess32 import Popen, PIPE
from flask_graphql import GraphQLView
from graphene.core.classtypes import Scalar


all_methods = ['GET', 'POST', 'HEAD', 'DELETE', 'PUT', 'PATCH']


def user_can_access_endpoint(email, identifier):
    with pg() as cur:
        cur.execute('''
SELECT CASE WHEN owner = %s THEN true ELSE false END
FROM endpoints WHERE id = %s''', (
            email,
            identifier
        ))
        row = cur.fetchone()
        if row and row[0]:
            return True
    return False


def get_verified_email(jwt):
    # [ ] header is using an appropriate signing algorithm
    # [x] signature is valid and matches a key from the LA provider's JWK Set
    # [x] iss matches a trusted LA provider's origin
    # [x] aud matches this site's origin
    # [x] exp > (now) > iat, with some margin
    # [-] sub is a valid email address

    r = requests.get(''.join((
        os.getenv('LA_ORIGIN'),
        '/.well-known/openid-configuration',
    )))
    r = requests.get(r.json()['jwks_uri'])
    keys = r.json()['keys']

    raw_header, raw_payload, raw_signature = jwt.split('.')
    header = json.loads(b64dec(raw_header).decode('utf-8'))
    key = [k for k in keys if k['kid'] == header['kid']][0]
    e = int(b64dec(key['e']).encode('hex'), 16)
    n = int(b64dec(key['n']).encode('hex'), 16)

    pub_key = rsa.PublicKey(n, e)
    signature = b64dec(raw_signature)
    message = b'.'.join((
        raw_header.encode('ascii'),
        raw_payload.encode('ascii'),
    ))
    try:
        rsa.verify(message, signature, pub_key)
    except rsa.VerificationError:
        return {'error': 'Invalid signature'}

    payload = json.loads(b64dec(raw_payload).decode('utf-8'))
    iss = payload['iss']
    known_iss = os.getenv('LA_ORIGIN')
    if iss != known_iss:
        return {'error':
                'Untrusted issuer. Expected %s, got %s' % (known_iss, iss)}

    aud = payload['aud']
    known_aud = os.getenv('CLIENT_URL')
    if aud != known_aud:
        return {'error':
                'Audience mismatch. Expected %s, got %s' % (known_aud, aud)}

    iat = payload['iat']
    exp = payload['exp']
    now = int(time.time())
    slack = 3 * 60  # 3 minutes
    currently_valid = (iat - slack) < now < (exp + slack)
    if not currently_valid:
        return {'error':
                'Timestamp error. iat %d < now %d < exp %d' % (iat, now, exp)}

    sub = payload['sub']
    if not re.match(r'[^@]+@[^@]+\.[^@]+', sub):
        return {'error': 'Invalid email: %s' % sub}

    return {'email': payload['sub']}


def is_valid_modifier(modifier):
    if len(modifier) > 700:
        return False

    p = Popen(['./jq', '-c', '-M', modifier], stdin=PIPE, stderr=PIPE)
    _, stderr = p.communicate(input='{}', timeout=2)

    stderr = stderr.strip()
    if p.returncode == 0:
        return True
    elif \
            stderr == 'jq: error (at <stdin>:0): null (null) only ' + \
                      'strings can be parsed' or \
            stderr == 'jq: error (at <stdin>:1): strptime/1 ' +\
                      'requires string inputs and arguments':
        return True
    else:
        print('invalid stderr:', stderr)
        return False


def is_valid_url(url):
    p = urlparse(url)
    if not p.scheme or not p.netloc or \
            p.netloc == urlparse(request.url_root).netloc:
        return False
    return True


def is_valid_headers(headers):
    headers = {k: v for k, v in headers.items() if k.strip() and v.strip()}

    for k, v in headers.items():
        if len(k) > 50 or len(v) > 300:
            return False
    return True


def jq(mod, data):
    p = Popen(['./jq', '-c', '-M', '-r', mod], stdin=PIPE, stdout=PIPE)
    res = p.communicate(input=data, timeout=4)[0]
    return res


def b64dec(s):
    return base64.urlsafe_b64decode(
      s.encode('ascii') + b'=' * (4 - len(s) % 4))


class MapStringString(Scalar):
    @staticmethod
    def serialize(o):
        return dict(o)

    @staticmethod
    def parse_literal(node):
        if isinstance(node, ast.StringValue):
            return json.loads(node.value)
        return dict((f.name.value, f.value.value) for f in node.fields)

    @staticmethod
    def parse_value(value):
        return dict(value)


def snake(camel):
    return camel_re.sub(r'\1_\2', camel).lower()


camel_re = re.compile('([a-z0-9])([A-Z])')


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


class GraphQLViewWithUserContext(GraphQLView):
    def get_context(self, request):
        return {
            'user': logged_user(),
            'graphiql': self.graphiql and self.can_display_graphiql(
                self.parse_body(request)
            )
        }

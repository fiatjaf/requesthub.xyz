import os
import re
import rsa
import json
import time
import base64
import requests
from urlparse import urlparse
from subprocess import Popen, PIPE
from flask import request


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
    if len(modifier) > 600:
        return False
    p = Popen(['./jq', '-c', '-M', modifier], stdin=PIPE, stdout=PIPE)
    p.communicate(input='{}')
    return p.returncode == 0


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
    res = p.communicate(input=data)[0]
    return res


def b64dec(s):
    return base64.urlsafe_b64decode(
      s.encode('ascii') + b'=' * (4 - len(s) % 4))

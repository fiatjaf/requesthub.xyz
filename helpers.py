from urlparse import urlparse
from subprocess import Popen, PIPE
from flask import request


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

from urlparse import urlparse
from haikunator import haikunate
from subprocess import Popen, PIPE
from flask import request

def make_identifier():
    return haikunate(tokenlength=0)

def is_valid_definition(definition):
    if len(definition) > 600:
        return False
    p = Popen(['./jq', '-c', '-M', definition], stdin=PIPE, stdout=PIPE)
    p.communicate(input='{}')
    return p.returncode == 0

def is_valid_url(url):
    p = urlparse(url)
    if not p.scheme or not p.netloc or p.netloc == urlparse(request.url_root).netloc:
        return False
    return True

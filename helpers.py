import os
import pg8000
from urlparse import urlparse
from subprocess import Popen, PIPE
from flask import request
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), 'lambda.env'))


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


def parse_header(header):
    if len(header) > 300 or len(header) < 3 or ':' not in header:
        raise ValueError(header)
    key, value = header.split(':', 1)
    return key.strip(), value.strip()


def jq(mod, data):
    p = Popen(['./jq', '-c', '-M', '-r', mod], stdin=PIPE, stdout=PIPE)
    res = p.communicate(input=data)[0]
    return res


class With():
    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


class Cursor(pg8000.Cursor, With):
    pass


class Connection(pg8000.Connection, With):
    def cursor(self):
        return Cursor(self)
        self.close()


def pg_connect(*pg_params):
    p = urlparse(os.getenv('POSTGRESQL_URL'))
    return Connection(p.username, p.hostname, None, p.port,
                      p.path[1:], p.password, True, None)

import re
import json
import base64
from flask import request
from urllib.parse import urlparse
from graphql.language import ast
from subprocess import Popen, PIPE
from flask_graphql import GraphQLView
from flask_login import current_user
from graphene.core.classtypes import Scalar

from third import pg


all_methods = ['GET', 'POST', 'HEAD', 'DELETE', 'PUT', 'PATCH']


def user_can_access_endpoint(identifier):
    return pg.exists('endpoints', what=['id'], where={
      'id': identifier,
      'owner_id': current_user.get_id()
    })


def modifier_check(modifier):
    if len(modifier) > 3000:
        print('definition is too long.')
        return False, 'modifier is too long.'

    p = Popen(['./jq', '-c', '-M', modifier], stdin=PIPE, stderr=PIPE)
    _, stderr = p.communicate(input=b'{}', timeout=2)

    stderr = stderr.strip()
    if p.returncode == 0:
        return True, ''
    elif \
            stderr == 'jq: error (at <stdin>:0): null (null) only ' + \
                      'strings can be parsed' or \
            stderr == 'jq: error (at <stdin>:0): Cannot iterate over ' + \
                      'null (null)' or \
            stderr == 'jq: error (at <stdin>:1): strptime/1 ' + \
                      'requires string inputs and arguments':
        return True, ''
    else:
        print('invalid stderr:', stderr)
        return False, stderr


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
    res = p.communicate(input=data.encode('utf-8'), timeout=4)[0]
    return res.decode('utf-8')


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


class GraphQLViewWithUserContext(GraphQLView):
    def get_context(self, request):
        return {
            'user_id': current_user.get_id(),
            'graphiql': self.graphiql and self.can_display_graphiql(
                self.parse_body(request)
            )
        }


def parse_incoming_data():
    values = {}
    values.update(request.args.items())
    try:
        data = request.get_data().decode('utf-8')
        values.update(json.loads(data))
    except ValueError:
        values.update(request.form.items())
    except UnicodeDecodeError:
        print('failed to decode ' + repr(request.get_data()))
        pass
    return json.dumps(values)


class User():
    @classmethod
    def search(cls, **kwargs):
        user = pg.select1('users', where=kwargs)
        if user:
            return User(**user)

    def __init__(self, id=None, github_id=None, email=None):
        self.id = id
        self.github_id = github_id
        self.email = email

    def save(self):
        values = {}
        if self.email:
            values['email'] = self.email
        elif self.github_id:
            values['github_id'] = self.github_id
        else:
            raise Exception('cannot save without any identifying property.')

        id = pg.upsert('users', set=values, return_id=True)
        pg.commit()
        self.id = id

    def is_authenticated(self):
        return True

    def is_active(self):
        return True

    def is_anonymous(self):
        return False

    def get_id(self):
        return self.id

import json
import logging
import psycopg2
import graphene
from graphene.core.types import custom_scalars
from haikunator import Haikunator
from helpers import is_valid_modifier, is_valid_url, is_valid_headers, \
                    MapStringString, snake

from third import lpg, pg, redis

haiku = Haikunator().haikunate
logger = logging.getLogger('graphql.execution.executor')
logger.addHandler(logging.StreamHandler())


class Endpoint(graphene.ObjectType):
    id = graphene.ID()
    owner = graphene.String()
    created_at = custom_scalars.DateTime()
    method = graphene.String()
    url = graphene.String()
    url_dynamic = graphene.Boolean()
    definition = graphene.String()
    pass_headers = graphene.Boolean()
    headers = MapStringString()
    data = custom_scalars.JSONString()
    recent_events = graphene.List(graphene.String())

    def resolve_recent_events(self, args, info):
        return redis.get()


class Query(graphene.ObjectType):
    endpoint = graphene.List(
        Endpoint,
        owner=graphene.String(),
        id=graphene.String(),
    )

    def resolve_endpoint(self, args, info):
        rows = get_endpoint(
            args.get('owner'),
            args.get('id'),
            fields=[snake(f.name.value) for f in
                    info.field_asts[0].selection_set.selections
                    if f.name.value != 'recentEvents']
        )
        return [Endpoint(**row or {}) for row in rows] if rows else []


def get_endpoint(owner=None,
                 id=None,
                 fields=['owner', 'created_at', 'definition', 'method',
                         'url', 'headers', 'pass_headers', 'data']):
    # always fetch the id
    fields.append('id')

    where = {}

    if owner:
        where['owner'] = owner

    if id:
        where['id'] = id

    with lpg() as p:
        res = p.select('endpoints', what=fields, where=where)
        return res


class SetEndpoint(graphene.Mutation):
    class Input:
        id = graphene.String()
        owner = graphene.String()
        method = graphene.String()
        url = graphene.String()
        definition = graphene.String()
        pass_headers = graphene.Boolean()
        headers = MapStringString()

    id = graphene.String()
    error = graphene.String()
    ok = graphene.Boolean()

    @classmethod
    def mutate(cls, instance, args, info):
        params = dict(args)
        params.setdefault('id', haiku(token_length=4))
        id, error = set_endpoint(params)
        return SetEndpoint(id, error, not error)


def set_endpoint(props):
    identifier = props['id'].strip()
    owner = props['owner']
    method = props.get('method').upper()
    target_url = props.get('url').strip()
    definition = props.get('definition').strip()
    headers = dict(props.get('headers'))
    pass_headers = props.get('passHeaders')
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

    with pg.cursor() as c:
        try:
            c.execute('''
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
            pg.commit()
            return identifier, ''
        except psycopg2.IntegrityError as e:
            pg.rollback()
            if e.pgcode == '23505':
                # an endpoint like this already exists
                c.execute('''
SELECT id FROM endpoints WHERE
owner = %s AND definition = %s AND url = %s AND headers = %s
''', (owner, definition, target_url, json.dumps(headers)))
                return c.fetchone()[0], ''
            else:
                raise e

    return None, 'mysterious error'


class DeleteEndpoint(graphene.Mutation):
    class Input:
        id = graphene.String()

    id = graphene.String()
    ok = graphene.Boolean()

    @classmethod
    def mutate(cls, instance, args, info):
        id = args['id']

        with lpg() as p:
            p.delete('endpoints', where={'id': id})
            return DeleteEndpoint(id, True)

        return DeleteEndpoint(id, False)


class Mutations(graphene.ObjectType):
    set_endpoint = graphene.Field(SetEndpoint)
    delete_endpoint = graphene.Field(DeleteEndpoint)

schema = graphene.Schema(query=Query, mutation=Mutations)

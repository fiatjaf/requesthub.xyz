import json
import logging
import graphene
from graphene.core.types import custom_scalars
from haikunator import Haikunator
from helpers import is_valid_modifier, is_valid_url, is_valid_headers, \
                    MapStringString, snake

from third import lpg, redis

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
    data = MapStringString()
    recent_events = graphene.List(graphene.String())

    def resolve_recent_events(self, args, info):
        return redis.get()


class Query(graphene.ObjectType):
    endpoint = graphene.Field(
        Endpoint,
        id=graphene.ID(),
        owner=graphene.String()
    )

    endpoints = graphene.List(
        Endpoint,
        owner=graphene.String()
    )

    def resolve_endpoint(self, args, info):
        rows = get_endpoints(
            args.get('owner'),
            args['id'],
            fields=[snake(f.name.value) for f in
                    info.field_asts[0].selection_set.selections
                    if f.name.value != 'recentEvents']
        )
        return Endpoint(**rows[0] or {}) if rows else {}

    def resolve_endpoints(self, args, info):
        rows = get_endpoints(
            args.get('owner'),
            None,
            fields=[snake(f.name.value) for f in
                    info.field_asts[0].selection_set.selections
                    if f.name.value != 'recentEvents']
        )
        return [Endpoint(**row or {}) for row in rows] if rows else []


def get_endpoints(owner=None, id=None,
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
        id = graphene.ID()
        method = graphene.String()
        url = graphene.String()
        definition = graphene.String()
        pass_headers = graphene.Boolean()
        headers = graphene.String()

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
    values = {
        'id': props['id'].strip(),
        'data': {}
    }

    if 'owner' in props:
        values['owner'] = props['owner']

    if 'method' in props:
        values['method'] = props['method'].strip()

    if 'url' in props:
        if not is_valid_url(props['url']):
            # url is not static, but a modifier
            if not is_valid_modifier(props['url']):
                # oops, not a modifier
                return None, 'please provide a valid url'
            values['data']['url:d'] = True
        values['url'] = props['url'].strip()

    if 'definition' in props:
        if not is_valid_modifier(props['definition']):
            return None, 'please provide a valid jq definition'
        values['definition'] = props['definition'].strip()

    if 'headers' in props:
        headers = json.loads(props['headers'])
        if not is_valid_headers(headers):
            return None, 'headers are invalid somehow'
        values['headers'] = json.dumps(dict(headers))

    if 'pass_headers' in props:
        values['pass_headers'] = bool(props['pass_headers'])

    values['data'] = json.dumps(values['data'])

    with lpg() as p:
        try:
            id = p.upsert('endpoints', set=values, return_id=True)
            print(id)
            return id, ''
        except Exception as e:
            print('EXCEPTION', e)
            if e.pgcode == '23505':
                # an endpoint like this already exists
                id = p.select('endpoints', what=['id'], where={
                    'owner': values['owner'],
                    'definition': values['definition'],
                    'headers': values['headers']
                })
                print(id)
                return id, ''
            else:
                raise e

    return None, 'mysterious error'


class DeleteEndpoint(graphene.Mutation):
    class Input:
        id = graphene.ID()

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
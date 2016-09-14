import json
import logging
import graphene
import psycopg2
from slugify import slugify
from graphene import with_context
from graphene.core.types import custom_scalars

from helpers import modifier_check, is_valid_url, is_valid_headers, \
                    MapStringString, snake, haiku
from third import pg, redis
from request_handler import proxy

logger = logging.getLogger('graphql.execution.executor')
logger.addHandler(logging.StreamHandler())


class Endpoint(graphene.ObjectType):
    id = graphene.ID()
    owner_id = graphene.ID()
    created_at = custom_scalars.DateTime()
    method = graphene.String()
    url = graphene.String()
    url_dynamic = graphene.Boolean()
    definition = graphene.String()
    pass_headers = graphene.Boolean()
    headers = MapStringString()
    recent_events = graphene.List(graphene.String())
    event_count = graphene.Int()

    def resolve_event_count(self, args, info):
        try:
            key = 'events:%s' % self.id
        except AttributeError:
            return 0
        return redis.llen(key)

    def resolve_recent_events(self, args, info):
        try:
            key = 'events:%s' % self.id
        except AttributeError:
            return []
        return [e.decode('utf-8') for e in redis.lrange(key, 0, 8)]


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

    @with_context
    def resolve_endpoint(self, args, ctx, info):
        owner = None
        if not ctx['graphiql']:
            owner = ctx['user_id']
            if not owner:
                return

        rows = get_endpoints(
            owner,
            args['id'],
            fields=[snake(f.name.value) for f in
                    info.field_asts[0].selection_set.selections
                    if f.name.value != 'recentEvents' and
                    f.name.value != 'eventCount']
        )
        return Endpoint(**rows[0] or {}) if rows else {}

    @with_context
    def resolve_endpoints(self, args, ctx, info):
        owner = None
        if not ctx['graphiql']:
            owner = ctx['user_id']
            if not owner:
                return

        rows = get_endpoints(
            owner,
            None,
            fields=[snake(f.name.value) for f in
                    info.field_asts[0].selection_set.selections
                    if f.name.value != 'recentEvents' and
                    f.name.value != 'eventCount']
        )
        return [Endpoint(**row or {}) for row in rows] if rows else []


def get_endpoints(owner=None, id=None,
                  fields=['owner_id', 'created_at', 'definition', 'method',
                          'url', 'url_dynamic', 'headers', 'pass_headers']):
    # always fetch the id
    fields.append('id')

    where = {}

    if owner:
        where['owner_id'] = owner

    if id:
        where['id'] = id

    try:
        res = pg.select('endpoints', what=fields, where=where)
    except psycopg2.ProgrammingError as e:
        print(e)
        pg.rollback()
        return []
    return res


class SetEndpoint(graphene.Mutation):
    class Input:
        current_id = graphene.ID()
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
    @with_context
    def mutate(cls, instance, args, ctx, info):
        params = dict(args)
        params.setdefault('id', haiku(token_length=4))

        if not ctx['graphiql']:
            params['owner'] = ctx['user_id']

        id, error = set_endpoint(params)
        return SetEndpoint(id, error, not error)


def set_endpoint(props):
    # setEndpoint is valid both for creating and updating
    # so we check for each property (so we will update only
    # the ones that came in the request)
    values = {}

    # 'id' can be changed, this is the value of the new id
    # the old one, when it exists, comes in 'current_id'
    if 'id' in props:
        values['id'] = slugify(props['id'])[:30]

    if 'owner' in props:
        values['owner_id'] = props['owner']

    if 'method' in props:
        values['method'] = props['method'].strip()

    if 'url' in props:
        if not props['url']:
            values['url'] = props['url']
        else:
            if not is_valid_url(props['url']):
                # url is not static, but a modifier
                valid, err = modifier_check(props['url'])
                if not valid:
                    # oops, not a modifier
                    return None, \
                        'please provide a valid URL' \
                        ' or an URL modifier: %s' % err
                values['url_dynamic'] = True
            values['url'] = props['url'].strip()

    if 'definition' in props:
        valid, err = modifier_check(props['definition'])
        if not valid:
            return None, 'invalid modifier script: %s' % err
        values['definition'] = props['definition'].strip()

    if 'headers' in props:
        headers = json.loads(props['headers'])
        if not is_valid_headers(headers):
            return None, 'headers are invalid somehow'
        values['headers'] = json.dumps(dict(headers))

    if 'pass_headers' in props:
        values['pass_headers'] = bool(props['pass_headers'])

    try:
        if 'current_id' in props:
            # updating
            pg.update('endpoints', set=values,
                      where={'id': props['current_id']})
            id = values.get('id', props['current_id'])
        else:
            # creating
            id = pg.insert('endpoints', values=values, return_id=True)

        pg.commit()
        return id, ''

    except psycopg2.IntegrityError as e:
        if e.pgcode == '23505':
            pg.rollback()
            # an endpoint like this already exists
            res = pg.select1('endpoints', what=['id'], where={
                'owner_id': values['owner'],
                'definition': values['definition'],
                'headers': values['headers']
            })
            return res['id'], ''
        else:
            raise e

    return None, 'mysterious error'


class DeleteEndpoint(graphene.Mutation):
    class Input:
        id = graphene.ID()

    id = graphene.String()
    ok = graphene.Boolean()

    @classmethod
    @with_context
    def mutate(cls, instance, args, ctx, info):
        where = {'id': args['id']}

        if not ctx['graphiql']:
            where['owner_id'] = ctx['user_id']

        pg.delete('endpoints', where=where)
        pg.commit()
        return DeleteEndpoint(args['id'], True)


class ReplayEvent(graphene.Mutation):
    class Input:
        id = graphene.ID()
        index = graphene.Int()

    id = graphene.String()
    index = graphene.Int()
    error = graphene.String()
    ok = graphene.Boolean()

    @classmethod
    @with_context
    def mutate(cls, instance, args, ctx, info):
        key = 'events:%s' % args['id']
        eventjson = redis.lindex(key, args['index'])
        event = json.loads(eventjson.decode('utf-8'))

        text, code, _ = proxy(
            args['id'],
            event['in']['method'],
            event['in']['headers'],
            event['in']['body']
        )

        if 300 > code >= 200:
            return ReplayEvent(args['id'], args['index'], '', True)
        else:
            return ReplayEvent(args['id'], args['index'], text, False)


class Mutations(graphene.ObjectType):
    set_endpoint = graphene.Field(SetEndpoint)
    delete_endpoint = graphene.Field(DeleteEndpoint)
    replay_event = graphene.Field(ReplayEvent)

schema = graphene.Schema(query=Query, mutation=Mutations)

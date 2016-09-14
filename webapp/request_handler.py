import json
import time
import requests
from urllib.parse import urlencode
from requests.structures import CaseInsensitiveDict

from third import pg, redis, pusher
from helpers import jq, is_valid_url


def proxy(identifier, in_method, in_headers, data):
    # find endpoint
    endpoint = pg.select1(
        'endpoints',
        what=['definition', 'method', 'pass_headers',
              'headers', 'url', 'url_dynamic'],
        where={'id': identifier}
    )
    if not endpoint:
        return 'endpoint not found, create it at ' \
               '<a href="/dashboard">dashboard</a>', 404, {}

    event = {
        'in': {
            'time': time.time(),
            'method': in_method,
            'headers': dict(in_headers),
            'body': data[:2300] + ' [truncated]' if len(data) > 2207 else data
        },
        'out': {
            'method': endpoint['method'],
            'url': endpoint['url'],
            'body': '',
            'headers': {}
        },
        'response': {
            'code': 0,
            'body': ''
        }
    }

    mutated, error = jq(endpoint['definition'], data=data)
    if not mutated or error:
        event['out']['error'] = error.decode('utf-8')
        publish(identifier, event)
        return 'transmutated into null and aborted', 201, {}

    h = CaseInsensitiveDict({'Content-Type': 'application/json'})
    if endpoint['pass_headers']:
        h.update(in_headers)
    h.update(endpoint['headers'])
    event['out']['headers'] = dict(h)

    # reformat the mutated data
    mutatedjson = json.loads(mutated.decode('utf-8'))
    if h.get('content-type') == 'application/x-www-form-urlencoded':
        # oops, not json
        mutated = urlencode(mutatedjson)
    else:
        mutated = json.dumps(mutatedjson)

    event['out']['body'] = mutated[:1500] + ' [-truncated-]' \
        if len(mutated) > 1507 else mutated

    if endpoint['url_dynamic']:
        urlb, error = jq(endpoint['url'], data=data)
        print('URL', urlb, 'ERROR', error)
        if not urlb:
            event['out']['url_error'] = error.decode('utf-8')
            publish(identifier, event)
            return 'url building has failed', 200, {}
        url = urlb.decode('utf-8')
        event['out']['url'] = url[:120] + ' [-truncated-]' \
            if len(url) > 127 else url
    else:
        url = endpoint['url']

    # event['out'] is completed at this point
    # and we all have everything needed to perform the request

    if url and is_valid_url(url):
        # we will only perform a request if there is an URL and it is valid
        try:
            s = requests.Session()
            req = requests.Request(endpoint['method'], url,
                                   data=mutated, headers=h).prepare()
            resp = s.send(req, timeout=4)

            if not resp.ok:
                print('FAILED TO POST', resp.text, identifier, mutated)

        except requests.exceptions.RequestException as e:
            print(identifier, 'FAILED TO POST', mutated, 'TO URL', url)
            print(e)
            publish(identifier, event)
            return "<request failed: '%s'>" % e, 503, {}

        event['response']['code'] = resp.status_code
        event['response']['body'] = resp.text[:200] + ' [-truncated-]' \
            if len(resp.text) > 207 else resp.text
        publish(identifier, event)
        return resp.text, resp.status_code, dict(resp.headers)
    else:
        # no valid URL, just testing
        publish(identifier, event)
        return 'no URL to send this to', 201, {}


def publish(identifier, event):
    eventjson = json.dumps(event)

    try:
        pusher.trigger('private-' + identifier, 'webhook', eventjson)
    except ValueError as e:
        print('couldn\'t send webhook to pusher', e)

    key = 'events:%s' % identifier
    rpipe = redis.pipeline()
    rpipe.lpush(key, eventjson)  # prepend
    rpipe.ltrim(key, 0, 8)  # leave only the last 9
    rpipe.expire(key, 86400)  # 24h
    rpipe.execute()

    print('published event.')

import json
import time
import requests
from urllib.parse import urlencode
from requests.structures import CaseInsensitiveDict
from json5dumps import dumps as json5dumps

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
            'body': data,
            'replay': True
        },
        'out': {
            'method': endpoint['method'],
            'url': endpoint['url'],
            'body': None,
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

    event['out']['body'] = mutated

    if endpoint['url_dynamic']:
        urlb, error = jq(endpoint['url'], data=data)
        print('URL', urlb, 'ERROR', error)
        if not urlb:
            event['out']['url_error'] = error.decode('utf-8')
            publish(identifier, event)
            return 'url building has failed', 200, {}
        url = urlb.decode('utf-8')
        event['out']['url'] = url
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
        event['response']['body'] = resp.text
        publish(identifier, event)
        return resp.text, resp.status_code, dict(resp.headers)
    else:
        # no valid URL, just testing
        publish(identifier, event)
        return 'no URL to send this to', 201, {}


def publish(identifier, event):
    # first we try to turn response data into json
    if event['response']['body']:
        try:
            event['response']['body'] = json.loads(event['response']['body'])
        except ValueError:
            # otherwise it is a string, we don't care
            pass

    # then we stringify these important values
    # we turn them into lists to make the reducing process easier
    inbody = list(json5dumps(event['in']['body']))
    outbody = list(json5dumps(event['out']['body']))
    outurl = list(event['out']['url'])
    responsebody = list(json5dumps(event['response']['body']))

    # now we are going to reduce the event size in an intelligent way
    things = [
        (inbody, 2200),
        (outbody, 1900),
        (outurl, 127),
        (responsebody, 400)
    ]

    threshold = sum([maximum for (_, maximum) in things]) + 300

    while sum([len(val) for (val, _) in things]) > threshold:
        passing = sum([len(val) for (val, _) in things])
        ratio = passing / threshold

        # reduce the values which are further away from its maximum value
        for value, maximum in things:
            if len(value) > (ratio * maximum):
                truncate = int(maximum * ratio * 0.8)
                value[truncate:] = []
                value[-11:] = list('[truncated]')

    # bring those lists back
    inbody = ''.join(inbody)
    outbody = ''.join(outbody)
    outurl = ''.join(outurl)
    responsebody = ''.join(responsebody)

    if inbody.endswith('[truncated]'):
        event['in']['body'] = inbody
        event['in']['replay'] = False

    if outbody.endswith('[truncated]'):
        event['out']['body'] = outbody

    if outurl.endswith('[truncated]'):
        event['out']['url'] = outurl

    if responsebody.endswith('[truncated]'):
        event['response']['body'] = responsebody

    eventjson = json.dumps(event)
    eventjson5 = json5dumps(event)

    try:
        pusher.trigger('private-' + identifier, 'webhook', eventjson5)
    except ValueError as e:
        print('couldn\'t send webhook to pusher', e)

    key = 'events:%s' % identifier
    rpipe = redis.pipeline()
    rpipe.lpush(key, eventjson)  # prepend
    rpipe.ltrim(key, 0, 9)  # leave only the last 10
    rpipe.expire(key, 86400)  # 24h
    rpipe.execute()

    print('published event.')

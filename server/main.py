import os
import json
import urllib
import requests
import datetime
from urllib import urlencode
from requests import Response
from requests.structures import CaseInsensitiveDict
from flask import Flask, request, jsonify, redirect, make_response
from flask_cors import CORS

from third import lpg, pusher, redis
from schema import schema
from helpers import jq, get_verified_email, user_can_access_endpoint, \
                    all_methods, make_jwt, logged_user, \
                    GraphQLViewWithUserContext as GraphQLView

app = Flask(__name__)
CORS(app)


app.add_url_rule(
    '/graphql',
    view_func=GraphQLView.as_view('graphql',
                                  schema=schema, graphiql=os.getenv('LOCAL'))
)


@app.route('/')
def home():
    return redirect(os.getenv('CLIENT_URL'))


@app.route('/auth', methods=['POST'])
def auth():
    token = request.form['id_token']

    result = get_verified_email(token)
    if 'error' in result:
        print(result)
        return redirect(os.getenv('CLIENT_URL'))

    return redirect(os.getenv('CLIENT_URL') + '#/logged?' + urllib.urlencode({
        'email': result['email'],
        'jwt': make_jwt(result['email'])
    }))


@app.route('/pusher/auth', methods=['POST'])
def pusher_auth():
    user = logged_user(request.args.get('jwt'))
    identifier = request.form['channel_name'][8:]
    if not user or not user_can_access_endpoint(user, identifier):
        return 'you do not have access to this endpoint', 401

    return jsonify(pusher.authenticate(
        channel=request.form['channel_name'],
        socket_id=request.form['socket_id']
    ))


@app.route('/w/<identifier>', methods=all_methods)
@app.route('/w/<identifier>/', methods=all_methods)
def proxy_webhook(identifier):
    data = request.get_data()
    print('got data', data)

    with lpg() as p:
        values = p.select(
            'endpoints',
            what=['definition', 'method', 'pass_headers',
                  'headers', 'url', "data->'url:d' as url_dynamic"],
            where={'id': identifier}
        )[0]

        if values['url_dynamic']:
            values['url'] = jq(values['url'], data=data)

        mutated = jq(values['definition'], data=data)
        if not mutated:
            return 'transmutated into null and aborted', 200

        h = CaseInsensitiveDict({'Content-Type': 'application/json'})
        if values['pass_headers']:
            h.update(request.headers)
        h.update(values['headers'])

        if h.get('content-type') == 'application/x-www-form-urlencoded':
            # oops, not json
            mutated = urlencode(json.loads(mutated))

        event = {
            'in': {
                'time': datetime.datetime.now().isoformat(),
                'body': data
            },
            'out': {
                'method': values['method'],
                'url': values['url'],
                'body': mutated,
                'headers': values['headers'],
            }
        }

        try:
            s = requests.Session()
            req = requests.Request(values['method'], values['url'],
                                   data=mutated, headers=h).prepare()
            resp = s.send(req, timeout=4)

            if not resp.ok:
                print('FAILED TO POST', resp.text, identifier, mutated)

        except requests.exceptions.RequestException as e:
            print('FAILED TO POST', e, identifier, mutated)
            resp = Response()
            resp.status_code = 503
            resp.body = "<request failed: '%s'>" % e

        event.update(response={'code': resp.status_code, 'body': resp.text})
        eventjson = json.dumps(event)

        key = 'events:%s' % identifier
        rpipe = redis.pipeline()
        rpipe.lpush(key, eventjson)
        rpipe.ltrim(key, 0, 2)
        rpipe.expire(key, 18000)
        rpipe.execute()

        pusher.trigger('private-' + identifier, 'webhook', eventjson)

        response = make_response(resp.text, resp.status_code)
        response.headers.extend(resp.headers.items())
        return response
    return 'an error ocurred', 500

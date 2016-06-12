import os
import json
import urllib
import requests
from urllib import urlencode
from requests.structures import CaseInsensitiveDict
from flask import Flask, request, jsonify, redirect, make_response
from flask_cors import CORS

import settings
from third import pg, pusher, redis
from schema import schema
from helpers import jq, get_verified_email, user_can_access_endpoint, \
                    all_methods, make_jwt, logged_user, \
                    GraphQLViewWithUserContext as GraphQLView

settings.init()
app = Flask(__name__)
CORS(app)


app.add_url_rule(
    '/graphql',
    view_func=GraphQLView.as_view('graphql',
                                  schema=schema, graphiql=os.getenv('LOCAL'))
)


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
    user = logged_user()
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
    rpipe = redis.pipeline()

    with pg() as cur:
        cur.execute('''
SELECT definition, method, pass_headers, headers, url, data->'url:d'
FROM endpoints WHERE id = %s''', (identifier, ))
        definition, method, pass_headers, headers, \
            url, url_dynamic = cur.fetchone()

        method = method or 'GET'
        if url_dynamic:
            url = jq(url, data=data)

        mutated = jq(definition, data=data)
        if not mutated:
            return 'transmutated into null and aborted', 200

        h = CaseInsensitiveDict({'Content-Type': 'application/json'})
        if pass_headers:
            h.update(request.headers)
        h.update(headers)

        if h.get('content-type') == 'application/x-www-form-urlencoded':
            # oops, not json
            mutated = urlencode(json.loads(mutated))

        print(method + '\'ING ' + mutated + ' TO ' + url +
              ' WITH HEADERS ' + json.dumps(headers))
        event = {
            'in': data,
            'out': {
                'method': method,
                'url': url,
                'body': mutated,
                'headers': headers,
            }
        }

        try:
            s = requests.Session()
            req = requests.Request(method, url, data=mutated, headers=h) \
                .prepare()
            resp = s.send(req, timeout=4)
        except requests.exceptions.RequestException as e:
            print('FAILED TO POST', e, identifier, mutated)
            event.update(response="<request failed: '%s'>" % e)

        if not resp.ok:
            print('FAILED TO POST', resp.text, identifier, mutated)
            event.update(response={'code': resp.status_code,
                                   'body': resp.text})
        else:
            event.update(response={'code': resp.status_code,
                                   'body': resp.text})

        key = 'events:%s' % identifier
        rpipe.lpush(key, json.dumps(event))
        rpipe.ltrim(key, 0, 3)
        rpipe.expire(key, 1800)
        rpipe.execute()

        response = make_response(resp.text, resp.status_code)
        response.headers.extend(resp.headers.items())
        return response
    return 'an error ocurred', 500


if __name__ == '__main__':
    app.run('0.0.0.0',
            int(os.getenv('PORT', 8787)),
            debug=os.getenv('DEBUG', True))

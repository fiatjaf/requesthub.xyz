import json
import time
import requests
from urllib.parse import urlencode
from requests import Response
from requests.structures import CaseInsensitiveDict
from flask import request, jsonify, redirect, make_response, \
                  render_template, flash, url_for, g
from flask_login import login_user, logout_user, login_required

from app import app
from third import pg, pusher, redis, github
from helpers import jq, user_can_access_endpoint, all_methods, \
                    parse_incoming_data, User
import settings


github.init_app(app)


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/login/github')
def github_login():
    return github.authorize(state=settings.STATE)


@app.route('/callback/github')
@github.authorized_handler
def github_callback(oauth_token):
    if oauth_token is None:
        flash('Authorization failed.')
        return redirect(url_for('index'))

    g.github_token = oauth_token
    github_id = github.get('user')['id']
    user = User.search(github_id=github_id)
    if user is None:
        user = User(github_id=github_id)
        user.save()
    login_user(user)

    return redirect(request.args.get('next') or url_for('dashboard'))


@app.route('/logout')
def logout():
    logout_user()
    return redirect(url_for('index'))


@app.route('/dashboard')
@login_required
def dashboard():
    return render_template('dashboard.html')


@app.route('/pusher/auth', methods=['POST'])
@login_required
def pusher_auth():
    identifier = request.form['channel_name'][8:]
    if not user_can_access_endpoint(identifier):
        return 'you do not have access to this endpoint', 401

    return jsonify(pusher.authenticate(
        channel=request.form['channel_name'],
        socket_id=request.form['socket_id']
    ))


@app.route('/w/<identifier>/', methods=all_methods)
@app.route('/w/<identifier>', methods=all_methods)
def proxy_webhook(identifier):
    # parse incoming data
    data = parse_incoming_data()
    print('incoming data', data)

    event = {
        'in': {},
        'out': {'method': '', 'url': '', 'body': 'null', 'headers': {}},
        'response': {'code': 0, 'body': ''}
    }

    def publish():
        eventjson = json.dumps(event)

        try:
            pusher.trigger('private-' + identifier, 'webhook', eventjson)
        except ValueError:
            print('couldn\'t send webhook to pusher', e)

        key = 'events:%s' % identifier
        rpipe = redis.pipeline()
        rpipe.lpush(key, eventjson)
        rpipe.ltrim(key, 0, 2)
        rpipe.expire(key, 86400)  # 24h
        rpipe.execute()

    endpoint = pg.select1(
        'endpoints',
        what=['definition', 'method', 'pass_headers',
              'headers', 'url', 'url_dynamic'],
        where={'id': identifier}
    )

    event['in'] = {
        'time': time.time(),
        'method': request.method,
        'body': data[:1800] + ' [truncated]' if len(data) > 1807 else data
    }

    if endpoint['url_dynamic']:
        endpoint['url'] = jq(endpoint['url'], data=data)
        if not endpoint['url']:
            publish()
            return 'url building has failed', 200

    mutated = jq(endpoint['definition'], data=data)
    if not mutated:
        publish()
        return 'transmutated into null and aborted', 201

    h = CaseInsensitiveDict({'Content-Type': 'application/json'})
    if endpoint['pass_headers']:
        h.update(request.headers)
    h.update(endpoint['headers'])

    # reformat the mutated data
    mutatedjson = json.loads(mutated)
    if h.get('content-type') == 'application/x-www-form-urlencoded':
        # oops, not json
        mutated = urlencode(mutatedjson)
    else:
        mutated = json.dumps(mutatedjson)

    event['out'] = {
        'method': endpoint['method'],
        'url': endpoint['url'][:120] + ' [-truncated-]'
        if len(endpoint['url']) > 127 else endpoint['url'],
        'body': mutated[:1500] + ' [-truncated-]'
        if len(mutated) > 1507 else mutated,
        'headers': endpoint['headers'],
    }

    if endpoint['url']:
        try:
            s = requests.Session()
            req = requests.Request(endpoint['method'], endpoint['url'],
                                   data=mutated, headers=h).prepare()
            resp = s.send(req, timeout=4)

            if not resp.ok:
                print('FAILED TO POST', resp.text, identifier, mutated)

        except requests.exceptions.RequestException as e:
            print('FAILED TO POST', e, identifier, mutated)
            resp = Response()
            resp.status_code = 503
            resp.body = "<request failed: '%s'>" % e

        event['response'] = {
            'code': resp.status_code,
            'body': resp.text[:200] + ' [-truncated-]'
            if len(resp.text) > 207 else resp.text
        }
    else:
        # not URL, just testing
        event['response'] = {'code': 0, 'body': '~'}
        publish()
        return 'no URL to send this to', 201

    response = make_response(resp.text, resp.status_code)
    response.headers.extend(resp.headers.items())
    publish()
    return response


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=settings.PORT, debug=settings.DEBUG)

import json
import requests
import datetime
from urllib.parse import urlencode
from requests import Response
from requests.structures import CaseInsensitiveDict
from flask import Flask, request, jsonify, redirect, make_response, \
                  render_template, flash, url_for
from flask_github import GitHub
from flask_login import LoginManager, login_user, logout_user, login_required

from third import pg, pusher, redis
from schema import schema
from helpers import jq, user_can_access_endpoint, all_methods, \
                    GraphQLViewWithUserContext as GraphQLView, \
                    parse_incoming_data, User
import settings

app = Flask(__name__)
app.secret_key = settings.SECRET
app.config.from_object(settings)

app.add_url_rule(
    '/graphql',
    view_func=GraphQLView.as_view('graphql',
                                  schema=schema,
                                  pretty=settings.LOCAL,
                                  graphiql=settings.LOCAL)
)

github = GitHub(app)
login_manager = LoginManager()
login_manager.login_view = "github_login"
login_manager.init_app(app)


@login_manager.user_loader
def load_user(user_id):
    return User(id=user_id)


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

    user = User.search(github_token=oauth_token)
    if user is None:
        user = User(github_token=oauth_token)
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
    if user_can_access_endpoint(identifier):
        return 'you do not have access to this endpoint', 401

    return jsonify(pusher.authenticate(
        channel=request.form['channel_name'],
        socket_id=request.form['socket_id']
    ))


@app.route('/w/<identifier>', methods=all_methods)
@app.route('/w/<identifier>/', methods=all_methods)
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
        rpipe.expire(key, 18000)
        rpipe.execute()

    values = pg.select(
        'endpoints',
        what=['definition', 'method', 'pass_headers',
              'headers', 'url', "data->'url:d' as url_dynamic"],
        where={'id': identifier}
    )[0]

    event['in'] = {
        'time': datetime.datetime.now().isoformat(),
        'body': data[:1800] + ' [truncated]' if len(data) > 1807 else data
    }

    if values['url_dynamic']:
        values['url'] = jq(values['url'], data=data)
        if not values['url']:
            publish()
            return 'url building has failed', 200

    mutated = jq(values['definition'], data=data)
    if not mutated:
        publish()
        return 'transmutated into null and aborted', 200

    h = CaseInsensitiveDict({'Content-Type': 'application/json'})
    if values['pass_headers']:
        h.update(request.headers)
    h.update(values['headers'])

    # reformat the mutated data
    mutatedjson = json.loads(mutated)
    if h.get('content-type') == 'application/x-www-form-urlencoded':
        # oops, not json
        mutated = urlencode(mutatedjson)
    else:
        mutated = json.dumps(mutatedjson)

    event['out'] = {
        'method': values['method'],
        'url': values['url'][:120] + ' [-truncated-]'
        if len(values['url']) > 127 else values['url'],
        'body': mutated[:1500] + ' [-truncated-]'
        if len(mutated) > 1507 else mutated,
        'headers': values['headers'],
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

    event['response'] = {
        'code': resp.status_code,
        'body': resp.text[:200] + ' [-truncated-]'
        if len(resp.text) > 207 else resp.text
    }

    publish()

    response = make_response(resp.text, resp.status_code)
    response.headers.extend(resp.headers.items())
    return response


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=settings.PORT, debug=settings.DEBUG)

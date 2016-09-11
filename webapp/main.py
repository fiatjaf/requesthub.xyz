from flask import request, jsonify, redirect, make_response, \
                  render_template, flash, url_for, g
from flask_login import login_user, logout_user, login_required

from app import app
from third import pusher, github
from helpers import user_can_access_endpoint, all_methods, \
                    parse_incoming_data, User
from request_handler import proxy
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
    print('incoming data', data, 'at', identifier)

    body, code, headers = proxy(
        identifier, request.method, request.headers, data)
    response = make_response(body, headers)
    response.headers.extend(headers.items())
    return response


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=settings.PORT, debug=settings.DEBUG)

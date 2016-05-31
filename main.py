import os
import requests
from flask import Flask, request, jsonify
from flask.ext.cors import CORS
from haikunator import haikunate
from db import pg
from helpers import jq
from actions import set_endpoint, get_endpoints, remove_endpoint, \
                    make_jwt, logged_user

app = Flask(__name__)
CORS(app)


@app.route('/auth', methods=['POST', 'GET'])
def auth():
    if request.method == 'GET':
        return jsonify({'jwt': None}), 401

    email = request.json['email']
    return jsonify({
        'email': email,
        'jwt': make_jwt(email)
    }), 200


@app.route('/e/', methods=['GET', 'POST'])
def endpoints():
    user = logged_user()

    if request.method == 'GET':
        if not user:
            return jsonify(endpoints={})
        return jsonify(endpoints=get_endpoints(user))

    elif request.method == 'POST':
        identifier = haikunate(tokenlength=4)

        identifier, message = set_endpoint(
            identifier, request.json.get('definition', 'error'),
            request.json.get('url', 'error'),
            request.json.get('headers', {}),
            user
        )
        if not identifier:
            return 'failed: %s' % message, 401

        return jsonify({
            'identifier': identifier,
            'owner': user,
            'play_url': request.url_root + 'd/' + identifier,
            'live_url': request.url_root + 'w/' + identifier,
        }), 201


@app.route('/e/<identifier>', methods=['PUT'])
def update_endpoint(identifier):
    user = logged_user()
    identifier, message = set_endpoint(
        identifier,
        request.json.get('definition', 'error'),
        request.json.get('url', 'error'),
        user
    )
    if not identifier:
        return 'failed: %s' % message, 401

    return jsonify({
        'identifier': identifier,
        'owner': user,
        'play_url': request.url_root + 'd/' + identifier,
        'live_url': request.url_root + 'w/' + identifier,
    }), 201


@app.route('/e/<identifier>', methods=['DELETE'])
def delete_endpoint(identifier):
    user = logged_user()
    if remove_endpoint(identifier, user):
        return 200
    return 500


@app.route('/d/<identifier>', methods=['GET', 'POST', 'HEAD'])
def display_processed(identifier):
    with pg() as cur:
        cur.execute('''
SELECT data FROM endpoints WHERE id = %s''', (identifier, ))
        info = cur.fetchone()[0]

        mutated = jq(info['def'], data=request.stream.read())
        if not mutated:
            return 'transmutated into null and aborted', 200

        return mutated + ' to ' + info['url']
    return 'an error ocurred', 500


@app.route('/w/<identifier>', methods=['GET', 'POST', 'HEAD'])
def redirect_webhook(identifier):
    with pg() as cur:
        cur.execute('''
SELECT data FROM endpoints WHERE id = %s''', (identifier, ))
        info = cur.fetchone()[0]

        mutated = jq(info['def'], data=request.stream.read())
        if not mutated:
            return 'transmutated into null and aborted', 200

        try:
            resp = requests.post(info['url'],
                                 data=mutated,
                                 headers={
                                     'Content-Type': 'application/json'
                                 }.update(info['headers']),
                                 timeout=4)
        except requests.exceptions.RequestException as e:
            print('FAILED TO POST', e, identifier, mutated)
        if not resp.ok:
            print('FAILED TO POST', resp.text, identifier, mutated)

        return resp.text, resp.status_code
    return 'an error ocurred', 500


if __name__ == '__main__':
    app.run('0.0.0.0',
            int(os.getenv('PORT', 8787)),
            debug=os.getenv('DEBUG', True))

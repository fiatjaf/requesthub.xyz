import os
import json
import urllib
import requests
from urllib import urlencode
from requests.structures import CaseInsensitiveDict
from flask import Flask, request, jsonify, redirect, make_response
from flask.ext.cors import CORS
from haikunator import haikunate
from db import pg
from helpers import jq, get_verified_email
from actions import set_endpoint, get_endpoints, remove_endpoint, \
                    make_jwt, logged_user

app = Flask(__name__)
CORS(app)


@app.route('/auth', methods=['POST'])
def auth():
    token = request.form['id_token']

    result = get_verified_email(token)
    if 'error' in result:
        raise result
        return redirect(os.getenv('CLIENT_URL'))

    return redirect(os.getenv('CLIENT_URL') + '#/logged?' + urllib.urlencode({
        'email': result['email'],
        'jwt': make_jwt(result['email'])
    }))


@app.route('/e/', methods=['GET', 'POST'])
def endpoints():
    user = logged_user()

    if request.method == 'GET':
        if not user:
            return jsonify(endpoints={})
        return jsonify(endpoints=get_endpoints(user))

    elif request.method == 'POST':
        newid = haikunate(tokenlength=4)

        identifier, message = set_endpoint(
            newid,
            request.json.get('definition', 'error'),
            request.json.get('url', 'error'),
            request.json.get('headers', {}),
            user
        )
        if not identifier:
            return jsonify(error=message), 401

        return jsonify({
            'identifier': identifier,
            'owner': user
        }), 201 if newid == identifier else 200


@app.route('/e/<identifier>', methods=['PUT', 'DELETE'])
@app.route('/e/<identifier>/', methods=['PUT', 'DELETE'])
def edit_endpoint(identifier):
    user = logged_user()

    if request.method == 'PUT':
        identifier, message = set_endpoint(
            identifier,
            request.json.get('definition', 'error'),
            request.json.get('url', 'error'),
            request.json.get('headers', {}),
            user
        )
        if not identifier:
            return jsonify(error=message), 401

        return jsonify({
            'identifier': identifier,
            'owner': user
        }), 200

    elif request.method == 'DELETE':
        if remove_endpoint(identifier, user):
            return jsonify({'deleted': identifier}), 200
        return jsonify(error='mysterious error'), 500


@app.route('/w/<identifier>', methods=['GET', 'POST', 'HEAD'])
@app.route('/w/<identifier>/', methods=['GET', 'POST', 'HEAD'])
def proxy_webhook(identifier):
    data = request.get_data()

    with pg() as cur:
        cur.execute('''
SELECT definition, headers, url, data->'url:d'
FROM endpoints WHERE id = %s''', (identifier, ))
        definition, headers, url, url_dynamic = cur.fetchone()

        if url_dynamic:
            url = jq(url, data=data)

        mutated = jq(definition, data=data)
        if not mutated:
            return 'transmutated into null and aborted', 200

        h = CaseInsensitiveDict({'Content-Type': 'application/json'})
        h.update(headers)

        if h.get('content-type') == 'application/x-www-form-urlencoded':
            # oops, not json
            mutated = urlencode(json.loads(mutated))

        print('POSTING ' + mutated + ' TO ' + url +
              ' WITH HEADERS ' + json.dumps(headers))

        try:
            resp = requests.post(
                url,
                data=mutated,
                headers=h,
                timeout=4
            )
        except requests.exceptions.RequestException as e:
            print('FAILED TO POST', e, identifier, mutated)
        if not resp.ok:
            print('FAILED TO POST', resp.text, identifier, mutated)

        response = make_response(resp.text, resp.status_code)
        response.headers.update(resp.headers)
        return response
    return 'an error ocurred', 500


if __name__ == '__main__':
    app.run('0.0.0.0',
            int(os.getenv('PORT', 8787)),
            debug=os.getenv('DEBUG', True))

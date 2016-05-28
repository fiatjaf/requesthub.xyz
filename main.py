import os
import json
import requests
from haikunator import haikunate
from flask import Flask, request, jsonify
from helpers import is_valid_modifier, is_valid_url, \
                    parse_header, pg_connect, jq

app = Flask(__name__)


@app.route('/e/', methods=['POST'])
def create_endpoint():
    identifier = haikunate(tokenlength=0)

    ok, message = set_endpoint(identifier,
                               request.form.get('definition', 'error'),
                               request.form.get('target', 'error'))
    if not ok:
        return 'failed: %s' % message, 401

    return jsonify({
        'identifier': identifier,
        'play_url': request.url_root + 'd/' + identifier,
        'live_url': request.url_root + 'w/' + identifier,
    }), 201


@app.route('/e/<identifier>', methods=['PUT'])
def update_endpoint(identifier):
    ok, message = set_endpoint(identifier,
                               request.json.get('definition', 'error'),
                               request.json.get('target', 'error'))
    if not ok:
        return 'failed: %s' % message, 401

    return jsonify({
        'identifier': identifier,
        'play_url': request.url_root + 'd/' + identifier,
        'live_url': request.url_root + 'w/' + identifier,
    }), 201


@app.route('/e/<identifier>', methods=['DELETE'])
def delete_endpoint(identifier):
    with pg_connect() as conn:
        with conn.cursor() as cur:
            cur.execute('''
UPDATE TABLE endpoints SET enabled=false WHERE id = %s
''', (identifier, ))
    return 200


def set_endpoint(identifier, definition, target_url, headers=[]):
    data = {}

    if not is_valid_modifier(definition):
        return False, 'please provide a valid jq definition'

    if not is_valid_url(target_url):
        # url is not static, but a modifier also
        data['url:d'] = True
        if not is_valid_modifier(target_url):
            return False, 'please provide a valid url'

    try:
        headers = dict([parse_header() for h in headers])
    except ValueError as e:
        return False, 'invalid header: %s' % e

    data['def'] = definition
    data['url'] = target_url
    data['headers'] = headers

    with pg_connect() as conn:
        with conn.cursor() as cur:
            cur.execute('''
INSERT INTO endpoints (id, data) VALUES (%s, %s)
ON CONFLICT (id) DO UPDATE SET data = %s''',
                        (identifier, json.dumps(data), json.dumps(data)))
            conn.commit()
            return True, ''

    return False, 'mysterious error'


@app.route('/d/<identifier>', methods=['GET', 'POST', 'HEAD'])
def display_processed(identifier):
    with pg_connect() as conn:
        with conn.cursor() as cur:
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
    with pg_connect() as conn:
        with conn.cursor() as cur:
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

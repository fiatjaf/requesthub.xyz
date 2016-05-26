import os
import redis
import requests
from dotenv import load_dotenv
from subprocess import Popen, PIPE
from flask import Flask, request, render_template

from helpers import make_identifier, is_valid_definition, is_valid_url

load_dotenv(os.path.join(os.path.dirname(__file__), 'lambda.env'))

app = Flask(__name__)
r = redis.StrictRedis.from_url(os.getenv('REDIS_URL'))

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/c/', methods=['POST'])
def create_endpoint():
    identifier = make_identifier()

    ok, message = set_endpoint(
        identifier,
        request.form.get('definition', 'error'),
        request.form.get('target', 'error')
    )
    if not ok:
        return 'failed: %s' % message, 401

    return 'set, test output at {h}d/{i} and direct webhooks to {h}w/{i}'.format(
        h=request.url_root, i=identifier
    ), 201

@app.route('/c/<identifier>', methods=['PUT'])
def update_endpoint(identifier):
    ok, message = set_endpoint(
        identifier,
        request.json.get('definition', 'error'),
        request.json.get('target', 'error')
    )
    if not ok:
        return 'failed: %s' % message, 401
    
    return 'set, test output at {h}d/{i} and direct webhooks to {h}w/{i}'.format(
        h=request.url_root, i=identifier
    ), 201

def set_endpoint(identifier, definition, target):
    if not is_valid_definition(definition):
        return False, 'please provide a valid jq definition'
    if not is_valid_url(target):
        return False, 'please provide a valid url'

    r.hset(identifier, 'def', definition)
    r.hset(identifier, 'tgt', target)
    return True, ''

@app.route('/d/<identifier>', methods=['GET', 'POST', 'HEAD'])
def display_processed(identifier):
    info = r.hgetall(identifier)
    mutated = process_input(info['def'], data = request.stream.read())
    if not mutated:
        return 'transmutated into null and aborted', 200

    return mutated + ' to ' + info['tgt']

@app.route('/w/<identifier>', methods=['GET', 'POST', 'HEAD'])
def redirect_webhook(identifier):
    info = r.hgetall(identifier)
    mutated = process_input(info['def'], data = request.stream.read())
    if not mutated:
        return 'transmutated into null and aborted', 200

    try:
        resp = requests.post(
            info['tgt'],
            data=mutated,
            headers={'Content-Type': 'application/json'},
            timeout=4
        )
    except requests.exceptions.RequestException as e:
        print('FAILED TO POST', e, identifier, mutated)
    if not resp.ok:
        print('FAILED TO POST', resp.text, identifier, mutated)

    return resp.text, resp.status_code

def process_input(definition, data):
    p = Popen(['./jq', '-c', '-M', definition], stdin=PIPE, stdout=PIPE)
    res = p.communicate(input=data)[0]
    return res

if __name__ == '__main__':
    app.run('0.0.0.0', int(os.getenv('PORT', 8787)), debug=os.getenv('DEBUG', True))

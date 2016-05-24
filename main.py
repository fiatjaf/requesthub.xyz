import os
import redis
import requests
from urlparse import urlparse
from dotenv import load_dotenv
from subprocess import Popen, PIPE
from flask import Flask, request, render_template

load_dotenv(os.path.join(os.path.dirname(__file__), 'lambda.env'))

app = Flask(__name__)
r = redis.StrictRedis.from_url(os.getenv('REDIS_URL'))

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/c/<identifier>', methods=['PUT'])
def create_endpoint(identifier):
    if not is_valid_definition(request.form.get('definition', 'error')):
        return 'please provide a valid jq definition', 400

    if not is_valid_url(request.form.get('target', 'error')):
        return 'please provide a valid url', 400

    r.hset(identifier, 'def', request.form['definition'])
    r.hset(identifier, 'tgt', request.form['target'])
    return 'set, test output at {h}d/{i} and direct webhooks to {h}w/{i}'.format(
        h=request.url_root, i=identifier), 201

@app.route('/d/<identifier>', methods=['GET', 'POST', 'HEAD'])
def display_processed(identifier):
    info = r.hgetall(identifier)
    mutated = process_input(info['def'], request.get_data())
    return mutated + ' to ' + info['tgt']

@app.route('/w/<identifier>', methods=['GET', 'POST', 'HEAD'])
def redirect_webhook(identifier):
    info = r.hgetall(identifier)
    mutated = process_input(info['def'], request.get_data())
    resp = requests.post(info['tgt'], data=mutated, headers={'Content-Type': 'application/json'})
    if not resp.ok:
        print(resp.text, identifier, mutated)
    return resp.text, resp.status_code

def is_valid_definition(definition):
    if len(definition) > 600:
        return False
    p = Popen(['./jq', '-c', '-M', definition], stdin=PIPE, stdout=PIPE)
    p.communicate(input='{}')
    return p.returncode == 0

def is_valid_url(url):
    p = urlparse(url)
    if not p.scheme or not p.netloc or p.netloc == urlparse(request.url_root).netloc:
        return False
    return True

def process_input(definition, data):
    p = Popen(['./jq', '-c', '-M', '{a: 23, b: .id}'], stdin=PIPE, stdout=PIPE)
    res = p.communicate(input=data)[0]
    return res

if __name__ == '__main__':
    app.run('0.0.0.0', int(os.getenv('PORT', 8787)), debug=os.getenv('DEBUG', True))

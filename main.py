import os
from subprocess import Popen, PIPE
from flask import Flask, request

app = Flask(__name__)

@app.route('/')
def index():
    return 'PAM', 200

@app.route('/w/<identifier>', methods=['GET', 'PUT', 'POST', 'HEAD'])
def handle_webhook(identifier):
    data = request.get_data()
    p = Popen(['./jq', '-c', '-M', '. | {a: 23, b: .id}'], stdin=PIPE, stdout=PIPE)
    res = p.communicate(input=data)
    return res

if __name__ == '__main__':
    app.run('0.0.0.0', int(os.getenv('PORT', 8787)), debug=os.getenv('DEBUG', True))

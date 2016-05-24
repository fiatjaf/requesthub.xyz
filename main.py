from flask import Flask

app = Flask(__name__)

@app.route('/')
def index():
    return 'PAM', 200

@app.route('/w/<identifier>', methods=['GET', 'PUT', 'POST', 'HEAD'])
def handle_webhook(identifier):
    return identifier, 200

if __name__ == '__main__':
    app.run('0.0.0.0', int(os.getenv('PORT', 8787)), debug=os.getenv('DEBUG'))

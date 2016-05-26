import os
from flask import Flask, request

app = Flask(__name__)

@app.route('/test', methods=['POST'])
def test():
    print('request.get_data():', request.get_data())
    print('request.data:', request.data)
    return request.data

if __name__ == '__main__':
    app.run('0.0.0.0', int(os.getenv('PORT', 8787)), debug=os.getenv('DEBUG', True))

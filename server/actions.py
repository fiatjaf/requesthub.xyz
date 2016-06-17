import os
import jwt
from flask import request


def logged_user():
    if 'Authorization' not in request.headers:
        return None
    _, token = request.headers['Authorization'].split(' ', 1)
    if not token:
        return None

    try:
        d = jwt.decode(token, os.getenv('SECRET'), algorithms=['HS256'])
    except jwt.DecodeError:
        return None

    return d.get('email')


def make_jwt(email):
    return jwt.encode({'email': email}, os.getenv('SECRET'), algorithm='HS256')

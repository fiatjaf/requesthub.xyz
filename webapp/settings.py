import os

DATABASE_URL = POSTGRESQL_URL = os.getenv('DATABASE_URL')
PUSHER_SOCKET_URL = os.getenv('PUSHER_SOCKET_URL')
PUSHER_URL = os.getenv('PUSHER_URL')
REDIS_URL = os.getenv('REDIS_URL')

GITHUB_CLIENT_ID = os.getenv('GITHUB_CLIENT_ID')
GITHUB_CLIENT_SECRET = os.getenv('GITHUB_CLIENT_SECRET')

SECRET = os.getenv('SECRET', 'whiplash')
STATE = os.getenv('STATE', 'super random')
SERVICE_NAME = os.getenv('SERVICE_NAME', 'requesthub')
LOCAL = DEBUG = bool(os.getenv('LOCAL'))
PORT = int(os.getenv('PORT', 5000))

REMEMBER_COOKIE_NAME = 'rmereqhub'

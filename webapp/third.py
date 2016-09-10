from little_pger import LittlePGer
from redis import StrictRedis
from pusher import Pusher
from flask import g
from flask_github import GitHub

import settings


redis = StrictRedis.from_url(settings.REDIS_URL)
pusher = Pusher.from_url(settings.PUSHER_URL)
pg = LittlePGer(settings.POSTGRESQL_URL, commit=True)


github = GitHub()


@github.access_token_getter
def get_token():
    return g.github_token

import os
import psycopg2
from little_pger import LittlePGer
from redis import StrictRedis
from pusher import Pusher


redis = StrictRedis.from_url(os.getenv('REDIS_URL'))
pusher = Pusher.from_url(os.getenv('PUSHER_URL'))


pg = psycopg2.connect(os.getenv('POSTGRESQL_URL'))


def lpg():
    return LittlePGer(os.getenv('POSTGRESQL_URL'), commit=True)
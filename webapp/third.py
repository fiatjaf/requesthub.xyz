from little_pger import LittlePGer
from redis import StrictRedis
from pusher import Pusher

import settings


redis = StrictRedis.from_url(settings.REDIS_URL)
pusher = Pusher.from_url(settings.PUSHER_URL)
pg = LittlePGer(settings.POSTGRESQL_URL, commit=True)

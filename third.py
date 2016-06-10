import os
import pg8000
from urlparse import urlparse
from redis import StrictRedis
from pusher import Pusher

redis = StrictRedis.from_url(os.getenv('REDIS_URL'))
pusher = Pusher.from_url(os.getenv('PUSHER_URL'))


def pg():
    p = urlparse(os.getenv('POSTGRESQL_URL'))
    return Connection(p.username, p.hostname, None, p.port,
                      p.path[1:], p.password, True, None)


class Connection(pg8000.Connection):
    def __enter__(self):
        self.autocommit = True
        self.____cursor = self.cursor()
        return self.____cursor

    def __exit__(self, *args):
        self.____cursor.close()
        self.autocommit = False
        self.close()

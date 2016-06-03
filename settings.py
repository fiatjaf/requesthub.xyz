import os
from dotenv import load_dotenv


def init():
    load_dotenv(os.path.join(os.path.dirname(__file__), 'global.env'))

    if os.getenv('LOCAL'):
        load_dotenv(os.path.join(os.path.dirname(__file__), 'local.env'))
    else:
        load_dotenv(os.path.join(os.path.dirname(__file__), 'prod.env'))

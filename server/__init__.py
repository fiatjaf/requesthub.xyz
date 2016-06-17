import os

if os.getenv('LOCAL'):
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), '../global.env'))
    load_dotenv(os.path.join(os.path.dirname(__file__), '../local.env'))

os.environ.setdefault('POSTGRESQL_URL', os.getenv('DATABASE_URL', ''))

from main import app as webhooks_backend


if __name__ == '__main__':
    webhooks_backend.run(
        '0.0.0.0',
        int(os.getenv('PORT', 8787)),
        debug=os.getenv('DEBUG', False)
    )

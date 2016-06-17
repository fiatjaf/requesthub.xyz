from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), 'lambda.env'))

from main import app

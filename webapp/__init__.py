import os
import sys

if os.getenv('FLASK_APP'):
    sys.path.append(os.getcwd())

import logging
from waitress import serve
from app import app

logging.basicConfig(level=logging.INFO)
serve(app, host="0.0.0.0", port=5000)
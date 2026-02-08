"""
Configuration for Shopping Assistant Web Server
"""
import os
from pathlib import Path

# Server Config
HOST = os.getenv('HOST', '0.0.0.0')
PORT = int(os.getenv('PORT', 5000))
DEBUG = os.getenv('DEBUG', 'false').lower() == 'true'

# Azure VM Info
AZURE_DNS = 'mullion.indonesiacentral.cloudapp.azure.com'
AZURE_IP = '70.153.24.49'

# SSL Config (self-signed)
SSL_CERT = os.getenv('SSL_CERT', 'certs/cert.pem')
SSL_KEY = os.getenv('SSL_KEY', 'certs/key.pem')
USE_SSL = os.getenv('USE_SSL', 'true').lower() == 'true'

# API Keys (loaded from environment)
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY', '')
SERPER_API_KEY = os.getenv('SERPER_API_KEY', '')

# Optional Auth (leave empty for no auth)
AUTH_TOKEN = os.getenv('AUTH_TOKEN', '')

# Paths
BASE_DIR = Path(__file__).parent
STATIC_DIR = BASE_DIR / 'static'
CERTS_DIR = BASE_DIR / 'certs'

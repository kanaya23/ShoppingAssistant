#!/bin/bash
# Generate self-signed SSL certificates for Shopping Assistant Web Server

CERT_DIR="$(dirname "$0")/certs"
DOMAIN="mullion.indonesiacentral.cloudapp.azure.com"

mkdir -p "$CERT_DIR"

echo "Generating self-signed SSL certificate for: $DOMAIN"

openssl req -x509 -newkey rsa:4096 \
    -keyout "$CERT_DIR/key.pem" \
    -out "$CERT_DIR/cert.pem" \
    -days 365 \
    -nodes \
    -subj "/CN=$DOMAIN" \
    -addext "subjectAltName=DNS:$DOMAIN,DNS:localhost,IP:70.153.24.49,IP:127.0.0.1"

echo "Certificate generated at: $CERT_DIR/cert.pem"
echo "Private key generated at: $CERT_DIR/key.pem"
echo ""
echo "Done! Start the server with: python server_app.py"

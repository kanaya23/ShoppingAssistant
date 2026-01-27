#!/usr/bin/env python3
"""
Shopee API Proxy Server v2
Enhanced with session handling and better anti-bot evasion.
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
import time

app = Flask(__name__)
CORS(app)  # Allow all origins (for localhost extension use)

# Create a session that will store cookies between requests
session = requests.Session()

# Complete browser-like headers
session.headers.update({
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Linux"',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
})

# Initialize session by visiting the main page
def init_session():
    """Visit Shopee homepage to get initial cookies."""
    try:
        print('[Proxy] Initializing session with Shopee...')
        response = session.get('https://shopee.co.id/', timeout=10)
        print(f'[Proxy] Session init: {response.status_code}, cookies: {len(session.cookies)}')
        return True
    except Exception as e:
        print(f'[Proxy] Session init error: {e}')
        return False

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint."""
    return jsonify({
        'status': 'ok', 
        'service': 'shopee-proxy',
        'cookies': len(session.cookies)
    })

@app.route('/api/init', methods=['GET'])
def api_init():
    """Manually reinitialize the session."""
    success = init_session()
    return jsonify({'success': success, 'cookies': len(session.cookies)})

@app.route('/api/item', methods=['GET'])
def get_item():
    """
    Proxy for Shopee item details API.
    Query params: itemid, shopid
    """
    itemid = request.args.get('itemid')
    shopid = request.args.get('shopid')
    
    if not itemid or not shopid:
        return jsonify({'error': 'Missing itemid or shopid'}), 400
    
    # Ensure we have cookies
    if len(session.cookies) == 0:
        init_session()
    
    url = f'https://shopee.co.id/api/v4/item/get?itemid={itemid}&shopid={shopid}'
    
    # Set proper referer for this request
    headers = {
        'Referer': f'https://shopee.co.id/product-i.{shopid}.{itemid}',
        'X-Shopee-Language': 'id',
        'X-Requested-With': 'XMLHttpRequest',
        'X-API-SOURCE': 'pc',
    }
    
    try:
        response = session.get(url, headers=headers, timeout=15)
        
        # If forbidden, try refreshing cookies and retry
        if response.status_code == 403:
            print('[Proxy] Got 403, refreshing session...')
            init_session()
            time.sleep(0.5)
            response = session.get(url, headers=headers, timeout=15)
        
        response.raise_for_status()
        return jsonify(response.json())
    except requests.HTTPError as e:
        return jsonify({'error': f'HTTP {e.response.status_code}: {str(e)}'}), e.response.status_code
    except requests.RequestException as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/ratings', methods=['GET'])
def get_ratings():
    """
    Proxy for Shopee ratings API.
    Query params: itemid, shopid, limit (default 5)
    """
    itemid = request.args.get('itemid')
    shopid = request.args.get('shopid')
    limit = request.args.get('limit', '5')
    
    if not itemid or not shopid:
        return jsonify({'error': 'Missing itemid or shopid'}), 400
    
    # Ensure we have cookies
    if len(session.cookies) == 0:
        init_session()
    
    url = f'https://shopee.co.id/api/v2/item/get_ratings?itemid={itemid}&shopid={shopid}&limit={limit}&offset=0&type=0'
    
    headers = {
        'Referer': f'https://shopee.co.id/product-i.{shopid}.{itemid}',
        'X-Shopee-Language': 'id',
        'X-Requested-With': 'XMLHttpRequest',
        'X-API-SOURCE': 'pc',
    }
    
    try:
        response = session.get(url, headers=headers, timeout=15)
        
        if response.status_code == 403:
            print('[Proxy] Got 403 on ratings, refreshing session...')
            init_session()
            time.sleep(0.5)
            response = session.get(url, headers=headers, timeout=15)
            
        response.raise_for_status()
        return jsonify(response.json())
    except requests.HTTPError as e:
        return jsonify({'error': f'HTTP {e.response.status_code}: {str(e)}'}), e.response.status_code
    except requests.RequestException as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/search', methods=['GET'])
def search():
    """
    Proxy for Shopee search API.
    Query params: keyword, limit (default 20)
    """
    keyword = request.args.get('keyword')
    limit = request.args.get('limit', '20')
    
    if not keyword:
        return jsonify({'error': 'Missing keyword'}), 400
    
    # Ensure we have cookies
    if len(session.cookies) == 0:
        init_session()
    
    url = f'https://shopee.co.id/api/v4/search/search_items?keyword={keyword}&limit={limit}&order=desc&page_type=search&scenario=PAGE_GLOBAL_SEARCH&version=2'
    
    headers = {
        'Referer': f'https://shopee.co.id/search?keyword={keyword}',
        'X-Shopee-Language': 'id',
        'X-Requested-With': 'XMLHttpRequest',
        'X-API-SOURCE': 'pc',
    }
    
    try:
        response = session.get(url, headers=headers, timeout=15)
        
        if response.status_code == 403:
            print('[Proxy] Got 403 on search, refreshing session...')
            init_session()
            time.sleep(0.5)
            response = session.get(url, headers=headers, timeout=15)
            
        response.raise_for_status()
        return jsonify(response.json())
    except requests.HTTPError as e:
        return jsonify({'error': f'HTTP {e.response.status_code}: {str(e)}'}), e.response.status_code
    except requests.RequestException as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    print('🚀 Shopee Proxy Server v2 starting on http://localhost:8000')
    print('   Endpoints:')
    print('   - GET /health')
    print('   - GET /api/init (reinitialize session)')
    print('   - GET /api/item?itemid=X&shopid=Y')
    print('   - GET /api/ratings?itemid=X&shopid=Y&limit=5')
    print('   - GET /api/search?keyword=X&limit=20')
    
    # Initialize session on startup
    init_session()
    
    app.run(host='127.0.0.1', port=8000, debug=True)

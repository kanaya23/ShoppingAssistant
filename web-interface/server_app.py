#!/usr/bin/env python3
"""
Shopping Assistant Web Server
Flask + Socket.IO server that bridges the browser extension with web clients.

Features:
- Hosts the web UI (clone of extension sidebar)
- WebSocket communication for real-time updates
- Direct Gemini API integration
- Routes tool calls to connected browser extension
"""

import os
import json
import time
import uuid
import ssl
from pathlib import Path
from threading import Lock
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

from flask import Flask, render_template, request, send_from_directory, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room, leave_room
import requests

import config

# Initialize Flask app
app = Flask(__name__, static_folder='static', template_folder='static')
app.config['SECRET_KEY'] = os.urandom(24).hex()
CORS(app, resources={r"/*": {"origins": "*"}})

# Initialize Socket.IO with eventlet for async support
socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode='eventlet',
    ping_timeout=60,
    ping_interval=25
)

# ============================================================================
# STATE MANAGEMENT
# ============================================================================

class ConnectionManager:
    """Manages connected clients and browser extensions."""
    
    def __init__(self):
        self.lock = Lock()
        self.web_clients = {}      # sid -> {session_id, connected_at}
        self.extensions = {}        # sid -> {tab_id, connected_at}
        self.conversations = {}     # session_id -> {messages: [], processing: bool}
        self.pending_tools = {}     # request_id -> {session_id, tool_name, resolve}
    
    def add_web_client(self, sid, session_id):
        with self.lock:
            self.web_clients[sid] = {
                'session_id': session_id,
                'connected_at': time.time()
            }
            if session_id not in self.conversations:
                self.conversations[session_id] = {
                    'messages': [],
                    'processing': False
                }
    
    def remove_web_client(self, sid):
        with self.lock:
            if sid in self.web_clients:
                del self.web_clients[sid]
    
    def add_extension(self, sid, tab_id=None):
        with self.lock:
            self.extensions[sid] = {
                'tab_id': tab_id,
                'connected_at': time.time()
            }
    
    def remove_extension(self, sid):
        with self.lock:
            if sid in self.extensions:
                del self.extensions[sid]
    
    def get_active_extension(self):
        """Get the first connected extension SID."""
        with self.lock:
            if self.extensions:
                return list(self.extensions.keys())[0]
            return None
    
    def has_extension(self):
        """Check if any extension is connected."""
        with self.lock:
            return len(self.extensions) > 0
    
    def get_conversation(self, session_id):
        with self.lock:
            if session_id not in self.conversations:
                self.conversations[session_id] = {
                    'messages': [],
                    'processing': False
                }
            return self.conversations[session_id]
    
    def add_message(self, session_id, role, content, parts=None):
        conv = self.get_conversation(session_id)
        conv['messages'].append({
            'role': role,
            'content': content,
            'parts': parts,
            'timestamp': time.time()
        })
    
    def clear_conversation(self, session_id):
        with self.lock:
            if session_id in self.conversations:
                self.conversations[session_id]['messages'] = []

manager = ConnectionManager()

# ============================================================================
# GEMINI API INTEGRATION
# ============================================================================

# System prompt for the AI
SYSTEM_PROMPT = """You are a **Smart Shopping Recommender** for Shopee Indonesia. You analyze products with healthy skepticism, but your PRIMARY GOAL is to **recommend the best products** for users to buy.

## Your Role: RECOMMENDER, Not Just Warner
- While you must spot fake reviews and bad quality, you must NOT be paralyzed by them.
- Even imperfect products are buyable if the price is right.
- Your output should always lead the user to a purchase decision.

## Available Tools
You have access to these tools (only when browser extension is connected):
- `search_shopee`: Search for products on Shopee
- `scrape_listings`: Get product listings from search results
- `deep_scrape_urls`: Deep scrape specific product pages for detailed info
- `serper_search`: Google search for reviews and external info (always available)

## Tool Call Format
When you need to use a tool, respond with ONLY a JSON code block:
```json
{"tool": "tool_name", "args": {"arg1": "value1"}}
```

## Output Format
When recommending products:
- 🏆 **Best Overall** (Balance of price/quality)
- 💎 **Best Value** (Cheap but good)
- 🛡️ **Safest Pick** (Official store, high sales)
- Always include direct product URLs

Be decisive. Don't say "It depends". Say "If you want X, get this."
"""

# Tool definitions for Gemini API
TOOL_DEFINITIONS = [
    {
        "functionDeclarations": [
            {
                "name": "search_shopee",
                "description": "Search for products on Shopee Indonesia",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "keyword": {
                            "type": "string",
                            "description": "The search keyword"
                        }
                    },
                    "required": ["keyword"]
                }
            },
            {
                "name": "scrape_listings",
                "description": "Extract product listings from current Shopee search results",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "max_items": {
                            "type": "integer",
                            "description": "Maximum products to extract (default: 1000)"
                        }
                    }
                }
            },
            {
                "name": "deep_scrape_urls",
                "description": "Deep scrape specific product URLs for detailed info",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "urls": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Array of product URLs to scrape"
                        }
                    },
                    "required": ["urls"]
                }
            },
            {
                "name": "serper_search",
                "description": "Google search for external reviews and info",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Search query (multiple queries separated by ;)"
                        }
                    },
                    "required": ["query"]
                }
            }
        ]
    }
]

def call_gemini_api(messages, session_id, stream_callback=None):
    """
    Call Gemini API with streaming support.
    Returns: {"text": str, "toolCalls": list}
    """
    api_key = config.GEMINI_API_KEY
    if not api_key:
        return {"error": "Gemini API key not configured on server"}
    
    model = "gemini-2.5-flash"
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?key={api_key}&alt=sse"
    
    # Format messages for Gemini
    contents = []
    for msg in messages:
        role = 'model' if msg['role'] == 'assistant' else 'user'
        parts = msg.get('parts') or [{'text': msg.get('content', '')}]
        contents.append({'role': role, 'parts': parts})
    
    body = {
        'contents': contents,
        'tools': TOOL_DEFINITIONS,
        'systemInstruction': {
            'parts': [{'text': SYSTEM_PROMPT}]
        },
        'generationConfig': {
            'temperature': 0.7,
            'topP': 0.95,
            'topK': 40,
            'maxOutputTokens': 8192
        }
    }
    
    try:
        response = requests.post(url, json=body, stream=True, timeout=120)
        response.raise_for_status()
        
        full_text = ""
        tool_calls = []
        
        for line in response.iter_lines():
            if line:
                line_str = line.decode('utf-8')
                if line_str.startswith('data: '):
                    try:
                        data = json.loads(line_str[6:])
                        if 'candidates' in data and data['candidates']:
                            candidate = data['candidates'][0]
                            if 'content' in candidate and 'parts' in candidate['content']:
                                for part in candidate['content']['parts']:
                                    if 'text' in part:
                                        chunk = part['text']
                                        full_text += chunk
                                        if stream_callback:
                                            stream_callback('chunk', chunk)
                                    if 'functionCall' in part:
                                        tool_calls.append(part['functionCall'])
                                        if stream_callback:
                                            stream_callback('toolCall', part['functionCall'])
                    except json.JSONDecodeError:
                        pass
        
        return {"text": full_text, "toolCalls": tool_calls}
    
    except requests.exceptions.RequestException as e:
        return {"error": str(e)}

def execute_serper_search(query):
    """Execute Serper search directly (no extension needed)."""
    api_key = config.SERPER_API_KEY
    if not api_key:
        return {"error": "Serper API key not configured"}
    
    queries = [q.strip() for q in query.split(';') if q.strip()]
    results = []
    
    for q in queries:
        try:
            response = requests.post(
                "https://google.serper.dev/search",
                headers={"X-API-KEY": api_key, "Content-Type": "application/json"},
                json={"q": q},
                timeout=30
            )
            data = response.json()
            results.append({"query": q, "result": data, "success": True})
        except Exception as e:
            results.append({"query": q, "error": str(e), "success": False})
    
    # Format results
    report = "=== SERPER SEARCH RESULTS ===\n"
    for item in results:
        report += f"\n🔎 Query: \"{item['query']}\"\n"
        report += "─" * 30 + "\n"
        if not item['success']:
            report += f"Error: {item['error']}\n"
            continue
        
        result = item['result']
        if result.get('organic'):
            for i, org in enumerate(result['organic'][:4]):
                report += f"{i+1}. {org.get('title', 'N/A')}\n"
                report += f"   URL: {org.get('link', 'N/A')}\n"
                report += f"   {org.get('snippet', '')}\n\n"
    
    return {"success": True, "data": report}

# ============================================================================
# SOCKET.IO EVENT HANDLERS
# ============================================================================

@socketio.on('connect')
def handle_connect():
    """Handle new connections (both web clients and extensions)."""
    print(f'[WS] Client connected: {request.sid}')

@socketio.on('disconnect')
def handle_disconnect():
    """Handle disconnections."""
    sid = request.sid
    manager.remove_web_client(sid)
    manager.remove_extension(sid)
    print(f'[WS] Client disconnected: {sid}')

@socketio.on('register_web_client')
def handle_register_web(data):
    """Register a web UI client."""
    session_id = data.get('session_id') or str(uuid.uuid4())
    manager.add_web_client(request.sid, session_id)
    
    # Send current state
    emit('registered', {
        'session_id': session_id,
        'extension_connected': manager.has_extension()
    })
    
    # Send conversation history if exists
    conv = manager.get_conversation(session_id)
    if conv['messages']:
        emit('conversation_history', {'messages': conv['messages']})
    
    print(f'[WS] Web client registered: {session_id}')

@socketio.on('register_extension')
def handle_register_extension(data):
    """Register a browser extension."""
    tab_id = data.get('tab_id')
    manager.add_extension(request.sid, tab_id)
    
    # Notify all web clients
    socketio.emit('extension_status', {'connected': True})
    
    emit('registered', {'status': 'ok'})
    print(f'[WS] Extension registered: tab={tab_id}')

@socketio.on('send_message')
def handle_send_message(data):
    """Handle user message from web client."""
    session_id = data.get('session_id')
    text = data.get('text', '').strip()
    
    if not text or not session_id:
        return
    
    conv = manager.get_conversation(session_id)
    if conv['processing']:
        emit('error', {'message': 'Already processing a message'})
        return
    
    conv['processing'] = True
    
    # Add user message
    manager.add_message(session_id, 'user', text)
    emit('message_added', {'role': 'user', 'content': text})
    
    # Start streaming
    emit('stream_start')
    
    def stream_callback(event_type, data):
        if event_type == 'chunk':
            socketio.emit('stream_chunk', {'chunk': data}, room=request.sid)
        elif event_type == 'toolCall':
            socketio.emit('tool_call', {'name': data['name'], 'args': data.get('args', {})}, room=request.sid)
    
    try:
        # Call Gemini API
        messages = conv['messages']
        response = call_gemini_api(messages, session_id, stream_callback)
        
        if 'error' in response:
            emit('error', {'message': response['error']})
            conv['processing'] = False
            emit('stream_end')
            return
        
        # Handle tool calls
        max_loops = 5
        loop_count = 0
        
        while response.get('toolCalls') and loop_count < max_loops:
            loop_count += 1
            tool_call = response['toolCalls'][0]
            tool_name = tool_call['name']
            tool_args = tool_call.get('args', {})
            
            emit('tool_executing', {'name': tool_name})
            
            # Execute tool
            if tool_name == 'serper_search':
                # Execute directly on server
                result = execute_serper_search(tool_args.get('query', ''))
            elif manager.has_extension():
                # Route to extension
                result = execute_tool_via_extension(tool_name, tool_args, session_id)
            else:
                result = {'error': f'Tool {tool_name} requires browser extension, but none connected'}
            
            emit('tool_result', {'name': tool_name, 'success': 'error' not in result})
            
            # Add tool call and result to conversation
            manager.add_message(session_id, 'assistant', '', parts=[{'functionCall': tool_call}])
            manager.add_message(session_id, 'user', '', parts=[{
                'functionResponse': {'name': tool_name, 'response': result}
            }])
            
            # Continue with AI
            messages = conv['messages']
            response = call_gemini_api(messages, session_id, stream_callback)
            
            if 'error' in response:
                emit('error', {'message': response['error']})
                break
        
        # Save final response
        if response.get('text'):
            manager.add_message(session_id, 'assistant', response['text'])
        
    except Exception as e:
        emit('error', {'message': str(e)})
    finally:
        conv['processing'] = False
        emit('stream_end')

@socketio.on('clear_conversation')
def handle_clear(data):
    """Clear conversation history."""
    session_id = data.get('session_id')
    if session_id:
        manager.clear_conversation(session_id)
        emit('conversation_cleared')

# Extension tool execution
pending_tool_requests = {}
tool_request_lock = Lock()

def execute_tool_via_extension(tool_name, args, session_id):
    """Send tool execution request to extension and wait for result."""
    ext_sid = manager.get_active_extension()
    if not ext_sid:
        return {'error': 'No extension connected'}
    
    request_id = str(uuid.uuid4())
    
    # Store pending request
    with tool_request_lock:
        pending_tool_requests[request_id] = {
            'session_id': session_id,
            'result': None,
            'completed': False
        }
    
    # Send to extension
    socketio.emit('execute_tool', {
        'request_id': request_id,
        'tool_name': tool_name,
        'args': args
    }, room=ext_sid)
    
    # Wait for result (max 120 seconds)
    start = time.time()
    while time.time() - start < 120:
        with tool_request_lock:
            if pending_tool_requests.get(request_id, {}).get('completed'):
                result = pending_tool_requests[request_id]['result']
                del pending_tool_requests[request_id]
                return result
        time.sleep(0.5)
    
    # Timeout
    with tool_request_lock:
        if request_id in pending_tool_requests:
            del pending_tool_requests[request_id]
    
    return {'error': 'Tool execution timeout'}

@socketio.on('tool_result')
def handle_tool_result(data):
    """Handle tool result from extension."""
    request_id = data.get('request_id')
    result = data.get('result', {})
    
    with tool_request_lock:
        if request_id in pending_tool_requests:
            pending_tool_requests[request_id]['result'] = result
            pending_tool_requests[request_id]['completed'] = True

@socketio.on('tool_progress')
def handle_tool_progress(data):
    """Relay tool progress from extension to web client."""
    session_id = data.get('session_id')
    # Find web client with this session and relay
    for sid, info in manager.web_clients.items():
        if info['session_id'] == session_id:
            socketio.emit('tool_progress', data, room=sid)

# ============================================================================
# HTTP ROUTES
# ============================================================================

@app.route('/')
def index():
    """Serve the web UI."""
    return send_from_directory(config.STATIC_DIR, 'index.html')

@app.route('/static/<path:filename>')
def serve_static(filename):
    """Serve static files."""
    return send_from_directory(config.STATIC_DIR, filename)

@app.route('/health')
def health():
    """Health check endpoint."""
    return jsonify({
        'status': 'ok',
        'web_clients': len(manager.web_clients),
        'extensions': len(manager.extensions)
    })

@app.route('/api/settings', methods=['POST'])
def save_settings():
    """Save API keys (for authenticated sessions)."""
    # This could be expanded with proper auth
    return jsonify({'status': 'ok'})

# ============================================================================
# MAIN ENTRY POINT
# ============================================================================

def generate_self_signed_cert():
    """Generate self-signed SSL certificate if not exists."""
    cert_path = config.CERTS_DIR / 'cert.pem'
    key_path = config.CERTS_DIR / 'key.pem'
    
    if cert_path.exists() and key_path.exists():
        return str(cert_path), str(key_path)
    
    config.CERTS_DIR.mkdir(parents=True, exist_ok=True)
    
    print('[Server] Generating self-signed SSL certificate...')
    import subprocess
    subprocess.run([
        'openssl', 'req', '-x509', '-newkey', 'rsa:4096',
        '-keyout', str(key_path), '-out', str(cert_path),
        '-days', '365', '-nodes',
        '-subj', f'/CN={config.AZURE_DNS}'
    ], check=True)
    
    print(f'[Server] Certificate generated: {cert_path}')
    return str(cert_path), str(key_path)

if __name__ == '__main__':
    print('=' * 60)
    print('  Shopping Assistant Web Server')
    print('=' * 60)
    print(f'  Azure DNS: {config.AZURE_DNS}')
    print(f'  Azure IP:  {config.AZURE_IP}')
    print(f'  Port:      {config.PORT}')
    print(f'  SSL:       {config.USE_SSL}')
    print('=' * 60)
    
    ssl_context = None
    if config.USE_SSL:
        try:
            cert_path, key_path = generate_self_signed_cert()
            ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            ssl_context.load_cert_chain(cert_path, key_path)
            print(f'[Server] SSL enabled with self-signed certificate')
        except Exception as e:
            print(f'[Server] SSL setup failed: {e}')
            print('[Server] Falling back to HTTP')
            ssl_context = None
    
    # Start the server
    socketio.run(
        app,
        host=config.HOST,
        port=config.PORT,
        debug=config.DEBUG,
        ssl_context=ssl_context
    )

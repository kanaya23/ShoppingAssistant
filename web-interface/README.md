# Shopping Assistant Web Interface

**Remote access to your Shopping Assistant from any device** - mobile, tablet, or another PC.

This web interface connects to your browser extension (the "worker") to perform Shopee searches and scraping.

---

## 🚀 Quick Overview

```
┌─────────────────────────────────────────────────────────────┐
│  📱 Your Phone / Any Device                                 │
│  └── Opens the Web Interface                                │
└───────────────────────┬─────────────────────────────────────┘
                        │ WebSocket
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  🖥️  Azure VM Server                                        │
│  └── Hosts Web Interface + Routes messages                  │
└───────────────────────┬─────────────────────────────────────┘
                        │ WebSocket
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  💻 Your PC (Worker)                                        │
│  ├── Chrome/Firefox with Extension loaded                   │
│  └── Has Shopee tab open                                    │
└─────────────────────────────────────────────────────────────┘
```

---

## 📋 Prerequisites

- **Azure VM** with Ubuntu/Debian (or any Linux server)
- **Python 3.10+** on the server
- **Chrome or Firefox** on your worker PC
- **Domain/IP**: `mullion.indonesiacentral.cloudapp.azure.com` pointing to your VM

---

## 🔧 Server Setup (Azure VM)

### Step 1: Clone/Copy Files

```bash
# SSH into your VM
ssh your-user@mullion.indonesiacentral.cloudapp.azure.com

# Create directory
mkdir -p ~/shopping-assistant
cd ~/shopping-assistant

# Copy all files from web-interface/ folder to this directory
# (use scp, rsync, or git clone)
```

### Step 2: Install Python Dependencies

```bash
cd ~/shopping-assistant
pip install -r requirements.txt
```

### Step 3: Configure Environment

```bash
# Copy example config
cp .env.example .env

# Edit the config
nano .env
```

**Edit `.env` with your settings:**
```bash
# Leave blank if using Web Gemini API mode (recommended)
GEMINI_API_KEY=
SERPER_API_KEY=your_serper_key_or_leave_blank
HOST=0.0.0.0
PORT=5000
USE_SSL=false
```

> **Note**: With **Web Gemini API mode**, no API key is needed! The worker extension handles AI through gemini.google.com.

### Step 4: Open Firewall Port

```bash
# For UFW
sudo ufw allow 5000

# For Azure Network Security Group:
# Go to Azure Portal → VM → Networking → Add inbound rule for port 5000
```

### Step 5: Start the Server

```bash
# Option A: Run directly (stops when you disconnect)
python server_app.py

# Option B: Run in background with screen (recommended)
screen -S shopping-assistant
python server_app.py
# Press Ctrl+A then D to detach

# Option C: Run with nohup
nohup python server_app.py > server.log 2>&1 &
```

**You should see:**
```
============================================================
  Shopping Assistant Web Server
============================================================
  Azure DNS: mullion.indonesiacentral.cloudapp.azure.com
  Port:      5000
  SSL:       False
============================================================
[Server] Starting HTTP server on http://0.0.0.0:5000
```

---

## 💻 Worker Extension Setup (Your PC)

### Step 1: Load the Extension

**For Firefox:**
1. Open Firefox
2. Go to `about:debugging#/runtime/this-firefox`
3. Click **"Load Temporary Add-on..."**
4. Select the `manifest.json` file from the extension folder

**For Chrome:**
1. Open Chrome
2. Go to `chrome://extensions`
3. Enable **"Developer mode"** (top right)
4. Click **"Load unpacked"**
5. Select the extension folder

### Step 2: Configure Web Gemini API Mode

1. Open a Shopee page: `https://shopee.co.id`
2. Click the extension icon to open sidebar
3. Click the **⚙️ Settings** button
4. Configure these settings:

| Setting | Value |
|---------|-------|
| **API Mode** | `Web API` ✅ |
| **Gemini URL** | `https://gemini.google.com` |
| **Gemini Mode** | Choose: `Fast`, `Thinking`, or `Pro` |
| **Serper API Key** | Your Serper API key (optional) |

5. Click **Save Settings**

### Step 3: Login to Gemini Web

1. Open a new tab and go to `https://gemini.google.com`
2. **Sign in with your Google account**
3. Keep this tab open (the extension needs it for Web API mode)

### Step 4: Keep Browser Running

**Important**: The extension must stay running for the web interface to work.

- Keep Chrome/Firefox open
- Keep the Shopee tab open
- Keep the Gemini tab open (for Web API mode)

---

## 📱 Using the Web Interface

### From Any Device:

1. Open browser on your phone/tablet/other PC
2. Go to: `http://mullion.indonesiacentral.cloudapp.azure.com:5000`
3. You should see "Connected" status

### Connection Status Indicators:

| Status | Meaning |
|--------|---------|
| 🟢 **Server: Connected** | Web interface is connected to server |
| 🟢 **Extension: Connected** | Worker extension is online |
| 🔴 **Extension: Not Connected** | Worker extension is offline - check your PC |

### Try a Search:

Type: *"Find me wireless earbuds under 500k"*

The request will be routed to your worker extension, which will:
1. Search on Shopee
2. Scrape product listings
3. Get detailed info
4. Return AI recommendations

---

## 🔄 Automatic Reconnection

The system handles disconnections gracefully:

- **Server restart**: Extension will auto-reconnect
- **Browser restart**: Reload extension to reconnect
- **Network issues**: Auto-retry with exponential backoff

---

## 🛠️ Troubleshooting

### "Extension: Not Connected" on Web Interface

1. Check if browser is running on your worker PC
2. Check browser console for WebSocket errors:
   - Firefox: `Ctrl+Shift+J`
   - Chrome: `Ctrl+Shift+I` → Console
3. Look for: `[Remote] Connected` in the logs

### "Connection Error" on Web Interface

1. Check if server is running: `ps aux | grep server_app`
2. Check server logs
3. Verify firewall allows port 5000
4. Verify Azure NSG allows port 5000

### SSL Certificate Warnings

This is normal for self-signed certificates. Click "Advanced" → "Proceed" to accept.

For proper SSL, use Let's Encrypt:
```bash
sudo apt install certbot
sudo certbot certonly --standalone -d mullion.indonesiacentral.cloudapp.azure.com
```

---

## 📁 File Structure

```
web-interface/
├── server_app.py       # Flask + Socket.IO server
├── config.py           # Configuration
├── requirements.txt    # Python dependencies  
├── generate_ssl.sh     # SSL cert generator
├── .env.example        # Example environment config
├── .env                # Your actual config (create this)
├── certs/              # SSL certificates (generated)
│   ├── cert.pem
│   └── key.pem
└── static/
    ├── index.html      # Web UI
    ├── app.js          # Client JavaScript
    └── style.css       # Styles
```

---

## ⚡ Quick Checklist

### Server (Azure VM):
- [ ] `pip install -r requirements.txt`
- [ ] Create `.env` with API keys
- [ ] Run `./generate_ssl.sh`
- [ ] Allow port 5000 in firewall
- [ ] Run `python server_app.py`

### Worker PC:
- [ ] Load extension in Firefox/Chrome
- [ ] Reload extension after updating background.js
- [ ] Open Shopee tab
- [ ] Configure extension: API Mode = **Web API**
- [ ] Login to `gemini.google.com` in another tab
- [ ] Keep browser running

### Access:
- [ ] Open `http://mullion.indonesiacentral.cloudapp.azure.com:5000`
- [ ] Check "Extension: Connected" status
- [ ] Test a search query

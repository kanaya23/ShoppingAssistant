# Shopee Shopping Assistant - Firefox Extension

An AI-powered shopping assistant for Shopee Indonesia, featuring Gemini AI with agentic tool capabilities.

## Features

- 🛒 **AI Shopping Assistant**: Natural language interactions to find products
- 🔍 **Smart Search**: AI can search Shopee based on your requirements
- 📊 **Product Analysis**: Scrapes and compares listings automatically
- 💎 **Premium UI**: Dark glassmorphism design with smooth animations
- ⚡ **Streaming**: Real-time AI responses with typing indicators

## Installation

### Firefox Developer Edition / Nightly

1. Open Firefox and navigate to `about:debugging`
2. Click "This Firefox" in the left sidebar
3. Click "Load Temporary Add-on..."
4. Navigate to this folder and select `manifest.json`
5. The extension will be installed temporarily

### Firefox (Permanent Installation)

1. Package the extension: `zip -r shopee-assistant.xpi *`
2. Go to `about:addons` → Settings (gear icon) → "Install Add-on From File..."
3. Select the `.xpi` file

## Setup

1. After installation, click the extension icon or the floating button on Shopee
2. Click the settings (⚙️) icon in the sidebar header
3. Enter your Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey)
4. Click "Save API Key"

## Usage

Navigate to [shopee.co.id](https://shopee.co.id) and:

1. Click the floating button (bottom-left) to open the assistant
2. Ask questions like:
   - "Find me the best screwdriver set under 100k"
   - "Compare wireless earbuds with good reviews"
   - "What are the top-rated phone cases?"
3. The AI will search, scrape listings, and provide recommendations

## File Structure

```
ShoppingAssistant/
├── manifest.json        # Extension manifest
├── background.js        # Background service worker
├── content.js           # Content script for Shopee pages
├── content.css          # Floating button styles
├── lib/
│   ├── gemini.js        # Gemini API integration
│   └── tools.js         # Shopping tool implementations
├── sidebar/
│   ├── sidebar.html     # Sidebar UI structure
│   ├── sidebar.css      # Premium dark theme styles
│   └── sidebar.js       # Sidebar logic
└── icons/
    ├── icon-16.png
    ├── icon-32.png
    ├── icon-48.png
    └── icon-128.png
```

## Requirements

- Firefox 109+ (for Manifest V2 sidebar support)
- Gemini API key (free tier available)

## License

MIT License

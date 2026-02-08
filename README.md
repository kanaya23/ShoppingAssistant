# Shopee Shopping Assistant (AI Agent)

![Version](https://img.shields.io/badge/version-1.0.2-blue) ![Platform](https://img.shields.io/badge/platform-Firefox%20%2B%20Chromium-blue)

A powerful, AI-driven shopping assistant for Shopee Indonesia. This extension transforms your shopping experience by deploying an autonomous AI agent that can search, scrape, analyze, and validate product information using **Gemini AI** and **Serper (Google Search)**.

---

## ⚡ Key Features

### 🤖 Autonomous Agentic Workflow
Unlike simple chatbots, this assistant acts as an agent. It plans its own actions:
1.  **Refines Queries**: Converts vague requests into specific Shopee search terms.
2.  **Scrapes Listings**: Extracts product data from search results.
3.  **Deep Analysis**: Autonomously visits product pages to fetch **hidden details** like variation prices, full descriptions, and review statistics.
4.  **External Validation**: Uses Serper (Google Search) to cross-reference product reviews, specs, and price history from the wider web.

### 🧠 Smart & Deep Scraping
The custom "Deep Scraper V9" engine goes beyond basic page text:
-   **Variation Intelligence**: Automatically clicks through product variants (color/size) to extract real pricing (not just the range).
-   **Review Analysis**: Captures reviews from all star categories (1-5 stars) to detect hidden flaws.
-   **Skeptical Analysis**: The AI is instructed to be skeptical—it flags suspicious review patterns, generic descriptions, or "too good to be true" deals.

### 💬 Dual Chat Modes
Tailor the AI's behavior to your needs with a dedicated toggle:
-   **Normal Mode**: Conversational and helpful for general exploration and advice.
-   **Single Pick Mode**: Appends a rigorous selection instruction (`{Single_pick_mode}`) to ensure the AI narrows down to the **single best recommendation** with definitive reasoning.

### �️ Premium User Interface
-   **Dark Glassmorphism UI**: A modern, sleek sidebar that fits perfectly with dark themes.
-   **Fullscreen Mode**: Expand the chat to a full window for complex research sessions.
-   **Real-time Streaming**: Watch the AI "think" and execute tools in real-time.

---

## 📥 Installation

### Option A: Chromium (Developer Mode)
Use this for Chrome, Edge, Brave, or other Chromium-based browsers.
1.  Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
2.  Enable **Developer mode**.
3.  Click **"Load unpacked"** and select this folder.

### Option B: Firefox (Temporary)
Use this for testing or development.
1.  Open Firefox and go to `about:debugging`.
2.  Select **"This Firefox"** in the sidebar.
3.  Click **"Load Temporary Add-on..."**.
4.  Navigate to this folder and select `manifest.json`.

### Option C: Firefox (Permanent Installation)
1.  Zip the project files: `zip -r shopee-assistant.xpi *`
2.  Open Firefox and go to `about:addons`.
3.  Click the **Settings (gear icon)** ⚙️ → **"Install Add-on From File..."**.
4.  Select your generated `.xpi` file.

---

## ⚙️ Configuration

To unlock the full potential of the assistant, you need to configure your API keys in the settings menu:

1.  **Gemini API Key** (Required):
    -   Get it for free at [Google AI Studio](https://aistudio.google.com/apikey).
    -   Enables the core intelligence of the assistant.
2.  **Serper API Key** (Recommended):
    -   Get it at [Serper.dev](https://serper.dev/).
    -   Enables "Google Search" capabilities for external validation (reviews, specs, reddit discussions).

> **Note**: Without Serper, the assistant uses internal knowledge only and cannot browse the web outside of Shopee.

---

## 🚀 Usage Guide

1.  **Open the Assistant**: Click the floating button on any Shopee.co.id page or use the extension icon.
2.  **Set Your Mode**: Toggle "Single" mode if you want a decisive recommendation, or "Normal" for discussion.
3.  **Ask Anything**:
    -   *"Find me a mechanical keyboard under 500k with red switches."*
    -   *"Compare the Redmi Note 13 vs Infinix Note 40 from official stores."*
    -   *"Is this shop trustworthy? Analyze the 1-star reviews."*
4.  **Watch it Work**:
    -   The AI will navigate Shopee, scrape pages, and (if enabled) search Google.
    -   It will present a final report with clear pros/cons and a recommendation.

---

## 📂 Project Structure

```
ShoppingAssistant/
├── background.js           # Central orchestra (Service Worker)
├── content.js              # Shopee page interactor
├── lib/
│   ├── gemini.js           # Gemini API Client
│   ├── tools.js            # Tool Execution Logic (Search, Scrape, Serper)
│   ├── deep-scraper.js     # V9 Product Page Scraper
│   └── deep-scrape-manager.js # Tab management for scraping
├── sidebar/
│   ├── sidebar.js          # UI Logic & State Management
│   └── sidebar.css         # Glassmorphism Styling
└── manifest.json           # Extension Configuration
```

## 📄 License
MIT License

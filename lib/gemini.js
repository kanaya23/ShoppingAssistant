/**
 * Shopee Shopping Assistant - Gemini API Integration
 * Handles communication with Gemini AI API
 */

const GeminiAPI = {
    API_ENDPOINT: 'https://generativelanguage.googleapis.com/v1beta/models',

    // Available models
    MODELS: {
        'gemini-3-pro-preview': 'Gemini 3 Pro (Most Intelligent)',
        'gemini-3-flash-preview': 'Gemini 3 Flash (Balanced)',
        'gemini-2.5-flash': 'Gemini 2.5 Flash (Fast & Smart)',
        'gemini-2.5-flash-lite': 'Gemini 2.5 Flash-Lite (Ultra Fast)',
        'gemini-2.5-pro': 'Gemini 2.5 Pro (Advanced Thinking)',
        'gemini-2.0-flash': 'Gemini 2.0 Flash (Legacy)',
    },

    DEFAULT_MODEL: 'gemini-2.5-flash',

    // Get current model from storage
    async getModel() {
        const { geminiModel } = await browser.storage.local.get('geminiModel');
        return geminiModel || this.DEFAULT_MODEL;
    },

    // Set model in storage
    async setModel(model) {
        await browser.storage.local.set({ geminiModel: model });
    },

    // Tool definitions for shopping assistant
    tools: [
        {
            functionDeclarations: [
                {
                    name: 'search_shopee',
                    description: 'Search for products on Shopee Indonesia. Generate a SPECIFIC, POINTED query to find the best results.',
                    parameters: {
                        type: 'object',
                        properties: {
                            keyword: {
                                type: 'string',
                                description: 'The search keyword. Refine the user query to be more specific and pointed to get the best results (e.g. "obeng set" -> "obeng set lengkap bahan bagus").'
                            }
                        },
                        required: ['keyword']
                    }
                },
                {
                    name: 'scrape_listings',
                    description: 'Extract product listings from the current Shopee search results page. Returns BASIC INFO: name, price, rating, sold count, URL. Use this first to see what products are available, then use deep_scrape_urls on specific products you want to investigate further.',
                    parameters: {
                        type: 'object',
                        properties: {
                            max_items: {
                                type: 'integer',
                                description: 'Maximum number of products to extract (default: 20)'
                            }
                        }
                    }
                },
                {
                    name: 'deep_scrape_urls',
                    description: 'Deep scrape specific product URLs to get DETAILED INFO: variation prices, product description, rating statistics, and sample reviews from all star categories. Use this AFTER scrape_listings to investigate specific products that look promising or suspicious. Opens each product page and extracts comprehensive data.',
                    parameters: {
                        type: 'object',
                        properties: {
                            urls: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'Array of product URLs to deep scrape (e.g., ["https://shopee.co.id/Product-Name-i.123.456", "https://shopee.co.id/Another-Product-i.789.012"])'
                            }
                        },
                        required: ['urls']
                    }
                }
            ]
        }
    ],

    // System prompt for shopping assistant
    systemInstruction: `You are a **Smart Shopping Recommender** for Shopee Indonesia. You analyze products with healthy skepticism, but your PRIMARY GOAL is to **recommend the best products** for users to buy - not just warn them.

## Your Role: RECOMMENDER, Not Just Warner

You are skeptical to PROTECT the user, but skepticism should lead to **clear recommendations**, not just caution. Users want to know: "Which one should I BUY?"

## WORKFLOW:

1. **search_shopee** - Navigate to search results
2. **scrape_listings** - Get basic info for ALL products (up to 20)
3. **LIST ALL CANDIDATES** - Show user all product titles with basic info first
4. **deep_scrape_urls** - **CRITICAL: IMMEDIATELY** call this tool after listing the candidates. **DO NOT STOP** to ask for permission. You must get the details to provide the analysis.
5. **FINAL RECOMMENDATIONS** - Give clear, ranked buying advice

## FOUR RECOMMENDATION CATEGORIES:

After analysis, ALWAYS provide these 4 specific recommendations:

### 🏆 THE "BUDGET KING" (Best Entry-Level Value)
- Highest piece-count or spec at the LOWEST price
- Safety buffer: must have decent reviews (4.5+)
- For users who want: "Cheapest option that actually works"

### ⚙️ THE "PRO CHOICE" (Spec-Driven Quality)  
- Focus on TECHNICAL specs in description/reviews
- Ignore marketing fluff, look for: material quality, build, durability mentions
- For users who want: "Best actual quality regardless of price"

### 🛡️ THE "SAFEST BET" (Risk-Averse Pick)
- Lowest chance of headache: high seller rating, consistent reviews, known brand
- May not be best value, but RELIABLE
- For users who want: "I don't want to deal with returns or regrets"

### 💎 THE "BANG FOR BUCK" (Sweet Spot) - YOUR TOP PICK
- The "golden ratio" - where paying a bit more = huge jump in utility
- Best overall recommendation considering EVERYTHING
- For users who want: "Just tell me what to buy"

## RESPONSE FORMAT:

### Phase 1: All Candidates Overview
List ALL products from scrape_listings with: Name | Price | Rating | Sold
Mark which ones you'll deep scrape: ✓

**[CALL deep_scrape_urls HERE - DO NOT STOP]**

### Phase 2: Deep Analysis
For deep-scraped products, note:
- Real variation prices (expose bait pricing)
- Key specs from description
- Review highlights (what do buyers actually say?)
- Red flags (if any)

### Phase 3: FINAL RECOMMENDATIONS

**🏆 BUDGET KING: [Product Name] - Rp XX,XXX**
Why: [1-2 sentences]

**⚙️ PRO CHOICE: [Product Name] - Rp XX,XXX**  
Why: [1-2 sentences]

**🛡️ SAFEST BET: [Product Name] - Rp XX,XXX**
Why: [1-2 sentences]

**💎 BANG FOR BUCK (TOP PICK): [Product Name] - Rp XX,XXX**
Why: [1-2 sentences]

### ⚠️ PRODUCTS TO AVOID:
[List any with clear red flags - fake reviews, missing items, bait pricing, etc.]

## IMPORTANT RULES:
- **CRITICAL**: You MUST call 'deep_scrape_urls' in the same turn that you list the candidates. Do not stop generating text without calling the tool.
- ALWAYS give clear buying recommendations, not just "proceed with caution"
- One product CAN win multiple categories (e.g., Budget King AND Bang for Buck)
- Be skeptical to FIND good products, not to avoid recommending anything
- Deep scrape at least 5 products to make informed recommendations`,

    /**
     * Get API key from storage
     */
    async getApiKey() {
        const { geminiApiKey } = await browser.storage.local.get('geminiApiKey');
        return geminiApiKey;
    },

    /**
     * Save API key to storage
     */
    async setApiKey(apiKey) {
        await browser.storage.local.set({ geminiApiKey: apiKey });
    },

    /**
     * Send message to Gemini API with streaming
     */
    async sendMessage(messages, onChunk, onToolCall) {
        const apiKey = await this.getApiKey();
        if (!apiKey) {
            throw new Error('API key not configured. Please set your Gemini API key in settings.');
        }

        const model = await this.getModel();
        const url = `${this.API_ENDPOINT}/${model}:streamGenerateContent?key=${apiKey}&alt=sse`;

        const contents = messages.map(msg => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: msg.parts || [{ text: msg.content }]
        }));

        const body = {
            contents,
            tools: this.tools,
            systemInstruction: {
                parts: [{ text: this.systemInstruction }]
            },
            generationConfig: {
                temperature: 0.7,
                topP: 0.95,
                topK: 40,
                maxOutputTokens: 8192
            }
        };

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API Error: ${response.status} - ${errorText}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let fullResponse = { text: '', toolCalls: [] };

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));

                            if (data.candidates && data.candidates[0]) {
                                const candidate = data.candidates[0];

                                if (candidate.content && candidate.content.parts) {
                                    for (const part of candidate.content.parts) {
                                        if (part.text) {
                                            fullResponse.text += part.text;
                                            if (onChunk) onChunk(part.text);
                                        }
                                        if (part.functionCall) {
                                            fullResponse.toolCalls.push(part.functionCall);
                                            if (onToolCall) onToolCall(part.functionCall);
                                        }
                                    }
                                }
                            }
                        } catch (e) {
                            // Skip invalid JSON lines
                        }
                    }
                }
            }

            return fullResponse;
        } catch (error) {
            console.error('Gemini API Error:', error);
            throw error;
        }
    },

    /**
     * Continue conversation after tool execution
     */
    async continueWithToolResult(messages, toolName, toolResult, onChunk, onToolCall) {
        const updatedMessages = [
            ...messages,
            {
                role: 'model',
                parts: [{ functionCall: { name: toolName, args: {} } }]
            },
            {
                role: 'user',
                parts: [{
                    functionResponse: {
                        name: toolName,
                        response: toolResult
                    }
                }]
            }
        ];

        return this.sendMessage(updatedMessages, onChunk, onToolCall);
    }
};

// Export for use in background script
if (typeof window !== 'undefined') {
    window.GeminiAPI = GeminiAPI;
}

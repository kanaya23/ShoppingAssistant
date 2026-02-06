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
                },
                {
                    name: 'serper_search',
                    description: 'Perform a Google search using Serper API. You can perform multiple searches at once by separating queries with ";". Example: "iphone 15 review; samsung s24 review". Use this to find external reviews, reddit discussions, official specs, or general information. CRITICAL: Use this after scraping listings to get a broader perspective.',
                    parameters: {
                        type: 'object',
                        properties: {
                            query: {
                                type: 'string',
                                description: 'The search query (or multiple queries separated by ";"). E.g. "rtx 4060 vs 3060; best gaming laptop 2024"'
                            }
                        },
                        required: ['query']
                    }
                }
            ]
        }
    ],

    // System prompt for shopping assistant
    systemInstruction: typeof Instructions !== 'undefined' ? Instructions.NATIVE_SYSTEM_PROMPT : `You are a helper... (Instructions not loaded)`,



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

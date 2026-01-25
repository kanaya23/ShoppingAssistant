/**
 * Shopee Shopping Assistant - Gemini API Integration
 * Handles communication with Gemini AI API
 */

const GeminiAPI = {
    API_ENDPOINT: 'https://generativelanguage.googleapis.com/v1beta/models',
    MODEL: 'gemini-3-flash-preview',

    // Tool definitions for shopping assistant
    tools: [
        {
            functionDeclarations: [
                {
                    name: 'search_shopee',
                    description: 'Search for products on Shopee Indonesia. Use this to find products based on keywords.',
                    parameters: {
                        type: 'object',
                        properties: {
                            keyword: {
                                type: 'string',
                                description: 'The search keyword to find products (e.g., "screwdriver set", "wireless mouse")'
                            }
                        },
                        required: ['keyword']
                    }
                },
                {
                    name: 'scrape_listings',
                    description: 'Extract product listings from the current Shopee search results page. Returns a list of products with names, prices, ratings, and URLs.',
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
                    name: 'visit_product',
                    description: 'Navigate to a specific product page to get more details. Use this after scraping listings to examine individual products.',
                    parameters: {
                        type: 'object',
                        properties: {
                            url: {
                                type: 'string',
                                description: 'The full URL of the product page to visit'
                            }
                        },
                        required: ['url']
                    }
                },
                {
                    name: 'get_product_details',
                    description: 'Extract detailed information from the current product page including price, rating, reviews, description, specifications, and seller info.',
                    parameters: {
                        type: 'object',
                        properties: {}
                    }
                },
                {
                    name: 'get_current_page',
                    description: 'Get information about the current page (URL, type, title).',
                    parameters: {
                        type: 'object',
                        properties: {}
                    }
                }
            ]
        }
    ],

    // System prompt for shopping assistant
    systemInstruction: `You are an intelligent shopping assistant for Shopee Indonesia. Your goal is to help users find the best products based on their needs and budget.

## Your Capabilities:
- Search for products on Shopee using keywords
- Scrape and analyze product listings from search results
- Visit individual product pages for detailed information
- Compare products and make recommendations

## How to Help Users:
1. When a user asks for a product, use search_shopee to find relevant items
2. Use scrape_listings to get product data from the search results
3. Analyze the products based on price, rating, reviews, and sold count
4. If needed, use visit_product to get more details on promising items
5. Provide clear recommendations with reasoning

## Response Guidelines:
- Be concise but informative
- Format prices in Indonesian Rupiah (Rp)
- Highlight the best value options
- Consider ratings, number of reviews, and sold count as quality indicators
- Mention seller reputation when relevant
- Use markdown formatting for readability

## Important Notes:
- Wait for tool results before making recommendations
- If a page hasn't loaded yet, inform the user
- Be honest about limitations
- Always prioritize user's budget constraints`,

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

        const url = `${this.API_ENDPOINT}/${this.MODEL}:streamGenerateContent?key=${apiKey}&alt=sse`;

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

/**
 * Shopee Shopping Assistant - Tool Executor
 * Handles execution of AI tool calls
 * 
 * Tools:
 * 1. search_shopee - Navigate to search results
 * 2. scrape_listings - Scrape main search page (basic info only)
 * 3. deep_scrape_urls - Deep scrape specific product URLs (AI picks which ones)
 * 4. serper_search - General web search using Serper API
 */

const ToolExecutor = {
    /**
     * Execute a tool call and return the result
     * This is the main entry point called by the AI
     * @param {Function} onProgress - Optional callback(current, total)
     */
    async execute(toolName, args, tabId, onProgress) {
        console.log(`[Tools] Executing tool: ${toolName}`, args);

        switch (toolName) {
            case 'search_shopee':
                return await this.searchShopee(args.keyword, tabId);

            case 'scrape_listings':
                return await this.scrapeListings(args.max_items || 1000, tabId);

            case 'deep_scrape_urls':
                return await this.deepScrapeUrls(args.urls || [], onProgress);

            case 'serper_search':
                return await this.serperSearch(args.query);

            default:
                return { error: `Unknown tool: ${toolName}` };
        }
    },

    /**
     * Search for products on Shopee
     * Navigates the browser to search results page
     * Waits for page to FULLY LOAD before returning
     */
    async searchShopee(keyword, tabId) {
        try {
            // Wait for content script to be ready
            await this.waitForContentScript(tabId, 3000);

            // Send search command to content script
            const response = await browser.tabs.sendMessage(tabId, {
                action: 'searchShopee',
                keyword: keyword
            });

            if (response.success) {
                // Wait for navigation to complete
                await this.waitForNavigation(tabId, 15000);

                // Wait for content script on new page
                await this.waitForContentScript(tabId, 5000);

                // Wait for products to actually load on the page
                await this.waitForProductsToLoad(tabId, 10000);

                return {
                    success: true,
                    message: `Navigated to search results for "${keyword}". Page fully loaded and ready to scrape.`,
                    keyword: keyword
                };
            }

            return { error: 'Failed to navigate to search' };
        } catch (error) {
            return { error: error.message };
        }
    },

    /**
     * Scrape product listings from current search page
     * Returns BASIC INFO ONLY: name, price, rating, sold, url, image
     * 
     * AI should review this list and then call deep_scrape_urls
     * on the specific products it wants more details on.
     */
    async scrapeListings(maxItems, tabId) {
        try {
            await this.waitForContentScript(tabId, 3000);

            console.log('[Tools] Scraping main search page listings...');
            const response = await browser.tabs.sendMessage(tabId, {
                action: 'scrapeListings',
                maxItems: maxItems
            });

            if (!response.success || !response.data || response.data.length === 0) {
                return { error: 'No products found on page' };
            }

            const products = response.data;
            console.log(`[Tools] Found ${products.length} products on main page`);

            // Format as labeled text for AI
            let report = `=== SEARCH RESULTS ===\n`;
            report += `Total Products Found: ${products.length}\n\n`;

            for (const product of products) {
                report += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
                report += `#${product.index} ${product.name}\n`;
                report += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
                report += `Price: ${product.price || 'N/A'}\n`;
                report += `Rating: ${product.rating || 'N/A'}⭐\n`;
                report += `Sold: ${product.sold || 'N/A'}\n`;
                report += `URL: ${product.url}\n\n`;
            }

            report += `\n⚠️ SYSTEM INSTRUCTION: You represent a Smart Shopping Assistant. You MUST now IMMEDIATELY call 'serper_search' on the top 3-5 candidates to validate them (check Reddit/Reviews). Do NOT list candidates yet. Do NOT stop. CALL 'serper_search' NOW.`;

            return {
                success: true,
                count: products.length,
                data: report,
                // Also return structured data for AI to pick URLs from
                products: products
            };
        } catch (error) {
            console.error('[Tools] Scrape error:', error);
            return { error: error.message };
        }
    },

    /**
     * Deep scrape specific product URLs
     * AI calls this with URLs it wants detailed info on
     * 
     * Opens each URL in an ACTIVE tab and runs the full Tampermonkey V9 scraper
     * Returns: variation prices, description, rating stats, sample reviews
     * 
     * @param {Array<string>} urls - Array of product URLs to deep scrape
     * @param {Function} onProgress - Optional callback(current, total)
     */
    async deepScrapeUrls(urls, onProgress) {
        if (!urls || urls.length === 0) {
            return { error: 'No URLs provided. Please provide an array of product URLs to deep scrape.' };
        }

        console.log(`[Tools] Deep scraping ${urls.length} URLs...`);

        try {
            const results = await DeepScrapeManager.scrapeUrls(urls, onProgress);

            // Format results as labeled text
            let report = `=== DEEP SCRAPE RESULTS ===\n`;
            report += `URLs Processed: ${results.length}\n`;
            report += `Successful: ${results.filter(r => r.success).length}\n\n`;

            for (let i = 0; i < results.length; i++) {
                const result = results[i];
                report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
                report += `PRODUCT ${i + 1}/${results.length}\n`;
                report += `URL: ${result.url}\n`;
                report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

                if (result.success) {
                    report += result.data + '\n';
                } else {
                    report += `⚠️ SCRAPE FAILED: ${result.error}\n`;
                }
                report += '\n';
            }

            return {
                success: true,
                count: results.length,
                successful: results.filter(r => r.success).length,
                data: report
            };
        } catch (error) {
            console.error('[Tools] Deep scrape error:', error);
            return { error: error.message };
        }
    },

    /**
     * General web search using Serper API
     * Use this to find information outside of Shopee
     */
    async serperSearch(query) {
        try {
            const { serperApiKey } = await browser.storage.local.get('serperApiKey');

            if (!serperApiKey) {
                return { error: 'Serper API Key is missing. Please add it in the extension settings.' };
            }

            // Split queries by semicolon and filter empty ones
            const queries = query.split(';').map(q => q.trim()).filter(q => q.length > 0);

            if (queries.length === 0) {
                return { error: 'No valid queries found.' };
            }

            console.log(`[Tools] Serper parallel search for ${queries.length} queries:`, queries);

            const myHeaders = new Headers();
            myHeaders.append("X-API-KEY", serperApiKey);
            myHeaders.append("Content-Type", "application/json");

            // Execute parallel requests
            const promises = queries.map(async (q) => {
                const raw = JSON.stringify({ "q": q });
                const requestOptions = {
                    method: "POST",
                    headers: myHeaders,
                    body: raw,
                    redirect: "follow"
                };

                try {
                    const response = await fetch("https://google.serper.dev/search", requestOptions);
                    const result = await response.json();
                    return { query: q, result, success: true };
                } catch (error) {
                    return { query: q, error: error.message, success: false };
                }
            });

            const results = await Promise.all(promises);

            // Format results for AI
            let report = `=== SERPER SEARCH RESULTS ===\n`;

            for (const item of results) {
                report += `\n🔎 Query: "${item.query}"\n`;
                report += `─────────────────────────────\n`;

                if (!item.success) {
                    report += `Error: ${item.error}\n`;
                    continue;
                }

                const result = item.result;

                let hasResults = false;

                // Organic Results
                if (result.organic && result.organic.length > 0) {
                    hasResults = true;
                    // Limit to top 4 results per query to keep it concise but useful
                    result.organic.slice(0, 4).forEach((org, index) => {
                        report += `${index + 1}. ${org.title}\n`;
                        report += `   URL: ${org.link}\n`;
                        report += `   Snippet: ${org.snippet}\n\n`;
                    });
                }

                // Knowledge Graph (if any)
                if (result.knowledgeGraph) {
                    hasResults = true;
                    report += `[Knowledge Graph]\n`;
                    report += `Title: ${result.knowledgeGraph.title}\n`;
                    report += `Type: ${result.knowledgeGraph.type}\n`;
                    if (result.knowledgeGraph.description) {
                        report += `Description: ${result.knowledgeGraph.description}\n`;
                    }
                    if (result.knowledgeGraph.attributes) {
                        for (const [key, value] of Object.entries(result.knowledgeGraph.attributes)) {
                            report += `${key}: ${value}\n`;
                        }
                    }
                    report += `\n`;
                }

                if (!hasResults) {
                    report += "No relevant results found.\n";
                }
            }

            report += `\n💡 Analysis Tip: Cross-reference findings across these search results to verify product consistency.`;

            return {
                success: true,
                data: report,
                queryCount: queries.length,
                raw: results // Return raw data if needed for debugging
            };

        } catch (error) {
            console.error('[Tools] Serper search error:', error);
            return { error: error.message };
        }
    },

    // ============ HELPER FUNCTIONS ============

    /**
     * Simple delay helper
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },

    /**
     * Wait for page navigation to complete
     */
    async waitForNavigation(tabId, timeout = 15000) {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                browser.tabs.onUpdated.removeListener(listener);
                reject(new Error('Navigation timeout'));
            }, timeout);

            const listener = (updatedTabId, changeInfo, tab) => {
                if (updatedTabId === tabId && changeInfo.status === 'complete') {
                    clearTimeout(timeoutId);
                    browser.tabs.onUpdated.removeListener(listener);
                    setTimeout(resolve, 500); // Small delay for page to settle
                }
            };

            browser.tabs.onUpdated.addListener(listener);
        });
    },

    /**
     * Wait for content script to be ready
     */
    async waitForContentScript(tabId, timeout = 5000) {
        const startTime = Date.now();

        while (Date.now() - startTime < timeout) {
            try {
                const response = await browser.tabs.sendMessage(tabId, { action: 'ping' });
                if (response && response.success) {
                    return true;
                }
            } catch (e) {
                // Content script not ready yet
            }
            await this.delay(200);
        }

        throw new Error('Content script not responding');
    },

    /**
     * Wait for products to actually load on the search results page
     * Polls the content script to check if product cards are visible
     */
    async waitForProductsToLoad(tabId, timeout = 10000) {
        const startTime = Date.now();

        while (Date.now() - startTime < timeout) {
            try {
                // Ask content script to check if products exist
                const response = await browser.tabs.sendMessage(tabId, { action: 'checkProductsLoaded' });
                if (response && response.loaded && response.count > 0) {
                    console.log(`[Tools] Products loaded: ${response.count} items found`);
                    return true;
                }
            } catch (e) {
                // Not ready yet
            }
            await this.delay(500);
        }

        // Don't throw error - just warn and continue (products may still load)
        console.warn('[Tools] Timeout waiting for products to load, proceeding anyway');
        return false;
    }
};

// Export for use in background script
if (typeof window !== 'undefined') {
    window.ToolExecutor = ToolExecutor;
}

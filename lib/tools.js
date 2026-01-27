/**
 * Shopee Shopping Assistant - Tool Executor
 * Handles execution of AI tool calls
 * 
 * Tools:
 * 1. search_shopee - Navigate to search results
 * 2. scrape_listings - Scrape main search page (basic info only)
 * 3. deep_scrape_urls - Deep scrape specific product URLs (AI picks which ones)
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
                return await this.scrapeListings(args.max_items || 20, tabId);

            case 'deep_scrape_urls':
                return await this.deepScrapeUrls(args.urls || [], onProgress);

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

            report += `\n💡 To get detailed product info (variations, description, reviews), use the deep_scrape_urls tool with the URLs you want to investigate.`;

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

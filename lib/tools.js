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
            // Helper to scrape current page
            const scrapeCurrentPage = async (pageLabel) => {
                await this.waitForContentScript(tabId, 3000); // 3s timeout for check

                // Ensure products are loaded before scraping
                await this.waitForProductsToLoad(tabId, 10000);

                console.log(`[Tools] Scraping ${pageLabel} listings...`);
                // We just ask for "all" on page basically, maxItems isn't strictly used by the NEW page logic usually, 
                // but we pass it anyway. The user wants ~120 total, so ~60 per page is typical for Shopee.
                const response = await browser.tabs.sendMessage(tabId, {
                    action: 'scrapeListings',
                    maxItems: maxItems
                });

                if (!response.success || !response.data) {
                    return [];
                }
                return response.data;
            };

            // 1. Get current URL to determine base query
            const currentTab = await browser.tabs.get(tabId);
            let currentUrl = new URL(currentTab.url);

            // If we are not on a search page, we might fail or weird things happen, 
            // but we assume search_shopee was called first.

            // 2. Prepare Page 1 (page=0)
            currentUrl.searchParams.set('page', '0');
            const page0Url = currentUrl.toString();

            console.log(`[Tools] Navigating to Page 1: ${page0Url}`);
            // Start listening BEFORE update to catch early events
            const nav1Promise = this.waitForNavigation(tabId, 15000).catch(e => console.warn('Page 1 nav warning:', e.message));
            await browser.tabs.update(tabId, { url: page0Url });
            await nav1Promise;
            await this.delay(1000); // Safety buffer

            const productsPage0 = await scrapeCurrentPage('Page 1');
            console.log(`[Tools] Page 1 scraped: ${productsPage0.length} items`);


            // 3. Prepare Page 2 (page=1)
            currentUrl.searchParams.set('page', '1');
            const page1Url = currentUrl.toString();

            console.log(`[Tools] Navigating to Page 2: ${page1Url}`);
            const nav2Promise = this.waitForNavigation(tabId, 15000);
            await browser.tabs.update(tabId, { url: page1Url });
            await nav2Promise;
            await this.delay(2000); // Extra safety buffer for Page 2

            const productsPage1 = await scrapeCurrentPage('Page 2');
            console.log(`[Tools] Page 2 scraped: ${productsPage1.length} items`);


            // 4. Combine Results strictly for the "List" array (for internal use)
            // But format the text report separately as requested.

            // Re-indexing Page 2 to follow Page 1? 
            // The user didn't explicitly ask to re-index, simpler to keep original indices or just list them.
            // Usually internal indices reset per scrape unless managed.
            // Let's just list them.

            let report = `=== SEARCH RESULTS ===\n`;
            // --- Page 1 Report ---
            report += `Page 1 Result =:\n`;
            if (productsPage0.length === 0) {
                report += `(No products found on Page 1)\n`;
            } else {
                for (const product of productsPage0) {
                    report += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
                    report += `#${product.index} ${product.name}\n`;
                    report += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
                    report += `Price: ${product.price || 'N/A'}\n`;
                    report += `Rating: ${product.rating || 'N/A'}⭐\n`;
                    report += `Sold: ${product.sold || 'N/A'}\n`;
                    report += `URL: ${product.url}\n\n`;
                }
            }

            // --- Page 2 Report ---
            report += `Page 2 Result =:\n`;
            if (productsPage1.length === 0) {
                report += `(No products found on Page 2)\n`;
            } else {
                for (const product of productsPage1) {
                    // We might want to adjust index for display, e.g. #61, #62...
                    // But product.index comes from the page scraper (usually 1-60).
                    // I'll keep it as scraped to be safe, or just add offset. 
                    // Let's just use the scraped index to avoid breaking "deep scrape" references if they rely on index.
                    // Actually deep_scrape uses URL, so index is just visual.
                    report += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
                    report += `#P2-${product.index} ${product.name}\n`; // Distinct marker
                    report += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
                    report += `Price: ${product.price || 'N/A'}\n`;
                    report += `Rating: ${product.rating || 'N/A'}⭐\n`;
                    report += `Sold: ${product.sold || 'N/A'}\n`;
                    report += `URL: ${product.url}\n\n`;
                }
            }

            report += typeof Instructions !== 'undefined' ? Instructions.SCRAPE_LISTINGS_NEXT_STEP : `\n⚠️ SYSTEM INSTRUCTION... (Instructions not loaded)`;

            // Combine arrays for the return object
            const allProducts = [...productsPage0, ...productsPage1];

            return {
                success: true,
                count: allProducts.length,
                data: report,
                products: allProducts
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

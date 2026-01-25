/**
 * Shopee Shopping Assistant - Tool Executor
 * Handles execution of AI tool calls
 */

const ToolExecutor = {
    /**
     * Execute a tool call and return the result
     */
    async execute(toolName, args, tabId) {
        console.log(`Executing tool: ${toolName}`, args);

        switch (toolName) {
            case 'search_shopee':
                return await this.searchShopee(args.keyword, tabId);

            case 'scrape_listings':
                return await this.scrapeListings(args.max_items || 20, tabId);

            case 'visit_product':
                return await this.visitProduct(args.url, tabId);

            case 'get_product_details':
                return await this.getProductDetails(tabId);

            case 'get_current_page':
                return await this.getCurrentPage(tabId);

            default:
                return { error: `Unknown tool: ${toolName}` };
        }
    },

    /**
     * Search for products on Shopee
     */
    async searchShopee(keyword, tabId) {
        try {
            // Send message to content script to navigate
            await browser.tabs.sendMessage(tabId, {
                action: 'searchShopee',
                keyword: keyword
            });

            // Wait for navigation to complete
            await this.waitForNavigation(tabId, 15000);

            // Wait for content script to be ready after navigation
            await this.waitForContentScript(tabId, 5000);

            // Now wait for actual product content to load using MutationObserver
            const contentResult = await this.waitForContentLoad(tabId, 'search', 20000);

            return {
                success: true,
                message: contentResult.found
                    ? `Search results loaded: ${contentResult.count} products found in ${contentResult.waited}ms. You can now scrape the listings.`
                    : `Navigation complete but products may still be loading. Try scraping in a moment.`,
                url: `https://shopee.co.id/search?keyword=${encodeURIComponent(keyword)}`,
                readyToScrape: contentResult.found,
                productsFound: contentResult.count || 0
            };
        } catch (error) {
            return { error: error.message };
        }
    },

    /**
     * Scrape product listings from current page
     */
    async scrapeListings(maxItems, tabId) {
        try {
            // Make sure content script is ready
            await this.waitForContentScript(tabId, 3000);

            const response = await browser.tabs.sendMessage(tabId, {
                action: 'scrapeListings',
                maxItems: maxItems
            });

            if (response.success && response.data && response.data.length > 0) {
                const products = response.data;
                return {
                    success: true,
                    count: products.length,
                    products: products.map(p => ({
                        name: p.name,
                        price: p.price,
                        rating: p.rating,
                        sold: p.sold,
                        location: p.location,
                        url: p.url
                    }))
                };
            }

            return {
                error: 'No products found on this page.',
                hint: 'The page might still be loading. Wait a moment and try again, or verify you are on a search results page.'
            };
        } catch (error) {
            return { error: `Failed to scrape listings: ${error.message}` };
        }
    },

    /**
     * Visit a specific product page
     */
    async visitProduct(url, tabId) {
        try {
            await browser.tabs.sendMessage(tabId, {
                action: 'visitProduct',
                url: url
            });

            // Wait for navigation to complete
            await this.waitForNavigation(tabId, 15000);

            // Wait for content script
            await this.waitForContentScript(tabId, 5000);

            // Wait for product content to load
            const contentResult = await this.waitForContentLoad(tabId, 'product', 15000);

            return {
                success: true,
                message: contentResult.found
                    ? `Product page loaded in ${contentResult.waited}ms. You can now get product details.`
                    : `Navigation complete. Product details should be available now.`,
                url: url,
                readyToScrape: contentResult.found
            };
        } catch (error) {
            return { error: error.message };
        }
    },

    /**
     * Get detailed product information from current page
     */
    async getProductDetails(tabId) {
        try {
            await this.waitForContentScript(tabId, 3000);

            const response = await browser.tabs.sendMessage(tabId, {
                action: 'scrapeProductDetails'
            });

            if (response.success && response.data) {
                return {
                    success: true,
                    product: response.data
                };
            }

            return { error: 'Could not extract product details.' };
        } catch (error) {
            return { error: `Failed to get product details: ${error.message}` };
        }
    },

    /**
     * Get current page information
     */
    async getCurrentPage(tabId) {
        try {
            const response = await browser.tabs.sendMessage(tabId, {
                action: 'getPageInfo'
            });

            if (response.success) {
                return response.data;
            }

            return { error: 'Could not get page info' };
        } catch (error) {
            return { error: error.message };
        }
    },

    /**
     * Simple delay helper
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },

    /**
     * Wait for page navigation to complete
     */
    waitForNavigation(tabId, timeout = 15000) {
        return new Promise((resolve) => {
            let resolved = false;
            let loadingStarted = false;

            const listener = (updatedTabId, changeInfo, tab) => {
                if (updatedTabId !== tabId) return;

                if (changeInfo.status === 'loading') {
                    loadingStarted = true;
                }

                if (changeInfo.status === 'complete' && loadingStarted) {
                    if (!resolved) {
                        resolved = true;
                        browser.tabs.onUpdated.removeListener(listener);
                        console.log('Navigation complete for tab:', tabId);
                        resolve();
                    }
                }
            };

            browser.tabs.onUpdated.addListener(listener);

            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    browser.tabs.onUpdated.removeListener(listener);
                    console.log('Navigation timeout for tab:', tabId);
                    resolve();
                }
            }, timeout);
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
                    console.log('Content script is ready');
                    return true;
                }
            } catch (e) {
                // Content script not ready yet
            }
            await this.delay(300);
        }

        console.log('Timeout waiting for content script');
        return false;
    },

    /**
     * Wait for actual content (products) to load using the content script's watcher
     */
    async waitForContentLoad(tabId, pageType, timeout = 20000) {
        try {
            const response = await browser.tabs.sendMessage(tabId, {
                action: 'waitForContent',
                pageType: pageType,
                timeout: timeout
            });

            console.log('Content load result:', response);
            return response;
        } catch (error) {
            console.error('Error waiting for content:', error);
            return { found: false, error: error.message };
        }
    }
};

// Export for use in background script
if (typeof window !== 'undefined') {
    window.ToolExecutor = ToolExecutor;
}

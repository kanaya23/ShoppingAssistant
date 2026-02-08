/**
 * Shopee Deep Scrape Manager
 * Handles sequential background tab scraping
 * 
 * Opens tabs ONE AT A TIME as ACTIVE (selected) tabs
 * so the scraper can properly interact with the page.
 * 
 * This is called by the AI via the deep_scrape_urls tool
 * when it wants to get detailed info on specific products.
 */

const DeepScrapeManager = {

    /**
     * Deep scrape multiple product URLs sequentially
     * @param {Array<string>} urls - Array of product URLs to scrape
     * @param {Function} onProgress - Callback(current, total) for progress updates
     * @returns {Promise<Array>} Array of scrape results (text reports)
     */
    async scrapeUrls(urls, onProgress) {
        console.log(`[DeepScrape] Starting deep scrape of ${urls.length} URLs (sequential, active tabs)`);

        const results = [];

        // Send initial progress (no URL yet)
        if (onProgress) onProgress(0, urls.length, null);

        for (let i = 0; i < urls.length; i++) {
            const url = urls[i];
            console.log(`[DeepScrape] Processing URL ${i + 1}/${urls.length}: ${url.substring(0, 60)}...`);

            // Report progress with current URL BEFORE scraping
            if (onProgress) onProgress(i + 1, urls.length, url);

            try {
                const report = await this.scrapeOneUrl(url, i);
                results.push({
                    url: url,
                    success: true,
                    data: report
                });
            } catch (error) {
                console.error(`[DeepScrape] Failed URL ${i}:`, error.message);
                results.push({
                    url: url,
                    success: false,
                    error: error.message
                });
            }
        }

        console.log(`[DeepScrape] All URLs processed. Success: ${results.filter(r => r.success).length}/${urls.length}`);
        return results;
    },

    /**
     * Scrape a single product URL in an ACTIVE tab
     * Opens tab -> waits for load -> waits for script ready -> triggers scrape -> closes tab
     */
    async scrapeOneUrl(url, index) {
        let tabId = null;

        try {
            // Step 1: Open the product page in an ACTIVE tab (visible)
            console.log(`[DeepScrape] Opening ACTIVE tab for URL ${index}...`);
            const tab = await browser.tabs.create({
                url: url,
                active: true  // ACTIVE TAB - user can see it, scraper can interact
            });
            tabId = tab.id;
            console.log(`[DeepScrape] Tab ${tabId} opened (active)`);

            // Step 2: Wait for the page to fully load
            await this.waitForTabLoad(tabId, 30000);
            console.log(`[DeepScrape] Tab ${tabId} loaded`);

            // Step 3: Wait for deep-scraper.js to be ready
            await this.waitForDeepScraperReady(tabId, 20000);
            console.log(`[DeepScrape] Deep scraper ready on tab ${tabId}`);

            // Step 4: Trigger the deep scrape and wait for result
            console.log(`[DeepScrape] Triggering scrape on tab ${tabId}...`);
            const response = await browser.tabs.sendMessage(tabId, {
                action: 'triggerDeepScrape'
            });

            if (response && response.success) {
                console.log(`[DeepScrape] URL ${index} scraped successfully (${response.data?.length || 0} chars)`);
                return response.data;
            } else {
                throw new Error(response?.error || 'Scrape returned no data');
            }

        } finally {
            // Step 5: Always close the tab
            if (tabId) {
                try {
                    await browser.tabs.remove(tabId);
                    console.log(`[DeepScrape] Tab ${tabId} closed`);
                } catch (e) {
                    // Tab might already be closed
                }
            }
        }
    },

    /**
     * Wait for tab to complete loading
     */
    waitForTabLoad(tabId, timeout = 30000) {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                browser.tabs.onUpdated.removeListener(listener);
                browser.tabs.onRemoved.removeListener(removeListener);
                reject(new Error('Tab load timeout'));
            }, timeout);

            // Check if already complete
            browser.tabs.get(tabId).then(tab => {
                if (tab.status === 'complete') {
                    clearTimeout(timeoutId);
                    browser.tabs.onUpdated.removeListener(listener);
                    browser.tabs.onRemoved.removeListener(removeListener);
                    resolve();
                }
            }).catch(() => { });

            const listener = (updatedTabId, changeInfo) => {
                if (updatedTabId === tabId && changeInfo.status === 'complete') {
                    clearTimeout(timeoutId);
                    browser.tabs.onUpdated.removeListener(listener);
                    browser.tabs.onRemoved.removeListener(removeListener);
                    resolve();
                }
            };
            browser.tabs.onUpdated.addListener(listener);

            const removeListener = (removedTabId) => {
                if (removedTabId === tabId) {
                    clearTimeout(timeoutId);
                    browser.tabs.onUpdated.removeListener(listener);
                    browser.tabs.onRemoved.removeListener(removeListener);
                    reject(new Error('Tab closed unexpectedly'));
                }
            };
            browser.tabs.onRemoved.addListener(removeListener);
        });
    },

    /**
     * Wait for deep-scraper.js to signal it's ready
     * Polls with deepScraperPing until ready: true
     */
    async waitForDeepScraperReady(tabId, timeout = 20000) {
        const startTime = Date.now();
        const pollInterval = 500;

        while (Date.now() - startTime < timeout) {
            try {
                const response = await browser.tabs.sendMessage(tabId, { action: 'deepScraperPing' });
                if (response && response.ready === true) {
                    return true;
                }
                console.log(`[DeepScrape] Tab ${tabId} not ready yet, polling...`);
            } catch (e) {
                // Script might not be loaded yet, keep trying
                console.log(`[DeepScrape] Tab ${tabId} ping failed (script loading?)`);
            }
            await new Promise(r => setTimeout(r, pollInterval));
        }

        throw new Error(`Deep scraper not ready after ${timeout}ms`);
    }
};

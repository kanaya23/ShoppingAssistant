/**
 * Shopee Shopping Assistant - Content Script
 * Injects floating action button and handles DOM scraping
 * 
 * MAIN PAGE SCRAPER - Extracts listings from search results
 * Accurate extraction of: Title, Price, Rating, Sold count
 */

(function () {
    'use strict';

    // Prevent multiple injections
    if (window.__shopeeAssistantInjected) return;
    window.__shopeeAssistantInjected = true;

    // ============ FLOATING ACTION BUTTON ============

    function createFAB() {
        const existingFab = document.getElementById('shopee-assistant-fab');
        if (existingFab) existingFab.remove();
        const existingTooltip = document.querySelector('.shopee-assistant-fab-tooltip');
        if (existingTooltip) existingTooltip.remove();

        const fab = document.createElement('button');
        fab.className = 'shopee-assistant-fab';
        fab.id = 'shopee-assistant-fab';
        fab.innerHTML = `
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/>
        <path d="M12 15l1.57-3.43L17 10l-3.43-1.57L12 5l-1.57 3.43L7 10l3.43 1.57z"/>
      </svg>
    `;

        const tooltip = document.createElement('div');
        tooltip.className = 'shopee-assistant-fab-tooltip';
        tooltip.innerHTML = 'Open Shopping Assistant';

        document.body.appendChild(fab);
        document.body.appendChild(tooltip);

        fab.addEventListener('click', () => {
            browser.runtime.sendMessage({ action: 'openSidebarWindow' });
        });

        return fab;
    }

    // ============ NAVIGATION HELPERS ============

    function searchShopee(keyword) {
        const encodedKeyword = encodeURIComponent(keyword);
        const url = `https://shopee.co.id/search?keyword=${encodedKeyword}`;
        window.location.href = url;
        return { success: true, url };
    }

    function getCurrentPageInfo() {
        const url = window.location.href;
        let pageType = 'unknown';
        if (url.includes('/search')) pageType = 'search';
        else if (url.includes('/product/') || url.match(/-i\./)) pageType = 'product';
        else pageType = 'home';

        return { url, pageType, title: document.title };
    }

    // ============ MAIN PAGE SCRAPER (Search Results) ============

    /**
     * Extract price from a product card element
     * Looks for "Rp" text and extracts the number
     */
    function extractPrice(element) {
        // Look for the price container with "Rp" followed by number
        const allText = element.innerText;

        // Find Rp followed by price pattern (e.g., "Rp59.000" or "Rp 59.000")
        const priceMatch = allText.match(/Rp\s*([\d.,]+)/);
        if (priceMatch) {
            // Clean and parse: "59.000" -> 59000
            const cleaned = priceMatch[1].replace(/\./g, '').replace(/,/g, '');
            const price = parseInt(cleaned, 10);
            if (!isNaN(price) && price > 0) {
                return `Rp${priceMatch[1]}`; // Return formatted string like "Rp59.000"
            }
        }
        return null;
    }

    /**
     * Extract product title from element
     * Uses img alt attribute as primary source (most reliable)
     */
    function extractTitle(element) {
        // Primary: Get from main product image alt
        const img = element.querySelector('img[alt]:not([alt=""])');
        if (img && img.alt && img.alt.length > 5 && !img.alt.includes('flag') && !img.alt.includes('star')) {
            return img.alt.trim();
        }

        // Fallback: Get from line-clamp div
        const titleDiv = element.querySelector('.line-clamp-2, [class*="line-clamp"]');
        if (titleDiv) {
            // Get text content, excluding any nested img alt text
            let text = '';
            titleDiv.childNodes.forEach(node => {
                if (node.nodeType === Node.TEXT_NODE) {
                    text += node.textContent;
                }
            });
            if (text.trim().length > 5) {
                return text.trim();
            }
            // If no direct text, use full text content
            return titleDiv.textContent.trim();
        }

        return 'Unknown Product';
    }

    /**
     * Extract product URL from element
     */
    function extractUrl(element) {
        const link = element.querySelector('a[href*="-i."]');
        if (link) {
            let href = link.getAttribute('href');
            if (href.startsWith('/')) {
                href = 'https://shopee.co.id' + href;
            }
            // Clean URL - remove query params
            try {
                const url = new URL(href);
                return url.origin + url.pathname;
            } catch (e) {
                return href.split('?')[0];
            }
        }
        return null;
    }

    /**
     * Extract product image URL
     */
    function extractImage(element) {
        const img = element.querySelector('img[src*="susercontent"]');
        if (img) {
            return img.src || img.getAttribute('data-src') || null;
        }
        return null;
    }

    /**
     * Extract sold count from text
     * Matches patterns like: "968 Terjual", "83RB+ Terjual", etc.
     */
    function extractSold(element) {
        const text = element.innerText;

        // Pattern 1: "968 Terjual" or "83RB+ Terjual"
        const soldMatch = text.match(/([\d.,]+)\s*(RB|rb|K|k)?\+?\s*Terjual/i);
        if (soldMatch) {
            let count = soldMatch[1];
            let suffix = soldMatch[2] || '';
            return `${count}${suffix.toUpperCase()}+ Terjual`;
        }

        // Pattern 2: Just the number before separator and "Terjual"
        const simpleMatch = text.match(/(\d[\d.,]*)\s*Terjual/i);
        if (simpleMatch) {
            return `${simpleMatch[1]} Terjual`;
        }

        return null;
    }

    /**
     * Extract rating from product card
     * Looks for rating number near star icon (e.g., "5.0", "4.8")
     */
    function extractRating(element) {
        const text = element.innerText;

        // Look for rating pattern: number between 1.0 and 5.0
        // Usually appears after star icon text or in rating section
        const ratingMatch = text.match(/\b([1-5]\.\d)\b/);
        if (ratingMatch) {
            return parseFloat(ratingMatch[1]);
        }

        // Check for elements with rating-related classes
        const ratingEls = element.querySelectorAll('[class*="rating"], [class*="star"]');
        for (const el of ratingEls) {
            const match = el.textContent.match(/([1-5]\.\d)/);
            if (match) {
                return parseFloat(match[1]);
            }
        }

        return null;
    }

    /**
     * Scrape product listings from search results page
     * Returns basic info: name, price, rating, sold, url, image
     * @param {number} maxItems - Maximum number of products to scrape
     * @returns {Promise<Array>} Array of product objects
     */
    async function scrapeListings(maxItems = 20) {
        console.log('[Hunter] Starting main page scrape with maxItems:', maxItems);

        // Wait for products to load
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Find product cards
        const items = document.querySelectorAll('li.shopee-search-item-result__item, [data-sqe="item"]');

        if (items.length === 0) {
            console.warn('[Hunter] No product items found on page');
            return [];
        }

        console.log(`[Hunter] Found ${items.length} product cards`);

        const products = [];
        const limit = Math.min(items.length, maxItems);

        for (let i = 0; i < limit; i++) {
            const item = items[i];

            const url = extractUrl(item);
            if (!url) continue; // Skip items without URL

            const product = {
                index: products.length + 1,
                name: extractTitle(item),
                price: extractPrice(item),
                rating: extractRating(item),
                sold: extractSold(item),
                url: url,
                image: extractImage(item)
            };

            // Only add if we have essential data
            if (product.name && product.url) {
                products.push(product);
                console.log(`[Hunter] Extracted product ${product.index}: ${product.name.substring(0, 40)}... | ${product.price} | ${product.rating}⭐ | ${product.sold}`);
            }
        }

        console.log(`[Hunter] Main page scrape complete. Extracted ${products.length} products.`);
        return products;
    }

    // ============ MESSAGE LISTENER ============

    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
        switch (message.action) {
            case 'scrapeListings':
                scrapeListings(message.maxItems || 20)
                    .then(data => sendResponse({ success: true, data }))
                    .catch(err => sendResponse({ success: false, error: err.message }));
                return true; // Keep channel open for async response

            case 'searchShopee':
                sendResponse(searchShopee(message.keyword));
                return true;

            case 'getPageInfo':
                sendResponse({ success: true, data: getCurrentPageInfo() });
                return true;

            case 'ping':
                sendResponse({ success: true, message: 'Content script active' });
                return true;

            case 'checkProductsLoaded':
                // Check if product cards exist on the page
                const items = document.querySelectorAll('li.shopee-search-item-result__item, [data-sqe="item"]');
                sendResponse({
                    loaded: items.length > 0,
                    count: items.length
                });
                return true;

            default:
                // IMPORTANT: Don't respond to unknown actions!
                // Let other content scripts (like deep-scraper.js) handle them.
                return false;
        }
    });

    // ============ INITIALIZE ============

    function init() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', createFAB);
        } else {
            createFAB();
        }
    }

    init();
})();
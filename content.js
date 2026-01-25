/**
 * Shopee Shopping Assistant - Content Script
 * Injects floating action button, sidebar iframe, and handles DOM scraping
 */

(function () {
    'use strict';

    // Prevent multiple injections
    if (window.__shopeeAssistantInjected) return;
    window.__shopeeAssistantInjected = true;

    // State
    let isSidebarOpen = false;
    let sidebarIframe = null;

    // Create and inject iframe sidebar
    function createSidebar() {
        const iframe = document.createElement('iframe');
        iframe.className = 'shopee-assistant-iframe';
        iframe.src = browser.runtime.getURL('sidebar/sidebar.html');
        document.body.appendChild(iframe);
        sidebarIframe = iframe;
    }

    // Toggle sidebar visibility
    function toggleSidebar() {
        if (!sidebarIframe) createSidebar();

        isSidebarOpen = !isSidebarOpen;

        if (isSidebarOpen) {
            sidebarIframe.classList.add('visible');
        } else {
            sidebarIframe.classList.remove('visible');
        }
    }

    // Create and inject floating action button
    function createFAB() {
        // Remove existing FAB if any
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
        tooltip.innerHTML = 'Shopping Assistant<br><small style="opacity:0.7">Click or press Alt+Shift+S</small>';

        document.body.appendChild(fab);
        document.body.appendChild(tooltip);

        // Toggle sidebar on click
        fab.addEventListener('click', () => {
            toggleSidebar();
        });

        return fab;
    }

    // Product selectors for different page types
    const PRODUCT_SELECTORS = {
        search: [
            '[data-sqe="item"]',
            '.shopee-search-item-result__item',
            '.shop-search-result-view__item',
            '[class*="col-xs"][class*="shopee-search-item"]',
            'div[data-sqe="item"]'
        ],
        product: [
            '[class*="VCNVHn"]',
            '[class*="pqTWkA"]',
            '.product-detail',
            '[class*="product-briefing"]'
        ]
    };

    // Wait for products/content to appear using MutationObserver
    function waitForContent(pageType, timeout = 15000) {
        return new Promise((resolve) => {
            const selectors = PRODUCT_SELECTORS[pageType] || PRODUCT_SELECTORS.search;
            const startTime = Date.now();

            // Check if content already exists
            function checkContent() {
                for (const selector of selectors) {
                    const elements = document.querySelectorAll(selector);
                    if (elements.length > 0) {
                        return {
                            found: true,
                            count: elements.length,
                            selector: selector
                        };
                    }
                }
                return { found: false, count: 0 };
            }

            // Initial check
            const initial = checkContent();
            if (initial.found) {
                console.log(`Content already present: ${initial.count} items found`);
                resolve({ success: true, ...initial, waited: 0 });
                return;
            }

            // Set up MutationObserver to watch for new content
            let resolved = false;
            const observer = new MutationObserver((mutations) => {
                if (resolved) return;

                const result = checkContent();
                if (result.found) {
                    resolved = true;
                    observer.disconnect();
                    const waited = Date.now() - startTime;
                    console.log(`Content loaded after ${waited}ms: ${result.count} items found`);
                    resolve({ success: true, ...result, waited });
                }
            });

            // Start observing
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });

            // Also poll periodically as backup
            const pollInterval = setInterval(() => {
                if (resolved) {
                    clearInterval(pollInterval);
                    return;
                }

                const result = checkContent();
                if (result.found) {
                    resolved = true;
                    observer.disconnect();
                    clearInterval(pollInterval);
                    const waited = Date.now() - startTime;
                    console.log(`Content loaded (poll) after ${waited}ms: ${result.count} items found`);
                    resolve({ success: true, ...result, waited });
                }
            }, 500);

            // Timeout fallback
            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    observer.disconnect();
                    clearInterval(pollInterval);
                    const result = checkContent();
                    console.log(`Content check timeout: ${result.found ? result.count + ' items' : 'no items'} found`);
                    resolve({
                        success: result.found,
                        ...result,
                        waited: timeout,
                        timedOut: true
                    });
                }
            }, timeout);
        });
    }

    // List scraping function
    function scrapeListings(maxItems = 20) {
        const products = [];
        const productCards = document.querySelectorAll('[data-sqe="item"], .shopee-search-item-result__item, .shop-search-result-view__item, [class*="shopee-search-item"]');

        productCards.forEach((card, index) => {
            if (index >= maxItems) return;
            try {
                const nameEl = card.querySelector('[data-sqe="name"], .Cve6sh, .ie3A\\+n, .line-clamp-2, [class*="product-title"]');
                const priceEl = card.querySelector('[data-sqe="price"], .ZEgDH9, .vioxXd, [class*="price"]');
                const ratingEl = card.querySelector('.shopee-rating-stars, [data-sqe="rating"]');
                const soldEl = card.querySelector('[data-sqe="sold"], .r6HknA, .OwmBnn');
                const linkEl = card.querySelector('a[href*="/product/"], a[data-sqe="link"]') || card.closest('a');

                // Get image
                let image = '';
                const imgEl = card.querySelector('img[src*="http"]');
                if (imgEl) image = imgEl.src;
                else {
                    // Try to find background image or other source
                    const bgImg = card.querySelector('[style*="background-image"]');
                    if (bgImg) {
                        const match = bgImg.style.backgroundImage.match(/url\("?(.+?)"?\)/);
                        if (match) image = match[1];
                    }
                }

                const product = {
                    name: nameEl?.textContent?.trim() || 'Unknown Product',
                    price: priceEl?.textContent?.trim() || 'N/A',
                    rating: ratingEl ? (ratingEl.querySelectorAll('.shopee-rating-stars__star--full').length || 'N/A') : 'N/A',
                    sold: soldEl?.textContent?.trim() || '0',
                    url: linkEl?.href || '',
                    image: image,
                    index: index + 1
                };

                if (product.name !== 'Unknown Product') {
                    products.push(product);
                }
            } catch (e) {
                console.error('Error scraping product:', e);
            }
        });
        return products;
    }

    // Scrape details function
    function scrapeProductDetails() {
        try {
            const details = {
                name: document.querySelector('[class*="product-title"], h1')?.textContent?.trim() || '',
                price: document.querySelector('[class*="product-price"], [class*="price"]')?.textContent?.trim() || '',
                description: document.querySelector('[class*="product-description"]')?.textContent?.trim() || '',
                specifications: {},
                url: window.location.href
            };

            // Try specific Shopee classes as fallback
            if (!details.name) details.name = document.querySelector('.attM6y, span.qaNIZv')?.textContent?.trim() || '';
            if (!details.price) details.price = document.querySelector('.pqTWkA')?.textContent?.trim() || '';
            if (!details.description) details.description = document.querySelector('.QN4G8b')?.textContent?.trim() || '';

            return details;
        } catch (e) {
            return { error: e.message };
        }
    }

    // Navigation helpers
    function searchShopee(keyword) {
        const encodedKeyword = encodeURIComponent(keyword);
        const url = `https://shopee.co.id/search?keyword=${encodedKeyword}`;
        window.location.href = url;
        return { success: true, url };
    }

    function visitProduct(url) {
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

    // Message listener
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
        console.log('Content script received:', message);

        // Handle Toggle Sidebar specially
        if (message.action === 'toggleSidebar') {
            toggleSidebar();
            sendResponse({ success: true });
            return true;
        }

        // Handle Open Sidebar (force open, e.g. after navigation)
        if (message.action === 'openSidebar') {
            if (!isSidebarOpen) {
                toggleSidebar();
            }
            sendResponse({ success: true });
            return true;
        }

        switch (message.action) {
            case 'scrapeListings':
                sendResponse({ success: true, data: scrapeListings(message.maxItems) });
                break;
            case 'scrapeProductDetails':
                sendResponse({ success: true, data: scrapeProductDetails() });
                break;
            case 'searchShopee':
                sendResponse(searchShopee(message.keyword));
                break;
            case 'visitProduct':
                sendResponse(visitProduct(message.url));
                break;
            case 'getPageInfo':
                sendResponse({ success: true, data: getCurrentPageInfo() });
                break;
            case 'ping':
                sendResponse({ success: true, message: 'Content script active' });
                break;
            case 'waitForContent':
                const currentPageInfo = getCurrentPageInfo();
                waitForContent(message.pageType || currentPageInfo.pageType, message.timeout || 15000)
                    .then(result => sendResponse(result));
                return true; // Async
            default:
                sendResponse({ success: false, error: 'Unknown action' });
        }
        return true;
    });

    // Initialize
    function init() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                createFAB();
                createSidebar();
            });
        } else {
            createFAB();
            createSidebar();
        }
    }

    init();
})();

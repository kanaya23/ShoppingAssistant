/**
 * Shopee Deep Scraper - Product Page Intelligence
 * FAITHFUL PORT OF TAMPERMONKEY V9 (Statistical) SCRIPT
 * 
 * Runs on individual product pages to extract:
 * - Variation prices (clicking each one)
 * - Product description
 * - Rating statistics (ALL 5 star categories)
 * - Sample reviews from ALL star ratings
 * 
 * RETURNS LABELED TEXT REPORT (AI-friendly)
 */

(function () {
    'use strict';

    // Only run on product pages
    if (!window.location.href.match(/-i\.\d+\.\d+/)) return;

    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // Track if we're ready to receive messages
    let isReady = false;

    // --- HELPERS (EXACTLY AS PROVIDED, ADAPTED FOR AUTOMATION) ---

    async function scrollUntilElementFound(selector) {
        return new Promise(async (resolve) => {
            // Initial check: if element exists immediately
            if (document.querySelector(selector)) {
                const el = document.querySelector(selector);
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                return resolve(el);
            }

            let retries = 0;
            const timer = setInterval(() => {
                window.scrollBy(0, 100);
                const el = document.querySelector(selector);
                const atBottom = (window.innerHeight + window.scrollY) >= document.body.offsetHeight - 100;

                if (el) {
                    clearInterval(timer);
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    resolve(el);
                } else if (atBottom) {
                    // Retry a few times at the bottom to allow dynamic content to load
                    retries++;
                    if (retries > 20) { //~1 sec wait at bottom
                        clearInterval(timer);
                        resolve(null);
                    }
                }
            }, 50);
        });
    }

    async function jiggleScroll() {
        window.scrollBy(0, 50);
        await wait(200);
        window.scrollBy(0, -20);
    }

    // --- MAIN LOGIC ---

    async function deepScrape() {
        console.log('[DeepScraper] Starting V9 scrape...');
        let finalReport = "";

        // PHASE 0: WARM UP
        // Increased to 3s to ensure heavy Shopee pages settle
        console.log('[DeepScraper] ⏳ Warming Up (3s)...');
        await wait(3000);

        // Sanity Check: Are we even on a loaded page?
        if (!document.querySelector('.product-briefing') && !document.querySelector('.page-product')) {
            console.log('[DeepScraper] ⚠️ Page structure not found. Waiting longer...');
            await wait(2000);
        }

        // PHASE 1: VARIATIONS
        console.log('[DeepScraper] 💰 Clicking Variations...');
        finalReport += "=== 💰 VARIATION PRICES ===\n";

        const varButtons = document.querySelectorAll('button.product-variation, button.sApkZm');
        if (varButtons.length > 0) {
            for (let b of varButtons) {
                if (b.getAttribute('aria-disabled') === 'true') continue;
                b.click();
                await jiggleScroll();
                // Wait slightly longer for price update
                await wait(2000);
                const price = document.querySelector('.IZPeQz')?.innerText || "N/A";
                const name = b.getAttribute('aria-label') || b.innerText;
                finalReport += `- ${name}: ${price}\n`;
            }
        } else {
            const singlePrice = document.querySelector('.IZPeQz')?.innerText;
            if (singlePrice) finalReport += `Single Price: ${singlePrice}\n`;
        }
        finalReport += "\n";

        // PHASE 1.5: SHOP INFORMATION (Trust Indicators)
        console.log('[DeepScraper] 🏪 Extracting Shop Information...');
        finalReport += "=== 🏪 SHOP INFORMATION ===\n";

        const shopSection = document.querySelector('.page-product__shop, section.page-product__shop');
        if (shopSection) {
            // Shop Name (from the fV3TIn class or similar)
            const shopName = shopSection.querySelector('.fV3TIn, [class*="shop-name"]')?.innerText?.trim();
            if (shopName) finalReport += `Shop Name: ${shopName}\n`;

            // Active Status (e.g., "Aktif 2 jam lalu")
            const activeStatus = shopSection.querySelector('.Fsv0YO, [class*="active-time"]')?.innerText?.trim();
            if (activeStatus) finalReport += `Active Status: ${activeStatus}\n`;

            // Shop Statistics (from the YnZi6x elements)
            const statItems = shopSection.querySelectorAll('.YnZi6x');
            if (statItems.length > 0) {
                finalReport += "--- Shop Stats ---\n";
                statItems.forEach(item => {
                    const label = item.querySelector('.ffHYws, label')?.innerText?.trim() || '';
                    const value = item.querySelector('.Cs6w3G, span:not(.ffHYws)')?.innerText?.trim() || '';
                    if (label && value) {
                        finalReport += `• ${label}: ${value}\n`;
                    }
                });
            }

        } else {
            finalReport += "⚠️ Shop information section not found.\n";
        }
        finalReport += "\n";

        // PHASE 2: DESCRIPTION
        console.log('[DeepScraper] 🔍 Hunting Description...');
        const descElement = await scrollUntilElementFound('.product-detail');
        finalReport += "=== 📝 PRODUCT DETAILS ===\n";
        if (descElement) {
            console.log('[DeepScraper] ⏳ Loading Desc...');
            await wait(1500);
            finalReport += descElement.innerText.replace(/\n\s*\n\s*\n/g, '\n\n');
        } else {
            finalReport += "⚠️ Description Not Found.";
        }
        finalReport += "\n\n";

        // PHASE 3: REVIEWS & STATISTICS
        console.log('[DeepScraper] 📜 Hunting Reviews...');
        const navBar = await scrollUntilElementFound('.product-ratings__page-controller, .shopee-page-controller');
        console.log('[DeepScraper] ⏳ Initializing Reviews...');
        await wait(2000);

        if (navBar) {
            // A. CAPTURE STATISTICS
            const summary = document.querySelector('.product-rating-overview__score-wrapper')?.innerText || "Summary N/A";
            finalReport += `=== 📊 RATING STATISTICS (Score: ${summary}) ===\n`;

            const filters = document.querySelectorAll('.product-rating-overview__filter');
            const starLabels = ["5 Star", "4 Star", "3 Star", "2 Star", "1 Star"];

            if (filters.length >= 6) {
                for (let i = 0; i < 5; i++) {
                    const filterText = filters[i + 1].innerText;
                    const count = filterText.match(/\((.*?)\)/);
                    const countText = count ? count[0] : "(0)";
                    finalReport += `• ${starLabels[i]} Count: ${countText}\n`;
                }
                finalReport += "\n";

                // B. EXTRACT COMMENTS
                for (let i = 0; i < 5; i++) {
                    filters[i + 1].click();
                    console.log(`[DeepScraper] Reading ${starLabels[i]}...`);
                    await wait(2000);

                    finalReport += `--- 📂 ${starLabels[i]} Comments ---\n`;

                    const comments = document.querySelectorAll('.shopee-product-rating__main, .meQyXP');
                    const authors = document.querySelectorAll('.shopee-product-rating__author-name, .InK5kS');

                    if (comments.length > 0) {
                        comments.forEach((c, index) => {
                            let text = c.innerText.trim().replace(/Membantu\?|Respon Penjual:|Laporkan Penyalahgunaan/g, "");
                            let author = authors[index] ? authors[index].innerText : "User";
                            if (text.length > 3) finalReport += `• [${author}]: ${text}\n`;
                        });
                    } else {
                        finalReport += "(No text reviews found)\n";
                    }
                    finalReport += "\n";
                }
            }
        } else {
            finalReport += "\n⚠️ Review Navigation Bar not found.";
        }

        console.log('[DeepScraper] ✅ DONE! Report length:', finalReport.length);
        return finalReport;
    }

    // --- MESSAGE LISTENER ---
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'deepScraperPing') {
            sendResponse({ ready: isReady });
            return false;
        }

        if (message.action === 'triggerDeepScrape') {
            console.log('[DeepScraper] TRIGGER RECEIVED');
            deepScrape()
                .then(report => sendResponse({ success: true, data: report }))
                .catch(err => sendResponse({ success: false, error: err.message }));
            return true; // Keep channel open
        }
        return false;
    });

    // Wait for page specific elements to ensure we are on a loaded product page
    const initInterval = setInterval(() => {
        const pageTarget = document.querySelector('.page-product') || document.querySelector('.product-briefing');
        if (pageTarget) {
            isReady = true;
            console.log('[DeepScraper] Service ready (Page Loaded) on:', window.location.href);
            clearInterval(initInterval);
        }
    }, 500);

    // Fallback safety: If element never found after 15s, try to proceed anyway or let manager timeout
    setTimeout(() => {
        if (!isReady) {
            console.warn('[DeepScraper] Warning: Page element check timed out, forcing ready state.');
            isReady = true;
            clearInterval(initInterval);
        }
    }, 15000);

})();

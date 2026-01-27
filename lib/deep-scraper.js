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

    // Only run on product pages (URL contains -i.SHOPID.ITEMID pattern)
    if (!window.location.href.match(/-i\.\d+\.\d+/)) return;

    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // Track if we're ready to receive messages
    let isReady = false;

    // --- HELPERS (SAME AS TAMPERMONKEY V9) ---

    async function scrollUntilElementFound(selector) {
        return new Promise(async (resolve) => {
            const timer = setInterval(() => {
                window.scrollBy(0, 100);
                const el = document.querySelector(selector);
                const atBottom = (window.innerHeight + window.scrollY) >= document.body.offsetHeight - 100;

                if (el) {
                    clearInterval(timer);
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    resolve(el);
                } else if (atBottom) {
                    clearInterval(timer);
                    resolve(null);
                }
            }, 50);
        });
    }

    async function jiggleScroll() {
        window.scrollBy(0, 50);
        await wait(200);
        window.scrollBy(0, -20);
    }

    // --- MAIN LOGIC (EXACT COPY OF TAMPERMONKEY V9) ---

    async function deepScrape() {
        console.log('[DeepScraper] Starting V9 scrape (Text Report Mode)...');
        let finalReport = "";

        // PHASE 0: WARM UP (SAME AS TAMPERMONKEY)
        console.log('[DeepScraper] ⏳ Warming Up (2s)...');
        await wait(2000);

        // PHASE 1: VARIATIONS (SAME AS TAMPERMONKEY)
        console.log('[DeepScraper] 💰 Clicking Variations...');
        finalReport += "=== 💰 VARIATION PRICES ===\n";

        const varButtons = document.querySelectorAll('button.product-variation, button.sApkZm');
        if (varButtons.length > 0) {
            for (let b of varButtons) {
                if (b.getAttribute('aria-disabled') === 'true') continue;
                b.click();
                await jiggleScroll();
                console.log('[DeepScraper] ⏳ Waiting Price...');
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

        // PHASE 2: DESCRIPTION (SAME AS TAMPERMONKEY)
        console.log('[DeepScraper] 🔍 Hunting Description...');
        const descElement = await scrollUntilElementFound('.product-detail');
        finalReport += "=== 📝 PRODUCT DETAILS ===\n";
        if (descElement) {
            console.log('[DeepScraper] ⏳ Loading Desc...');
            await wait(2000);
            finalReport += descElement.innerText.replace(/\n\s*\n\s*\n/g, '\n\n');
        } else {
            finalReport += "⚠️ Description Not Found.";
        }
        finalReport += "\n\n";

        // PHASE 3: REVIEWS & STATISTICS (SAME AS TAMPERMONKEY)
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
                // Loop through the buttons to grab the text (e.g. "5 Bintang (9,8RB)")
                // Index 1 = 5 Star, Index 5 = 1 Star
                for (let i = 0; i < 5; i++) {
                    const filterText = filters[i + 1].innerText;
                    // Clean it up: "5 Bintang (9,8RB)" -> "5 Star: (9,8RB)"
                    const count = filterText.match(/\((.*?)\)/); // Grab text inside parenthesis
                    const countText = count ? count[0] : "(0)";
                    finalReport += `• ${starLabels[i]} Count: ${countText}\n`;
                }
                finalReport += "\n";

                // B. EXTRACT COMMENTS (ALL 5 STAR CATEGORIES - SAME AS TAMPERMONKEY)
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
            // Respond to ping with ready status
            sendResponse({ ready: isReady });
            return false;
        }

        if (message.action === 'triggerDeepScrape') {
            console.log('[DeepScraper] Received trigger command');
            deepScrape()
                .then(report => sendResponse({ success: true, data: report }))
                .catch(err => sendResponse({ success: false, error: err.message }));
            return true; // Keep channel open for async
        }

        return false;
    });

    // Mark as ready after a short delay to ensure page is interactive
    setTimeout(() => {
        isReady = true;
        console.log('[DeepScraper] Service ready on:', window.location.href);
    }, 1000);

})();

/**
 * Gemini Content Script - Web API Bridge
 * Handles direct interaction with the Gemini web interface
 */

(function () {
    'use strict';

    const SELECTORS = {
        editableDiv: 'div.ql-editor.textarea',
        sendButton: 'button:has(mat-icon[fonticon="send"])',
        responseBlock: '.presented-response-container',
        textData: '.markdown-main-panel'
    };

    // Mode switching selectors (based on Gemini UI)
    const MODE_SELECTORS = {
        modePillButton: 'button:has(.logo-pill-label-container)',          // The button showing current mode (Fast/Pro/Thinking)
        modePillLabel: '.logo-pill-label-container span',                   // The label text showing current mode
        modeMenu: 'mat-bottom-sheet-container .bard-mode-bottom-sheet',     // The mode selection menu
        fastOption: '[data-test-id="bard-mode-option-fast"]',
        thinkingOption: '[data-test-id="bard-mode-option-thinking"]',
        proOption: '[data-test-id="bard-mode-option-pro"]'
    };

    let isProcessing = false;

    // Listen for messages from background script
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'GEMINI_PROMPT') {
            handlePrompt(message.text, sendResponse);
            return true; // Keep channel open for async response
        }
        if (message.action === 'CHECK_READY') {
            sendResponse({ ready: true, url: window.location.href });
        }
        if (message.action === 'SET_GEMINI_MODE') {
            handleModeSwitch(message.mode, sendResponse);
            return true; // Keep channel open for async response
        }
        if (message.action === 'GET_CURRENT_MODE') {
            const currentMode = detectCurrentMode();
            sendResponse({ success: true, mode: currentMode });
        }
    });

    /**
     * Detect the current Gemini mode by reading the mode pill label
     */
    function detectCurrentMode() {
        const label = document.querySelector(MODE_SELECTORS.modePillLabel);
        if (!label) {
            console.log('[GeminiContent] Mode label not found');
            return null;
        }
        const text = label.textContent.trim().toLowerCase();
        console.log('[GeminiContent] Detected mode label:', text);

        if (text.includes('fast')) return 'fast';
        if (text.includes('thinking')) return 'thinking';
        if (text.includes('pro')) return 'pro';
        return null;
    }

    /**
     * Switch to a specific mode (fast, thinking, pro)
     */
    async function handleModeSwitch(targetMode, sendResponse) {
        console.log('[GeminiContent] Switching to mode:', targetMode);

        try {
            const currentMode = detectCurrentMode();
            console.log('[GeminiContent] Current mode:', currentMode);

            // If already in target mode, no need to switch
            if (currentMode === targetMode) {
                console.log('[GeminiContent] Already in target mode');
                sendResponse({ success: true, switched: false, mode: currentMode });
                return;
            }

            // Click the mode pill to open the menu
            const modePillButton = document.querySelector(MODE_SELECTORS.modePillButton);
            if (!modePillButton) {
                console.log('[GeminiContent] Mode pill button not found');
                sendResponse({ success: false, error: 'Mode pill button not found' });
                return;
            }

            modePillButton.click();
            console.log('[GeminiContent] Clicked mode pill button');

            // Wait for the menu to appear
            await new Promise(resolve => setTimeout(resolve, 500));

            // Find and click the target mode option
            let optionSelector;
            switch (targetMode) {
                case 'fast':
                    optionSelector = MODE_SELECTORS.fastOption;
                    break;
                case 'thinking':
                    optionSelector = MODE_SELECTORS.thinkingOption;
                    break;
                case 'pro':
                    optionSelector = MODE_SELECTORS.proOption;
                    break;
                default:
                    sendResponse({ success: false, error: 'Invalid target mode' });
                    return;
            }

            const optionButton = document.querySelector(optionSelector);
            if (!optionButton) {
                console.log('[GeminiContent] Mode option not found:', optionSelector);
                // Try to close the menu by clicking elsewhere
                document.body.click();
                sendResponse({ success: false, error: 'Mode option not found' });
                return;
            }

            optionButton.click();
            console.log('[GeminiContent] Clicked mode option:', targetMode);

            // Wait for the mode to switch
            await new Promise(resolve => setTimeout(resolve, 800));

            // Verify the switch
            const newMode = detectCurrentMode();
            console.log('[GeminiContent] New mode after switch:', newMode);

            sendResponse({
                success: newMode === targetMode,
                switched: true,
                mode: newMode,
                error: newMode !== targetMode ? 'Mode verification failed' : null
            });

        } catch (error) {
            console.error('[GeminiContent] Mode switch error:', error);
            sendResponse({ success: false, error: error.message });
        }
    }

    async function handlePrompt(text, sendResponse) {
        if (isProcessing) {
            sendResponse({ error: 'Busy processing another request' });
            return;
        }

        // Note: URL is now configurable in settings, no specific Gem ID check needed
        // Content script runs on any gemini.google.com page

        isProcessing = true;

        try {
            await executeGeminiTask(text);
            const responseText = await observeAndCopy();
            isProcessing = false;
            sendResponse({ success: true, text: responseText });
        } catch (error) {
            isProcessing = false;
            sendResponse({ error: error.message });
        }
    }

    function executeGeminiTask(query) {
        return new Promise((resolve, reject) => {
            let attempt = 0;
            const maxAttempts = 20; // 10 seconds

            const checkExist = setInterval(() => {
                attempt++;
                const editor = document.querySelector(SELECTORS.editableDiv);

                if (editor) {
                    clearInterval(checkExist);

                    // Focus and Input
                    editor.focus();
                    // Clear existing (though usually empty) - standard way to clear content editable
                    editor.innerHTML = '';
                    document.execCommand('insertText', false, query); // More robust than innerHTML for some editors
                    // Fallback if execCommand fails/is blocked
                    if (editor.innerText.trim() !== query.trim()) {
                        editor.innerText = query;
                    }

                    editor.dispatchEvent(new Event('input', { bubbles: true }));

                    // Small delay to ensure button enables
                    setTimeout(() => {
                        const btn = document.querySelector(SELECTORS.sendButton);
                        if (btn && !btn.disabled) {
                            btn.click();
                            resolve();
                        } else {
                            // Try one more time finding the button
                            const pendingBtn = document.querySelector(SELECTORS.sendButton);
                            if (pendingBtn) {
                                pendingBtn.click();
                                resolve();
                            } else {
                                reject(new Error('Send button not found or disabled'));
                            }
                        }
                    }, 800);
                } else if (attempt >= maxAttempts) {
                    clearInterval(checkExist);
                    reject(new Error('Gemini Editor not found on page'));
                }
            }, 500);
        });
    }

    function observeAndCopy() {
        return new Promise((resolve, reject) => {
            console.log("[GeminiContent] Waiting for Gemini to finish generating...");

            const startResponses = document.querySelectorAll(SELECTORS.responseBlock);
            const startCount = startResponses.length;

            let timeout = setTimeout(() => {
                if (checkInterval) clearInterval(checkInterval);
                observer.disconnect();
                reject(new Error('Timeout waiting for Gemini response'));
            }, 180000); // 3 minute timeout for long responses

            let checkInterval = null;
            let hasStartedGenerating = false;

            // Check if Gemini is still generating by looking at the stop button
            function isStillGenerating() {
                // Look for the send button with "stop" class - this means generating
                const stopButton = document.querySelector('button.send-button.stop');
                if (stopButton) {
                    // Check for stop icon inside
                    const stopIcon = stopButton.querySelector('mat-icon[fonticon="stop"]');
                    return !!stopIcon;
                }
                return false;
            }

            // Extract content with FULL URLs from href attributes (not truncated text)
            function extractContentWithLinks(element) {
                // Clone the element to safely modify it
                const clone = element.cloneNode(true);

                // Find all links and replace their text with full href
                const links = clone.querySelectorAll('a[href]');
                links.forEach(link => {
                    const fullUrl = link.getAttribute('href');
                    if (fullUrl && fullUrl.startsWith('http')) {
                        // Replace the truncated visible text with the full URL
                        link.textContent = fullUrl;
                    }
                });

                // Also check for link-block elements (Gemini's special link components)
                const linkBlocks = clone.querySelectorAll('link-block a[href]');
                linkBlocks.forEach(link => {
                    const fullUrl = link.getAttribute('href');
                    if (fullUrl && fullUrl.startsWith('http')) {
                        link.textContent = fullUrl;
                    }
                });

                // CRITICAL FIX: innerText on a detached node doesn't preserve newlines from block elements.
                // We must append the clone to the DOM (hidden) to get correct line breaks.
                const wrapper = document.createElement('div');
                wrapper.style.position = 'absolute';
                wrapper.style.left = '-9999px';
                wrapper.style.top = '-9999px';
                // DON'T use visibility: hidden, as it causes innerText to ignore the content!
                wrapper.style.opacity = '0';
                wrapper.style.pointerEvents = 'none';

                wrapper.appendChild(clone);
                document.body.appendChild(wrapper);

                let text = clone.innerText.trim();

                // Fallback if innerText returns empty (can happen with some frameworks/shadow DOM)
                if (!text) {
                    console.log("[GeminiContent] innerText empty, falling back to textContent");
                    text = clone.textContent.trim();
                }

                console.log(`[GeminiContent] Extracted text length: ${text.length}`);

                // Cleanup
                document.body.removeChild(wrapper);

                // Ultimate Fallback: If cloning failed to get text, use the live element's text
                // (This sacrifices full URL expansion but ensures we get the tool call)
                if (!text || text.trim().length === 0) {
                    console.warn("[GeminiContent] Clone extraction failed completely. Falling back to live element text.");
                    return element.textContent.trim();
                }

                return text;
            }

            const observer = new MutationObserver((mutations, obs) => {
                const allResponses = document.querySelectorAll(SELECTORS.responseBlock);

                // Wait for a NEW response block to appear (must be strictly more than startCount)
                // DO NOT use "allResponses.length > 0" - that would return the previous response!
                if (allResponses.length > startCount) {
                    const latest = allResponses[allResponses.length - 1];
                    const textElement = latest.querySelector(SELECTORS.textData);

                    if (textElement && !checkInterval) {
                        console.log("[GeminiContent] Response block detected, starting generation monitor...");

                        // Start polling for generation status
                        checkInterval = setInterval(() => {
                            const generating = isStillGenerating();
                            const currentContent = textElement.innerText.trim();

                            if (generating) {
                                hasStartedGenerating = true;
                                console.log(`[GeminiContent] Still generating... (${currentContent.length} chars)`);
                            } else if (hasStartedGenerating && currentContent.length > 0) {
                                // Was generating, now stopped, and we have content
                                console.log(`[GeminiContent] Generation complete! (${currentContent.length} chars)`);
                                clearInterval(checkInterval);
                                clearTimeout(timeout);
                                obs.disconnect();

                                // Small grace period for final render
                                setTimeout(() => {
                                    // Use extractContentWithLinks to get FULL URLs
                                    const finalContent = extractContentWithLinks(textElement);
                                    console.log(`[GeminiContent] Extracted content with full links (${finalContent.length} chars)`);
                                    resolve(finalContent);
                                }, 300);
                            } else if (!generating && currentContent.length > 10) {
                                // Edge case: might have missed the start, but we have content
                                hasStartedGenerating = true;
                            }
                        }, 500);
                    }
                }
            });

            observer.observe(document.body, {
                attributes: true,
                childList: true,
                subtree: true,
                characterData: true
            });
        });
    }

    console.log('Gemini Web API Content Script Loaded');

})();

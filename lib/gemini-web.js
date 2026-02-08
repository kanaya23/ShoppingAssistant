/**
 * Gemini Web API Adapter
 * Manages communication with the Gemini Content Script
 */

const GeminiWebAPI = {
    // Default fallback URL (can be overridden by settings)
    DEFAULT_URL: 'https://gemini.google.com/u/0/app',

    // Track our specific tab
    tabId: null,

    // Persisted context from the sidebar window
    contextTabId: null,
    uiWindowId: null,

    workerTabId: null,

    // Cached target URL (loaded from storage)
    _cachedTargetUrl: null,

    /**
     * Get the target Gemini URL from storage or use default
     */
    async getTargetUrl() {
        if (this._cachedTargetUrl) return this._cachedTargetUrl;

        try {
            const result = await browser.storage.local.get('geminiUrl');
            this._cachedTargetUrl = result.geminiUrl || this.DEFAULT_URL;
        } catch (e) {
            this._cachedTargetUrl = this.DEFAULT_URL;
        }
        return this._cachedTargetUrl;
    },

    /**
     * Clear cached URL (call when settings change)
     */
    clearUrlCache() {
        this._cachedTargetUrl = null;
    },

    setContext({ tabId, uiWindowId } = {}) {
        this.contextTabId = Number.isInteger(tabId) ? tabId : null;
        this.uiWindowId = Number.isInteger(uiWindowId) ? uiWindowId : null;
    },

    async setTabKeepAlive(tabId) {
        try {
            await browser.tabs.update(tabId, { autoDiscardable: false });
        } catch (e) {
            // Ignore if unsupported
        }
    },

    async activateTab(tabId, delayMs = 900) {
        if (!tabId) return;
        await browser.tabs.update(tabId, { active: true });
        await new Promise(r => setTimeout(r, delayMs));
    },

    // System instructions for tool usage (prepended to first user prompt)
    // This OVERRIDES the Gem's default behavior to force actual tool execution
    // System instructions for tool usage (prepended to first user prompt)
    // This OVERRIDES the Gem's default behavior to force actual tool execution
    TOOL_INSTRUCTIONS: typeof Instructions !== 'undefined' ? Instructions.WEB_TOOL_PROTOCOL : `⛔ MANDATORY PROTOCOL... (Instructions not loaded)`,

    /**
     * Send a message to Gemini Web and await response
     * Handles the "Tool Loop" - if response is a tool call, execute and recurse.
     * @param {Function} onProgress - Progress callback (current, total, toolName) for tools like deep_scrape
     * @param {Function} onToolResult - Called when a tool completes (toolName, success)
     */
    async sendMessage(messages, onChunk, onToolCall, onProgress, onToolResult) {
        // 1. Prepare the input text
        const lastMessage = messages[messages.length - 1];
        if (!lastMessage || lastMessage.role !== 'user') {
            throw new Error("No user message found to send.");
        }

        let promptText;
        if (lastMessage.content) {
            promptText = lastMessage.content;
        } else if (lastMessage.parts && lastMessage.parts[0]) {
            promptText = lastMessage.parts[0].text || lastMessage.parts[0].functionResponse?.response || JSON.stringify(lastMessage.parts[0]);
        } else {
            throw new Error("Could not extract text from last message.");
        }

        // 2. Ensure Gemini Tab is Open/Ready
        await this.ensureTab();

        // 3. Tool Loop with state tracking
        let finalResponse = null;
        let currentPrompt = this.TOOL_INSTRUCTIONS + promptText;
        let turnCount = 0;
        const MAX_TURNS = 15;

        // Track executed tools to prevent re-execution
        const executedTools = new Map(); // key: "toolName:argsHash", value: result

        // Send empty chunk to trigger typing indicator display (sidebar shows animated dots)
        // The sidebar's startStreamingMessage() already shows the typing indicator

        while (turnCount < MAX_TURNS) {
            turnCount++;
            console.log(`\n[GeminiWeb] ===== TURN ${turnCount} =====`);

            // Send to Content Script and wait for COMPLETE response
            console.log(`[GeminiWeb] Sending prompt (${currentPrompt.length} chars)...`);
            await this.activateTab(this.tabId);
            let responseText = await this.sendToContentScript(currentPrompt);

            // Clean response
            responseText = this.cleanResponseText(responseText);
            console.log(`[GeminiWeb] DEBUG: Full response text: [[${responseText}]]`); // DEBUG Log

            // Check for tool call
            const toolCallBlock = this.extractToolCall(responseText);

            if (!toolCallBlock) {
                console.log("[GeminiWeb] DEBUG: extractToolCall returned NULL"); // DEBUG Log
                // No tool call -> Final answer
                console.log("[GeminiWeb] No tool call detected - this is final response");
                finalResponse = responseText;
                // Clear the "Processing..." indicator by sending a special clear signal,
                // then send the actual content
                if (onChunk) {
                    onChunk('__CLEAR__'); // Signal to clear previous content
                    onChunk(responseText);
                }
                break;
            }

            // Tool call detected
            const toolKey = `${toolCallBlock.tool}:${JSON.stringify(toolCallBlock.args)}`;
            console.log(`[GeminiWeb] Detected tool: ${toolCallBlock.tool}`);

            // Check if we already executed this exact tool call
            if (executedTools.has(toolKey)) {
                console.log(`[GeminiWeb] SKIPPING - already executed: ${toolKey}`);
                // Instead of sending another message about it, just skip this turn entirely.
                // The problem is Gemini might echo the tool call in its response, causing a double-send.
                // We don't want to confuse Gemini by telling it the same tool was "already executed"
                // since it just got the success message. Instead, we treat this as noise and continue
                // to the next iteration, hoping Gemini's actual next step is different.

                // Give Gemini a moment and try again to see if it produces a different output
                console.log("[GeminiWeb] Waiting 3s and retrying to get the next step...");
                await new Promise(r => setTimeout(r, 3000));

                // Ask Gemini to continue without repeating the tool result
                currentPrompt = `Continue with the next step. Do NOT repeat the previous tool call.`;
                continue;
            }

            // Notify UI about tool call (use same format as native API)
            if (onToolCall) {
                onToolCall({
                    name: toolCallBlock.tool,
                    args: toolCallBlock.args
                });
            }

            // Execute tool (with tab switching)
            let toolResult;
            try {
                toolResult = await this.executeTool(toolCallBlock.tool, toolCallBlock.args, onProgress);
                console.log(`[GeminiWeb] Tool result:`, JSON.stringify(toolResult).substring(0, 200));

                // Cache the result
                executedTools.set(toolKey, toolResult);

                // Notify UI that tool completed successfully
                if (onToolResult) {
                    onToolResult(toolCallBlock.tool, true);
                }

                currentPrompt = `Tool '${toolCallBlock.tool}' completed successfully.\n\nResult: ${JSON.stringify(toolResult)}\n\nPlease continue with the NEXT step in the workflow.`;

            } catch (err) {
                console.error(`[GeminiWeb] Tool error:`, err);

                // Notify UI that tool failed
                if (onToolResult) {
                    onToolResult(toolCallBlock.tool, false);
                }

                currentPrompt = `Tool '${toolCallBlock.tool}' failed: ${err.message}\n\nPlease continue with the next step or try an alternative approach.`;
            }

            // Wait before next turn
            console.log("[GeminiWeb] Waiting 2s before next turn...");
            await new Promise(r => setTimeout(r, 2000));
        }

        if (turnCount >= MAX_TURNS) {
            console.warn("[GeminiWeb] Max turns reached!");
            if (!finalResponse && onChunk) {
                onChunk("⚠️ Maximum tool iterations reached. Please try a simpler query.");
            }
        }

        return { text: finalResponse };
    },

    /**
     * Ensure a Gemini tab is open and ready
     * Creates a NEW Gemini tab for each query (don't reuse existing tabs)
     */
    async ensureTab() {
        const targetUrl = await this.getTargetUrl();

        // Always create a NEW tab for each query
        console.log('[GeminiWeb] Creating new Gemini tab for this query...');
        const newTab = await browser.tabs.create({ url: targetUrl, active: true });
        this.tabId = newTab.id;
        await this.setTabKeepAlive(this.tabId);

        // Wait for load
        await new Promise(resolve => {
            const listener = (tabId, changeInfo) => {
                if (tabId === this.tabId && changeInfo.status === 'complete') {
                    browser.tabs.onUpdated.removeListener(listener);
                    resolve();
                }
            };
            browser.tabs.onUpdated.addListener(listener);
        });

        // Give extra time for content script to init
        await new Promise(r => setTimeout(r, 2500));
        console.log(`[GeminiWeb] New Gemini tab ready: ${this.tabId}`);

        await this.ensureGeminiReady();

        // Switch to user's preferred mode before sending prompts
        await this.ensureMode();
    },

    async ensureGeminiReady() {
        if (!this.tabId) return;
        try {
            await browser.tabs.sendMessage(this.tabId, { action: 'CHECK_READY' });
        } catch (e) {
            await this.activateTab(this.tabId, 1200);
            await browser.tabs.sendMessage(this.tabId, { action: 'CHECK_READY' });
        }
    },

    /**
     * Ensure the Gemini mode matches user's preference
     */
    async ensureMode() {
        try {
            // Get user's preferred mode from storage
            const settings = await browser.storage.local.get('geminiMode');
            const targetMode = settings.geminiMode || 'fast';
            console.log(`[GeminiWeb] Ensuring mode is set to: ${targetMode}`);

            // Send message to content script to switch mode
            const response = await browser.tabs.sendMessage(this.tabId, {
                action: 'SET_GEMINI_MODE',
                mode: targetMode
            });

            if (response && response.success) {
                if (response.switched) {
                    console.log(`[GeminiWeb] Mode switched to: ${response.mode}`);
                } else {
                    console.log(`[GeminiWeb] Already in ${response.mode} mode`);
                }
            } else {
                console.warn('[GeminiWeb] Mode switch failed:', response?.error);
            }
        } catch (error) {
            console.error('[GeminiWeb] Error ensuring mode:', error);
            // Continue anyway - don't block on mode switch failure
        }
    },

    /**
     * Communication primitive
     */
    sendToContentScript(text) {
        return new Promise((resolve, reject) => {
            if (!this.tabId) {
                reject(new Error("No Gemini Tab ID available"));
                return;
            }

            browser.tabs.sendMessage(this.tabId, { action: 'GEMINI_PROMPT', text: text })
                .then(response => {
                    if (browser.runtime.lastError) {
                        reject(new Error(browser.runtime.lastError.message));
                    } else if (response && response.error) {
                        reject(new Error(response.error));
                    } else if (response && response.success) {
                        resolve(response.text);
                    } else {
                        reject(new Error("Unknown response from Gemini Content Script"));
                    }
                })
                .catch(err => {
                    reject(err); // Port closed etc
                });
        });
    },

    /**
     * Clean response text before parsing
     * Removes common noise patterns from Gemini output
     */
    cleanResponseText(text) {
        if (!text) return '';

        let cleaned = text;

        // Remove common prefixes/noise
        cleaned = cleaned.replace(/^[\s.…]+/g, '');  // Leading dots/ellipsis
        cleaned = cleaned.replace(/^(JSON|json)\s*/i, '');  // "JSON" prefix
        cleaned = cleaned.replace(/^(Here'?s?|Output|Response|Result)[\s:]+/i, '');

        // Remove UI artifacts that might get scraped
        cleaned = cleaned.replace(/Shopping-Gem/gi, '');
        cleaned = cleaned.replace(/Custom Gem/gi, '');
        cleaned = cleaned.replace(/You stopped this response/gi, '');

        // Normalize whitespace but PRESERVE line breaks
        // Only collapse multiple spaces on the same line, don't touch newlines
        cleaned = cleaned.replace(/[^\S\n]+/g, ' '); // Replace non-newline whitespace with single space
        cleaned = cleaned.replace(/\n{3,}/g, '\n\n'); // Collapse 3+ newlines to 2
        cleaned = cleaned.trim();

        return cleaned;
    },

    /**
     * Parses text to find JSON tool calls
     * Handles: ```json { ... } ```, bare JSON, or "...JSON { ... }"
     */
    extractToolCall(text) {
        // 1. Try standard code block extraction first (most reliable)
        const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/g;
        let match;
        while ((match = codeBlockRegex.exec(text)) !== null) {
            try {
                const json = JSON.parse(match[1].trim());
                if (json.tool && json.args !== undefined) return json;
            } catch (e) { }
        }

        // 2. Fallback: Robust brace counting to find JSON objects
        // This handles nested objects correctly where regex fails
        let startIndex = text.indexOf('{');
        while (startIndex !== -1) {
            let braceCount = 0;
            let inString = false;
            let escape = false;
            let endIndex = -1;

            // Scan from startIndex to find matching closing brace
            for (let i = startIndex; i < text.length; i++) {
                const char = text[i];

                if (escape) {
                    escape = false;
                    continue;
                }

                if (char === '\\') {
                    escape = true;
                    continue;
                }

                if (char === '"') {
                    inString = !inString;
                    continue;
                }

                if (!inString) {
                    if (char === '{') {
                        braceCount++;
                    } else if (char === '}') {
                        braceCount--;
                        if (braceCount === 0) {
                            endIndex = i;
                            break;
                        }
                    }
                }
            }

            if (endIndex !== -1) {
                const candidate = text.substring(startIndex, endIndex + 1);
                try {
                    const json = JSON.parse(candidate);
                    // Check for required fields
                    if (json.tool && json.args !== undefined) {
                        return json;
                    }
                } catch (e) {
                    // Invalid JSON, continue searching
                }
            }

            // Move to next possible start
            startIndex = text.indexOf('{', startIndex + 1);
        }

        return null;
    },

    /**
     * Execute local tools using ToolExecutor (lib/tools.js)
     * ToolExecutor is loaded by background script context via manifest.
     * @param {Function} onProgress - Progress callback (current, total) for multi-step tools
     */
    async executeTool(name, args, onProgress) {
        // ToolExecutor is defined in lib/tools.js and loaded in background context
        if (typeof ToolExecutor === 'undefined') {
            throw new Error("ToolExecutor library not loaded in background");
        }

        // Skip serper_search - Gemini Web has native Google Search
        if (name === 'serper_search') {
            console.log('[GeminiWeb] Skipping serper_search - Gemini Web has native search');
            return {
                skipped: true,
                message: 'serper_search is not needed in Web API mode. Please use your native Google Search capability instead.'
            };
        }

        // Ensure we have a valid Shopee worker tab
        await this.ensureWorkerTab();

        // Make sure content script is ready
        if (this.workerTabId) {
            await this.activateTab(this.workerTabId, 1200);
            await this.waitForContentScript(this.workerTabId);
        }

        console.log(`[GeminiWeb] Executing tool '${name}' with tabId=${this.workerTabId}`, args);

        // Pass progress callback to ToolExecutor (with URL for deep_scrape)
        const progressCallback = onProgress ? (current, total, url) => onProgress(current, total, name, url) : null;
        try {
            return await ToolExecutor.execute(name, args, this.workerTabId, progressCallback);
        } finally {
            if (this.tabId) {
                await this.activateTab(this.tabId, 1200);
            }
        }
    },

    /**
     * Ensure a Shopee worker tab exists and is ready
     */
    async ensureWorkerTab() {
        if (this.workerTabId) {
            try {
                const tab = await browser.tabs.get(this.workerTabId);
                if (tab && tab.url && tab.url.includes('shopee.co.id')) {
                    return;
                }
            } catch (e) {
                this.workerTabId = null;
            }
        }

        console.log('[GeminiWeb] No Shopee worker tab found, creating one...');
        const newTab = await browser.tabs.create({ url: 'https://shopee.co.id', active: true });
        this.workerTabId = newTab.id;
        await this.setTabKeepAlive(this.workerTabId);

        // Wait for page to fully load
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                browser.tabs.onUpdated.removeListener(listener);
                reject(new Error('Timeout waiting for Shopee tab to load'));
            }, 30000);

            const listener = (tabId, changeInfo) => {
                if (tabId === this.workerTabId && changeInfo.status === 'complete') {
                    clearTimeout(timeout);
                    browser.tabs.onUpdated.removeListener(listener);
                    resolve();
                }
            };
            browser.tabs.onUpdated.addListener(listener);
        });

        // Extra wait for content script initialization
        await new Promise(r => setTimeout(r, 3000));
    },

    /**
     * Wait for content script to be ready with retry
     */
    async waitForContentScript(tabId, maxAttempts = 10) {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const response = await browser.tabs.sendMessage(tabId, { action: 'ping' });
                if (response && response.success) {
                    console.log(`[GeminiWeb] Content script ready after ${attempt} attempt(s)`);
                    return true;
                }
            } catch (e) {
                console.log(`[GeminiWeb] Content script not ready, attempt ${attempt}/${maxAttempts}`);
            }
            await new Promise(r => setTimeout(r, 500));
        }
        throw new Error('Content script not responding after multiple attempts');
    }
};

// Export
if (typeof window !== 'undefined') {
    window.GeminiWebAPI = GeminiWebAPI;
}

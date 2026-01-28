/**
 * Shopee Shopping Assistant - Background Script
 * Handles communication between sidebar popup, content scripts, and Gemini API
 */

// Connection state management with message queue
const ConnectionManager = {
    ports: new Map(), // tabId -> port
    sidebarWindows: new Map(), // tabId -> windowId
    messageQueues: new Map(), // tabId -> Array of pending messages
    activeTabId: null, // Track which tab the sidebar is associated with

    setPort(tabId, port) {
        this.ports.set(tabId, port);
        this.flushQueue(tabId);
    },

    getPort(tabId) {
        return this.ports.get(tabId);
    },

    removePort(tabId) {
        this.ports.delete(tabId);
    },

    setSidebarWindow(tabId, windowId) {
        this.sidebarWindows.set(tabId, windowId);
    },

    getSidebarWindow(tabId) {
        return this.sidebarWindows.get(tabId);
    },

    queueMessage(tabId, message) {
        if (!this.messageQueues.has(tabId)) {
            this.messageQueues.set(tabId, []);
        }
        this.messageQueues.get(tabId).push(message);
    },

    flushQueue(tabId) {
        const port = this.ports.get(tabId);
        const queue = this.messageQueues.get(tabId);

        if (port && queue && queue.length > 0) {
            console.log('Flushing', queue.length, 'queued messages');
            for (const message of queue) {
                try {
                    port.postMessage(message);
                } catch (e) { }
            }
            this.messageQueues.set(tabId, []);
        }
    }
};

// Conversation state management
const ConversationManager = {
    conversations: new Map(),

    getOrCreate(tabId) {
        if (!this.conversations.has(tabId)) {
            this.conversations.set(tabId, {
                messages: [],
                isProcessing: false
            });
        }
        return this.conversations.get(tabId);
    },

    addMessage(tabId, role, content, parts = null) {
        const conversation = this.getOrCreate(tabId);
        conversation.messages.push({
            role,
            content,
            parts,
            timestamp: Date.now()
        });
    },

    // Add a raw message object (useful for tool calls/results)
    addPart(tabId, messageObj) {
        const conversation = this.getOrCreate(tabId);
        conversation.messages.push({
            ...messageObj,
            timestamp: Date.now()
        });
    },

    addToolCall(tabId, toolCall) {
        this.addPart(tabId, {
            role: 'model',
            parts: [{ functionCall: toolCall }]
        });
    },

    addToolResult(tabId, toolName, result) {
        this.addPart(tabId, {
            role: 'user',
            parts: [{
                functionResponse: {
                    name: toolName,
                    response: result
                }
            }]
        });
    },

    getMessages(tabId) {
        return this.getOrCreate(tabId).messages;
    },

    clear(tabId) {
        if (this.conversations.has(tabId)) {
            this.conversations.get(tabId).messages = [];
        }
    }
};


// Open sidebar in a popup window
async function openSidebarWindow(tabId) {
    const existingWindowId = ConnectionManager.getSidebarWindow(tabId);

    // Check if window already exists
    if (existingWindowId) {
        try {
            await browser.windows.update(existingWindowId, { focused: true });
            return existingWindowId;
        } catch (e) {
            // Window was closed, create new one
        }
    }

    // Create a new popup window
    const sidebarUrl = browser.runtime.getURL(`sidebar/sidebar.html?tabId=${tabId}`);
    const window = await browser.windows.create({
        url: sidebarUrl,
        type: 'popup',
        width: 420,
        height: 700,
        left: screen.width - 450,
        top: 100
    });

    ConnectionManager.setSidebarWindow(tabId, window.id);
    ConnectionManager.activeTabId = tabId;

    return window.id;
}

// Handle sidebar connection
browser.runtime.onConnect.addListener((port) => {
    if (port.name === 'sidebar') {
        console.log('Sidebar popup connected');

        // Get tabId from URL query param (passed when opening popup)
        port.onMessage.addListener(async (message) => {
            const tabId = message.tabId || ConnectionManager.activeTabId;

            if (message.action === 'init' && tabId) {
                ConnectionManager.setPort(tabId, port);
                ConnectionManager.activeTabId = tabId;

                // Send API key status
                port.postMessage({ action: 'apiKey', hasKey: !!(await GeminiAPI.getApiKey()) });

                // Send current model
                port.postMessage({ action: 'currentModel', model: await GeminiAPI.getModel() });

                // Send conversation history
                const history = ConversationManager.getMessages(tabId);
                port.postMessage({ action: 'conversationHistory', messages: history });
                return;
            }

            await handleSidebarMessage(message, port, tabId);
        });

        port.onDisconnect.addListener(() => {
            // Find and remove the port
            for (const [tabId, p] of ConnectionManager.ports) {
                if (p === port) {
                    ConnectionManager.removePort(tabId);
                    break;
                }
            }
        });
    }
});

// Helper to send message to sidebar
function sendToSidebar(tabId, message) {
    const port = ConnectionManager.getPort(tabId);
    if (port) {
        try {
            port.postMessage(message);
        } catch (e) {
            ConnectionManager.queueMessage(tabId, message);
        }
    } else {
        ConnectionManager.queueMessage(tabId, message);
    }
}

// Handle messages from sidebar
async function handleSidebarMessage(message, port, tabId) {
    console.log('Background received:', message.action);

    switch (message.action) {
        case 'sendMessage':
            await processUserMessage(message.text, tabId);
            break;

        case 'getConversation':
            const messages = ConversationManager.getMessages(tabId);
            port.postMessage({ action: 'conversationHistory', messages });
            break;

        case 'clearConversation':
            ConversationManager.clear(tabId);
            port.postMessage({ action: 'conversationCleared' });
            break;

        case 'setApiKey':
            try {
                await browser.storage.local.set({ geminiApiKey: message.apiKey });
                port.postMessage({ action: 'apiKeySet', success: true });
            } catch (error) {
                console.error('Failed to save API key:', error);
                port.postMessage({ action: 'apiKeySet', success: false, error: error.message });
            }
            break;

        case 'saveSettings':
            try {
                // Save API key if provided
                if (message.apiKey) {
                    await browser.storage.local.set({ geminiApiKey: message.apiKey });
                }
                // Save Serper key if provided
                if (message.serperKey) {
                    await browser.storage.local.set({ serperApiKey: message.serperKey });
                }
                // Always save model
                if (message.model) {
                    await browser.storage.local.set({ geminiModel: message.model });
                }
                port.postMessage({ action: 'settingsSaved', success: true });
            } catch (error) {
                port.postMessage({ action: 'settingsSaved', success: false, error: error.message });
            }
            break;

        case 'getApiKey':
            try {
                const result = await browser.storage.local.get('geminiApiKey');
                const hasKey = !!(result && result.geminiApiKey);
                port.postMessage({ action: 'apiKey', hasKey });
            } catch (error) {
                port.postMessage({ action: 'apiKey', hasKey: false });
            }
            break;

        case 'testTool':
            try {
                let testResult;

                // Route certain actions through ToolExecutor instead of content script
                if (message.toolAction === 'scrapeListings') {
                    // Use ToolExecutor for main page scrape
                    testResult = await ToolExecutor.scrapeListings(
                        message.toolParams?.maxItems || 1000,
                        tabId
                    );
                } else if (message.toolAction === 'deepScrapeUrls') {
                    // Use ToolExecutor for deep scraping specific URLs
                    testResult = await ToolExecutor.deepScrapeUrls(
                        message.toolParams?.urls || []
                    );
                } else if (message.toolAction === 'searchShopee') {
                    // Use ToolExecutor for search
                    testResult = await ToolExecutor.searchShopee(
                        message.toolParams?.keyword,
                        tabId
                    );
                } else if (message.toolAction === 'serperSearch') {
                    // Use ToolExecutor for serper search
                    testResult = await ToolExecutor.serperSearch(
                        message.toolParams?.query
                    );
                } else if (message.toolAction === 'waitForContent') {
                    // Check if content script is ready
                    try {
                        await ToolExecutor.waitForContentScript(tabId, message.toolParams?.timeout || 5000);
                        testResult = { success: true, message: 'Content script is ready' };
                    } catch (e) {
                        testResult = { success: false, error: e.message };
                    }
                } else {
                    // Send other actions directly to content script
                    testResult = await browser.tabs.sendMessage(tabId, {
                        action: message.toolAction,
                        ...message.toolParams
                    });
                }

                port.postMessage({ action: 'testToolResult', result: testResult });
            } catch (error) {
                port.postMessage({
                    action: 'testToolResult',
                    result: { error: error.message }
                });
            }
            break;
    }

    if (message.action === 'toggleFullscreen') {
        const winId = ConnectionManager.getSidebarWindow(tabId);
        if (winId) {
            try {
                const win = await browser.windows.get(winId);
                const newState = win.state === 'fullscreen' ? 'normal' : 'fullscreen';
                await browser.windows.update(winId, { state: newState });
            } catch (e) {
                console.error('Failed to toggle fullscreen:', e);
            }
        }
    }
}

// Process user message and get AI response
async function processUserMessage(text, tabId) {
    if (!tabId) return;

    const conversation = ConversationManager.getOrCreate(tabId);

    if (conversation.isProcessing) {
        sendToSidebar(tabId, {
            action: 'error',
            message: 'Already processing a message, please wait.'
        });
        return;
    }

    conversation.isProcessing = true;

    // Tool usage tracker - enforce limits to prevent loops
    const toolUsage = {
        search_shopee: 0,
        scrape_listings: 0,
        serper_search: 0
    };
    const TOOL_LIMITS = {
        search_shopee: 2,      // Allow retry
        scrape_listings: 2,    // Allow retry
        deep_scrape_urls: 2,   // Allow multiple batches
        serper_search: 5       // Allow extensive background checks
    };
    let scrapedData = null; // Store scraped data for rejection message

    // Add user message
    ConversationManager.addMessage(tabId, 'user', text);
    sendToSidebar(tabId, { action: 'messageAdded', role: 'user', content: text });

    // Start streaming indicator
    sendToSidebar(tabId, { action: 'streamStart' });

    try {
        let fullResponse = '';

        const onChunk = (chunk) => {
            fullResponse += chunk;
            sendToSidebar(tabId, { action: 'streamChunk', chunk });
        };

        const onToolCall = (toolCall) => {
            sendToSidebar(tabId, {
                action: 'toolCall',
                name: toolCall.name,
                args: toolCall.args
            });
        };

        const messages = ConversationManager.getMessages(tabId);
        let response = await GeminiAPI.sendMessage(messages, onChunk, onToolCall);

        // Process tool calls with limits
        let loopCount = 0;
        const MAX_LOOPS = 5; // Hard limit on tool call loops

        while (response.toolCalls && response.toolCalls.length > 0 && loopCount < MAX_LOOPS) {
            loopCount++;

            // Only process the FIRST tool call (sequential execution)
            // Gemini might return multiple parallel calls, but we handle them sequentially for updated context
            // actually, parallel execution is supported by the API design, but our loop logic needs care.
            // For now, let's process ALL tool calls in the response, THEN send results back.

            // Wait, Gemini 2.0/Pro returns an array of toolCalls.
            // We should execute all of them, record all results, then send back ONE message with all parts.
            // However, simpler for now: Sequential processing of the primary tool call if multiple are complex.
            // BUT, serper_search logic relies on parallel ";" check inside the tool.

            // Standard approach:
            // 1. Add model's tool calls to history
            // 2. Execute tools
            // 3. Add tool results to history
            // 4. Send updated history to model

            const toolCall = response.toolCalls[0]; // Take the first one for simplicity/safety in this loop
            const toolName = toolCall.name;

            // 1. Record the model's decision (Access the LATEST state)
            ConversationManager.addToolCall(tabId, toolCall);

            toolUsage[toolName] = (toolUsage[toolName] || 0) + 1;
            let result;

            // Check if tool has exceeded its limit
            const limit = TOOL_LIMITS[toolName] || 1;

            if (toolUsage[toolName] > limit) {
                console.log(`Tool ${toolName} exceeded limit (${toolUsage[toolName]}/${limit})`);
                result = {
                    error: 'LIMIT_REACHED',
                    message: `You have already used the ${toolName} tool in this turn. Do NOT call it again.`,
                    existingData: scrapedData
                };

                sendToSidebar(tabId, {
                    action: 'toolResult',
                    name: toolName,
                    result: { limited: true, error: result.error }
                });
            } else {
                sendToSidebar(tabId, { action: 'toolExecuting', name: toolName });

                result = await ToolExecutor.execute(
                    toolName,
                    toolCall.args,
                    tabId,
                    (current, total) => {
                        sendToSidebar(tabId, {
                            action: 'toolProgress',
                            name: toolName,
                            current,
                            total
                        });
                    }
                );

                if (toolName === 'scrape_listings' && result.data) {
                    scrapedData = result.data;
                }

                sendToSidebar(tabId, {
                    action: 'toolResult',
                    name: toolName,
                    result
                });
            }

            // 2. Record the result
            ConversationManager.addToolResult(tabId, toolName, result);

            // 3. Get next step from AI using UPDATED history
            fullResponse = ''; // Reset buffer for next text
            const currentMessages = ConversationManager.getMessages(tabId);
            response = await GeminiAPI.sendMessage(currentMessages, onChunk, onToolCall);
        }

        if (loopCount >= MAX_LOOPS) {
            console.log('Max tool loops reached, forcing response');
        }

        if (fullResponse) {
            // The final response is already streaming via onChunk, but we need to save it to history
            ConversationManager.addMessage(tabId, 'assistant', fullResponse);
        }

        sendToSidebar(tabId, { action: 'streamEnd' });

    } catch (error) {
        console.error('Error processing message:', error);
        sendToSidebar(tabId, {
            action: 'error',
            message: error.message
        });
    } finally {
        conversation.isProcessing = false;
    }
}

// Handle browser action click - open popup window
browser.browserAction.onClicked.addListener(async (tab) => {
    await openSidebarWindow(tab.id);
});

// Handle messages from content script (FAB click)
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'openSidebarWindow' && sender.tab) {
        openSidebarWindow(sender.tab.id);
        sendResponse({ success: true });
    }
    return true;
});

// Clean up closed sidebar windows
browser.windows.onRemoved.addListener((windowId) => {
    for (const [tabId, wId] of ConnectionManager.sidebarWindows) {
        if (wId === windowId) {
            ConnectionManager.sidebarWindows.delete(tabId);
            break;
        }
    }
});

console.log('Shopee Shopping Assistant background script loaded');

/**
 * Shopee Shopping Assistant - Background Script
 * Handles communication between sidebar popup, content scripts, and Gemini API
 */

importScripts(
    'lib/browser-polyfill.js',
    'lib/instructions.js',
    'lib/gemini.js',
    'lib/gemini-web.js',
    'lib/deep-scrape-manager.js',
    'lib/tools.js'
);

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
            try {
                await browser.windows.update(existingWindowId, { focused: true, alwaysOnTop: true });
                return existingWindowId;
            } catch (error) {
                await browser.windows.update(existingWindowId, { focused: true });
                return existingWindowId;
            }
        } catch (e) {
            // Window was closed, create new one
        }
    }

    // Create a new popup window
    const sidebarUrl = browser.runtime.getURL(`sidebar/sidebar.html?tabId=${tabId}`);
    let left;
    try {
        const currentWindow = await browser.windows.getCurrent();
        if (typeof currentWindow.left === 'number' && typeof currentWindow.width === 'number') {
            left = Math.max(0, currentWindow.left + currentWindow.width - 450);
        }
    } catch (error) {
        console.warn('Unable to determine window position:', error);
    }
    const windowOptions = {
        url: sidebarUrl,
        type: 'popup',
        width: 420,
        height: 700,
        top: 100
    };
    if (typeof left === 'number') {
        windowOptions.left = left;
    }
    const window = await browser.windows.create(windowOptions);
    try {
        await browser.windows.update(window.id, { alwaysOnTop: true });
    } catch (error) {
        // Ignore if not supported
    }

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

                // Send current settings
                const settings = await browser.storage.local.get(['geminiModel', 'apiMode', 'geminiUrl', 'geminiMode']);
                port.postMessage({
                    action: 'currentSettings',
                    model: settings.geminiModel,
                    apiMode: settings.apiMode,
                    geminiUrl: settings.geminiUrl,
                    geminiMode: settings.geminiMode || 'fast'
                });

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
                // Save API mode
                if (message.apiMode) {
                    await browser.storage.local.set({ apiMode: message.apiMode });
                }
                // Save Gemini URL if provided
                if (message.geminiUrl) {
                    await browser.storage.local.set({ geminiUrl: message.geminiUrl });
                }
                // Save Gemini Mode if provided
                if (message.geminiMode) {
                    await browser.storage.local.set({ geminiMode: message.geminiMode });
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

    // Handle stop generation request
    if (message.action === 'stopGeneration') {
        console.log('[Background] Stop generation requested for tab:', tabId);
        const conversation = ConversationManager.getOrCreate(tabId);
        conversation.isProcessing = false;
        conversation.abortRequested = true;

        // If using Web API, try to abort it
        if (typeof GeminiWebAPI !== 'undefined' && GeminiWebAPI.abortRequested !== undefined) {
            GeminiWebAPI.abortRequested = true;
        }

        // Send stream end to cleanup UI
        sendToSidebar(tabId, { action: 'streamEnd' });
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
    conversation.abortRequested = false; // Reset abort flag for new message

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

        // Progress callback for multi-step tools like deep_scrape_urls
        const onProgress = (current, total, toolName) => {
            sendToSidebar(tabId, {
                action: 'toolProgress',
                name: toolName,
                current,
                total
            });
        };

        // Tool result callback for when tools complete
        const onToolResult = (toolName, success) => {
            sendToSidebar(tabId, {
                action: 'toolResult',
                name: toolName,
                success
            });
        };

        let messages = ConversationManager.getMessages(tabId);

        // Choose API based on settings
        const settings = await browser.storage.local.get('apiMode');
        let response;

        if (settings.apiMode === 'web') {
            // Use Browser Web API - pass progress and result callbacks for tool updates
            const sidebarWindowId = ConnectionManager.getSidebarWindow(tabId);
            if (typeof GeminiWebAPI !== 'undefined' && GeminiWebAPI.setContext) {
                GeminiWebAPI.setContext({ tabId, uiWindowId: sidebarWindowId });
            }
            response = await GeminiWebAPI.sendMessage(messages, onChunk, onToolCall, onProgress, onToolResult);
            // Web API handles its own tool loop internally and returns finalized text/response
            // But if we want to support the SAME tool loop logic here, we need GeminiWebAPI to return structure?
            // Current GeminiWebAPI implementation handles the loop internally and returns { text: "final" }.
            // So we just use that.
        } else {
            // Use Native API
            response = await GeminiAPI.sendMessage(messages, onChunk, onToolCall);
        }

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
            messages = ConversationManager.getMessages(tabId);

            // Choose API based on settings
            // settings is already declared and fetched outside the loop, no need to redeclare or refetch
            // let response; // response is already declared outside the loop

            if (settings.apiMode === 'web') {
                // Use Browser Web API
                const sidebarWindowId = ConnectionManager.getSidebarWindow(tabId);
                if (typeof GeminiWebAPI !== 'undefined' && GeminiWebAPI.setContext) {
                    GeminiWebAPI.setContext({ tabId, uiWindowId: sidebarWindowId });
                }
                response = await GeminiWebAPI.sendMessage(messages, onChunk, onToolCall);
                // Web API handles its own tool loop internally and returns finalized text/response
                // But if we want to support the SAME tool loop logic here, we need GeminiWebAPI to return structure?
                // Current GeminiWebAPI implementation handles the loop internally and returns { text: "final" }.
                // So we just use that.
            } else {
                // Use Native API
                response = await GeminiAPI.sendMessage(messages, onChunk, onToolCall);
            }
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
const actionApi = browser.action || browser.browserAction;
if (actionApi && actionApi.onClicked) {
    actionApi.onClicked.addListener(async (tab) => {
        await openSidebarWindow(tab.id);
    });
}

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

// ============================================================================
// REMOTE CONNECTION MANAGER - Azure VM WebSocket Bridge
// ============================================================================

const RemoteConnectionManager = {
    socket: null,
    // Use ws:// (non-SSL) for easier setup - change to wss:// if using proper SSL certs
    serverUrl: 'ws://mullion.indonesiacentral.cloudapp.azure.com:5000',
    isConnected: false,
    reconnectAttempts: 0,
    maxReconnectAttempts: Infinity,
    reconnectDelay: 1000,
    maxReconnectDelay: 30000,
    enabled: true, // Can be disabled if not using remote feature

    async init() {
        // Load settings from storage
        const settings = await browser.storage.local.get(['remoteServerUrl', 'remoteEnabled']);

        if (settings.remoteServerUrl) {
            this.serverUrl = settings.remoteServerUrl;
        }

        // Allow disabling remote connection
        if (settings.remoteEnabled === false) {
            console.log('[Remote] Remote connection disabled in settings');
            this.enabled = false;
            return;
        }

        console.log('[Remote] Initializing connection to:', this.serverUrl);
        this.connect();
    },

    connect() {
        if (!this.enabled) return;

        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            return;
        }

        // Ensure we have the correct WebSocket URL format
        let wsUrl = this.serverUrl;
        if (wsUrl.startsWith('https://')) {
            wsUrl = wsUrl.replace('https://', 'wss://');
        } else if (!wsUrl.startsWith('wss://') && !wsUrl.startsWith('ws://')) {
            wsUrl = 'wss://' + wsUrl;
        }

        const fullUrl = wsUrl + '/socket.io/?EIO=4&transport=websocket';
        console.log('[Remote] Connecting to:', fullUrl);

        try {
            this.socket = new WebSocket(fullUrl);

            this.socket.onopen = () => {
                console.log('[Remote] WebSocket connected');
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.reconnectDelay = 1000;

                // Send Socket.IO handshake
                this.socket.send('40');

                // Register as extension after handshake
                setTimeout(() => {
                    this.emit('register_extension', {
                        tab_id: ConnectionManager.activeTabId
                    });
                }, 500);
            };

            this.socket.onmessage = (event) => {
                this.handleMessage(event.data);
            };

            this.socket.onclose = () => {
                console.log('[Remote] WebSocket closed');
                this.isConnected = false;
                this.scheduleReconnect();
            };

            this.socket.onerror = (error) => {
                console.error('[Remote] WebSocket error:', error);
            };
        } catch (error) {
            console.error('[Remote] Connection failed:', error);
            this.scheduleReconnect();
        }
    },

    scheduleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log('[Remote] Max reconnection attempts reached');
            return;
        }

        this.reconnectAttempts++;
        const delay = Math.min(this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1), this.maxReconnectDelay);

        console.log(`[Remote] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
        setTimeout(() => this.connect(), delay);
    },

    handleMessage(data) {
        // Parse Socket.IO protocol
        if (data === '2') {
            // Ping - respond with pong
            this.socket.send('3');
            return;
        }

        if (data.startsWith('42')) {
            // Event message
            try {
                const parsed = JSON.parse(data.substring(2));
                const [eventName, eventData] = parsed;
                this.handleEvent(eventName, eventData);
            } catch (e) {
                console.error('[Remote] Failed to parse message:', e);
            }
        }
    },

    async handleEvent(eventName, data) {
        console.log('[Remote] Event:', eventName, data);

        switch (eventName) {
            case 'registered':
                console.log('[Remote] Registered with server');
                break;

            case 'execute_tool':
                await this.executeTool(data);
                break;

            case 'process_ai_message':
                // Route AI message through extension's conversation system
                await this.processAIMessage(data);
                break;

            case 'ping_from_server':
                // Respond to ping test immediately
                console.log('[Remote] Ping received from server, sending pong');
                this.emit('pong_from_extension', { request_id: data.request_id });
                break;
        }
    },

    async processAIMessage(data) {
        const { request_id, session_id, text } = data;
        console.log('[Remote] Processing AI message:', text);

        try {
            // Get active tab
            const tabId = ConnectionManager.activeTabId;
            if (!tabId) {
                this.emit('ai_response_error', {
                    request_id,
                    error: 'No active Shopee tab. Please open Shopee in the browser.'
                });
                return;
            }

            // Get conversation from ConversationManager  
            const conversation = ConversationManager.getOrCreate(tabId);

            // Add user message
            ConversationManager.addMessage(tabId, 'user', text);

            // Get messages for GeminiWebAPI
            const messages = ConversationManager.getMessages(tabId);

            // Callbacks for streaming
            const onChunk = (chunk) => {
                this.emit('ai_stream_chunk', { request_id, chunk });
            };

            const onToolCall = (toolName, args) => {
                this.emit('ai_tool_call', { request_id, name: toolName, args });
            };

            const onProgress = (toolName, current, total) => {
                this.emit('ai_tool_executing', { request_id, name: toolName });
            };

            const onToolResult = (toolName, success) => {
                this.emit('ai_tool_result', { request_id, name: toolName, success });
            };

            // Set context for GeminiWebAPI
            if (typeof GeminiWebAPI !== 'undefined' && GeminiWebAPI.setContext) {
                GeminiWebAPI.setContext({ tabId, uiWindowId: null });
            }

            // Use GeminiWebAPI - handles tool loops internally, uses gemini.google.com (no API key!)
            const response = await GeminiWebAPI.sendMessage(messages, onChunk, onToolCall, onProgress, onToolResult);

            // Save assistant response
            if (response && response.text) {
                ConversationManager.addMessage(tabId, 'assistant', response.text);
            }

            // Signal completion
            this.emit('ai_response_complete', { request_id });

        } catch (error) {
            console.error('[Remote] AI processing error:', error);
            this.emit('ai_response_error', {
                request_id,
                error: error.message || 'Failed to process AI message'
            });
        }
    },

    async executeTool(data) {
        const { request_id, tool_name, args } = data;
        const tabId = ConnectionManager.activeTabId;

        console.log(`[Remote] Executing tool: ${tool_name}`, args);

        let result;
        try {
            result = await ToolExecutor.execute(tool_name, args, tabId, (current, total) => {
                // Send progress updates to server
                this.emit('tool_progress', {
                    request_id,
                    name: tool_name,
                    current,
                    total
                });
            });
        } catch (error) {
            result = { error: error.message };
        }

        // Send result back to server
        this.emit('tool_result', {
            request_id,
            result
        });
    },

    emit(eventName, data) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            const message = JSON.stringify([eventName, data]);
            console.log('[Remote] Emitting:', eventName, data?.chunk?.substring?.(0, 50) || data);
            this.socket.send('42' + message);
        } else {
            console.warn('[Remote] Cannot emit, socket not open:', eventName);
        }
    },

    disconnect() {
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
        this.isConnected = false;
    }
};

// Initialize remote connection when extension loads
// Delayed to ensure other managers are ready
setTimeout(() => {
    RemoteConnectionManager.init().catch(e => {
        console.error('[Remote] Failed to initialize:', e);
    });
}, 2000);

console.log('Shopee Shopping Assistant background script loaded');


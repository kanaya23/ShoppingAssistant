/**
 * Shopee Shopping Assistant - Background Script
 * Handles communication between sidebar, content scripts, and Gemini API
 */

// Connection state management
const ConnectionManager = {
    ports: new Map(), // tabId -> port
    sidebarStates: new Map(), // tabId -> boolean (isOpen)

    setPort(tabId, port) {
        this.ports.set(tabId, port);
    },

    getPort(tabId) {
        return this.ports.get(tabId);
    },

    removePort(tabId) {
        if (this.ports.has(tabId)) {
            const currentPort = this.ports.get(tabId);
            // Only remove if it's the specific port instance (avoid race conditions)
            // But here we likely want to just clean up
            this.ports.delete(tabId);
        }
    },

    setSidebarState(tabId, isOpen) {
        this.sidebarStates.set(tabId, isOpen);
    },

    isSidebarOpen(tabId) {
        return this.sidebarStates.get(tabId) || false;
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

    getMessages(tabId) {
        return this.getOrCreate(tabId).messages;
    },

    clear(tabId) {
        if (this.conversations.has(tabId)) {
            this.conversations.get(tabId).messages = [];
        }
    }
};

// Handle sidebar connection
browser.runtime.onConnect.addListener((port) => {
    if (port.name === 'sidebar') {
        console.log('Sidebar connected');

        // For injected iframe, sender.tab.id IS available
        if (port.sender && port.sender.tab) {
            const tabId = port.sender.tab.id;
            ConnectionManager.setPort(tabId, port);
            ConnectionManager.setSidebarState(tabId, true);

            port.onDisconnect.addListener(() => {
                const currentPort = ConnectionManager.getPort(tabId);
                if (currentPort === port) {
                    ConnectionManager.removePort(tabId);
                }
                console.log('Sidebar disconnected for tab', tabId);
            });
        }

        port.onMessage.addListener(async (message) => {
            await handleSidebarMessage(message, port);
        });
    }
});

// Restore sidebar state after navigation
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete') {
        if (ConnectionManager.isSidebarOpen(tabId)) {
            console.log('Restoring sidebar for tab', tabId);
            // Send message to content script to open sidebar
            // We use a small delay to ensure content script is ready
            setTimeout(() => {
                browser.tabs.sendMessage(tabId, { action: 'openSidebar' }).catch(err => {
                    // Content script might not be ready or page not compatible
                    console.log('Could not restore sidebar:', err);
                });
            }, 1000);
        }
    }
});

// Helper to send message to sidebar
function sendToSidebar(tabId, message) {
    const port = ConnectionManager.getPort(tabId);
    if (port) {
        try {
            port.postMessage(message);
        } catch (e) {
            console.error('Failed to send to sidebar:', e);
            ConnectionManager.removePort(tabId);
        }
    }
}

// Handle messages from sidebar
async function handleSidebarMessage(message, port) {
    console.log('Background received message:', message);

    // Use the sender's tab ID for conversation tracking
    const tabId = port.sender?.tab?.id || message.tabId;

    if (message.action === 'init') {
        if (tabId) {
            ConnectionManager.setPort(tabId, port);
            ConnectionManager.setSidebarState(tabId, true);
        }

        // Initialize the sidebar state
        port.postMessage({ action: 'apiKey', hasKey: !!(await GeminiAPI.getApiKey()) });

        if (tabId) {
            const history = ConversationManager.getMessages(tabId);
            port.postMessage({ action: 'conversationHistory', messages: history });
        }
        return;
    }

    if (!tabId) {
        console.error('No tab ID found for message');
        return;
    }

    switch (message.action) {
        case 'sendMessage':
            // Don't pass 'port', allow processUserMessage to look it up
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
                console.log('API key saved successfully');
                port.postMessage({ action: 'apiKeySet', success: true });
            } catch (error) {
                console.error('Failed to save API key:', error);
                port.postMessage({ action: 'apiKeySet', success: false, error: error.message });
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
            // Forward test tool request to content script
            try {
                const testResult = await browser.tabs.sendMessage(tabId, {
                    action: message.toolAction,
                    ...message.toolParams
                });
                port.postMessage({ action: 'testToolResult', result: testResult });
            } catch (error) {
                port.postMessage({
                    action: 'testToolResult',
                    result: { error: error.message }
                });
            }
            break;
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

    // Add user message
    ConversationManager.addMessage(tabId, 'user', text);
    sendToSidebar(tabId, { action: 'messageAdded', role: 'user', content: text });

    // Start streaming indicator
    sendToSidebar(tabId, { action: 'streamStart' });

    try {
        let fullResponse = '';
        let pendingToolCalls = [];

        // Stream callback
        const onChunk = (chunk) => {
            fullResponse += chunk;
            sendToSidebar(tabId, { action: 'streamChunk', chunk });
        };

        // Tool call callback
        const onToolCall = (toolCall) => {
            pendingToolCalls.push(toolCall);
            sendToSidebar(tabId, {
                action: 'toolCall',
                name: toolCall.name,
                args: toolCall.args
            });
        };

        // Send to Gemini
        const messages = ConversationManager.getMessages(tabId);
        let response = await GeminiAPI.sendMessage(messages, onChunk, onToolCall);

        // Process tool calls if any
        while (response.toolCalls && response.toolCalls.length > 0) {
            for (const toolCall of response.toolCalls) {
                sendToSidebar(tabId, {
                    action: 'toolExecuting',
                    name: toolCall.name
                });

                // Execute the tool
                const result = await ToolExecutor.execute(
                    toolCall.name,
                    toolCall.args,
                    tabId
                );

                sendToSidebar(tabId, {
                    action: 'toolResult',
                    name: toolCall.name,
                    result
                });

                // Continue conversation with tool result
                fullResponse = '';
                response = await GeminiAPI.continueWithToolResult(
                    messages,
                    toolCall.name,
                    result,
                    onChunk,
                    onToolCall
                );
            }
        }

        // Add assistant response
        if (fullResponse) {
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

// Handle browser action click - toggle sidebar via content script
browser.browserAction.onClicked.addListener(async (tab) => {
    try {
        const isOpen = ConnectionManager.isSidebarOpen(tab.id);
        // Toggle logic
        ConnectionManager.setSidebarState(tab.id, !isOpen);

        await browser.tabs.sendMessage(tab.id, { action: 'toggleSidebar' });
    } catch (error) {
        console.error('Failed to toggle sidebar:', error);
    }
});

// Handle messages from content script
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Content script listeners
    if (message.action === 'toggleSidebar') {
        if (sender.tab) {
            // We can't know the exact new state from here easily, but we can assume user action toggles it
            const currentState = ConnectionManager.isSidebarOpen(sender.tab.id);
            ConnectionManager.setSidebarState(sender.tab.id, !currentState);
        }
        sendResponse({ success: true });
    }
    return true;
});

// Initialize
console.log('Shopee Shopping Assistant background script loaded');

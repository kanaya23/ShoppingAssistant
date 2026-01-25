/**
 * Shopee Shopping Assistant - Sidebar Script
 * Handles UI interactions and communication with background script
 */

(function () {
    'use strict';

    // DOM Elements
    const chatContainer = document.getElementById('chat-container');
    const welcomeMessage = document.getElementById('welcome-message');
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const clearBtn = document.getElementById('clear-btn');
    const settingsBtn = document.getElementById('settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    const modalClose = document.getElementById('modal-close');
    const apiKeyInput = document.getElementById('api-key-input');
    const toggleKeyBtn = document.getElementById('toggle-key');
    const saveApiKeyBtn = document.getElementById('save-api-key');
    const apiKeyBanner = document.getElementById('api-key-banner');
    const openSettingsBanner = document.getElementById('open-settings-banner');
    const toolStatus = document.getElementById('tool-status');
    const toolStatusText = document.getElementById('tool-status-text');
    const suggestionChips = document.querySelectorAll('.suggestion-chip');

    // State
    let port = null;
    let isStreaming = false;
    let currentStreamingMessage = null;

    // Connect to background script
    function connect() {
        try {
            // Handle cross-browser compatibility
            const runtime = (typeof browser !== 'undefined' ? browser : chrome).runtime;

            port = runtime.connect({ name: 'sidebar' });

            port.onMessage.addListener(handleMessage);

            port.onDisconnect.addListener(() => {
                console.log('Disconnected from background, reconnecting...');
                port = null;
                setTimeout(connect, 2000);
            });

            // Init request - background will infer tabId from sender
            port.postMessage({ action: 'init' });

        } catch (e) {
            console.error('Connection failed:', e);
            port = null;
            setTimeout(connect, 2000);
        }
    }

    // Handle messages from background
    function handleMessage(message) {
        console.log('Sidebar received:', message);

        switch (message.action) {
            case 'messageAdded':
                if (message.role === 'user') {
                    addMessage(message.content, 'user');
                    hideWelcome();
                }
                break;

            case 'streamStart':
                isStreaming = true;
                startStreamingMessage();
                break;

            case 'streamChunk':
                appendToStreamingMessage(message.chunk);
                break;

            case 'streamEnd':
                isStreaming = false;
                finalizeStreamingMessage();
                break;

            case 'toolCall':
                showToolStatus(`Using tool: ${formatToolName(message.name)}...`);
                addToolBadge(message.name, 'executing');
                break;

            case 'toolExecuting':
                showToolStatus(`Executing: ${formatToolName(message.name)}...`);
                break;

            case 'toolResult':
                updateToolBadge(message.name, 'complete');
                showToolStatus(`Completed: ${formatToolName(message.name)}`);
                setTimeout(hideToolStatus, 1500);
                break;

            case 'error':
                hideToolStatus();
                addErrorMessage(message.message);
                isStreaming = false;
                break;

            case 'conversationHistory':
                loadConversationHistory(message.messages);
                break;

            case 'conversationCleared':
                clearChat();
                break;

            case 'apiKey':
                if (!message.hasKey) {
                    showApiKeyBanner();
                } else {
                    hideApiKeyBanner();
                }
                break;

            case 'apiKeySet':
                if (message.success) {
                    hideApiKeyBanner();
                    closeSettingsModal();
                    showToast('API key saved successfully!', true);
                } else {
                    showToast('Failed to save API key: ' + (message.error || 'Unknown error'), false);
                }
                break;

            case 'testToolResult':
                // Handle test mode results
                const testOutput = document.getElementById('test-output-content');
                if (testOutput) {
                    testOutput.textContent = JSON.stringify(message.result, null, 2);
                }
                break;
        }
    }

    // Add a message to the chat
    function addMessage(content, role) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${role}`;

        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.innerHTML = formatMarkdown(content);

        messageDiv.appendChild(contentDiv);
        chatContainer.appendChild(messageDiv);
        scrollToBottom();

        return messageDiv;
    }

    // Start a streaming message
    function startStreamingMessage() {
        hideWelcome();

        const messageDiv = document.createElement('div');
        messageDiv.className = 'message assistant';
        messageDiv.id = 'streaming-message';

        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';

        messageDiv.appendChild(contentDiv);
        chatContainer.appendChild(messageDiv);
        scrollToBottom();

        currentStreamingMessage = { div: messageDiv, content: '' };
    }

    // Append to streaming message
    function appendToStreamingMessage(chunk) {
        if (!currentStreamingMessage) return;

        currentStreamingMessage.content += chunk;
        const contentDiv = currentStreamingMessage.div.querySelector('.message-content');
        contentDiv.innerHTML = formatMarkdown(currentStreamingMessage.content);
        scrollToBottom();
    }

    // Finalize streaming message
    function finalizeStreamingMessage() {
        if (!currentStreamingMessage) return;

        const contentDiv = currentStreamingMessage.div.querySelector('.message-content');
        if (currentStreamingMessage.content) {
            contentDiv.innerHTML = formatMarkdown(currentStreamingMessage.content);
        } else {
            // Remove empty message
            currentStreamingMessage.div.remove();
        }

        currentStreamingMessage = null;
        scrollToBottom();
    }

    // Add tool execution badge
    function addToolBadge(toolName, status) {
        const badge = document.createElement('div');
        badge.className = `tool-call-badge ${status}`;
        badge.dataset.tool = toolName;
        badge.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z"/>
      </svg>
      <span>${formatToolName(toolName)}</span>
    `;

        if (currentStreamingMessage) {
            currentStreamingMessage.div.querySelector('.message-content').appendChild(badge);
        } else {
            chatContainer.appendChild(badge);
        }
        scrollToBottom();
    }

    // Update tool badge status
    function updateToolBadge(toolName, status) {
        const badge = document.querySelector(`.tool-call-badge[data-tool="${toolName}"]`);
        if (badge) {
            badge.className = `tool-call-badge ${status}`;
        }
    }

    // Add error message
    function addErrorMessage(error) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
      </svg>
      <span>${escapeHtml(error)}</span>
    `;
        chatContainer.appendChild(errorDiv);
        scrollToBottom();
    }

    // Show tool status bar
    function showToolStatus(text) {
        toolStatusText.textContent = text;
        toolStatus.classList.add('visible');
    }

    // Hide tool status bar
    function hideToolStatus() {
        toolStatus.classList.remove('visible');
    }

    // Format tool name for display
    function formatToolName(name) {
        return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

    // Format markdown content
    function formatMarkdown(content) {
        if (!content) return '';

        let html = escapeHtml(content);

        // Code blocks
        html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');

        // Inline code
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

        // Bold
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

        // Italic
        html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

        // Links
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

        // Headers
        html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
        html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

        // Lists
        html = html.replace(/^\* (.+)$/gm, '<li>$1</li>');
        html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
        html = html.replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>');

        // Wrap consecutive list items
        html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

        // Paragraphs
        html = html.replace(/\n\n/g, '</p><p>');
        html = html.replace(/\n/g, '<br>');

        // Clean up
        html = '<p>' + html + '</p>';
        html = html.replace(/<p><\/p>/g, '');
        html = html.replace(/<p>(<h[1-3]>)/g, '$1');
        html = html.replace(/(<\/h[1-3]>)<\/p>/g, '$1');
        html = html.replace(/<p>(<ul>)/g, '$1');
        html = html.replace(/(<\/ul>)<\/p>/g, '$1');
        html = html.replace(/<p>(<pre>)/g, '$1');
        html = html.replace(/(<\/pre>)<\/p>/g, '$1');

        return html;
    }

    // Escape HTML
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Load conversation history
    function loadConversationHistory(messages) {
        if (!messages || messages.length === 0) {
            showWelcome();
            return;
        }

        hideWelcome();

        messages.forEach(msg => {
            if (msg.content) {
                addMessage(msg.content, msg.role);
            }
        });
    }

    // Clear chat
    function clearChat() {
        // Remove all messages except welcome
        const messages = chatContainer.querySelectorAll('.message, .tool-call-badge, .error-message');
        messages.forEach(m => m.remove());
        showWelcome();
        // Clear background state
        if (port) port.postMessage({ action: 'clearConversation' });
    }

    // Show/hide welcome message
    function showWelcome() {
        welcomeMessage.style.display = 'block';
    }

    function hideWelcome() {
        welcomeMessage.style.display = 'none';
    }

    // Scroll to bottom of chat
    function scrollToBottom() {
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    // Send message
    function sendMessage() {
        const text = messageInput.value.trim();
        if (!text || isStreaming) return;

        if (!port) {
            showToast('Connection lost. Reconnecting...', false);
            connect();
            return;
        }

        port.postMessage({
            action: 'sendMessage',
            text: text
        });

        messageInput.value = '';
        updateSendButton();
        autoResizeInput();
    }

    // Update send button state
    function updateSendButton() {
        sendBtn.disabled = !messageInput.value.trim() || isStreaming;
    }

    // Auto-resize textarea
    function autoResizeInput() {
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
    }

    // Settings modal functions
    function openSettingsModal() {
        settingsModal.classList.add('visible');
    }

    function closeSettingsModal() {
        settingsModal.classList.remove('visible');
    }

    function toggleApiKeyVisibility() {
        const type = apiKeyInput.type === 'password' ? 'text' : 'password';
        apiKeyInput.type = type;
    }

    function saveApiKey() {
        const apiKey = apiKeyInput.value.trim();
        if (!apiKey) return;

        if (!port) {
            showToast('Connection lost. Reconnecting...', false);
            connect();
            return;
        }

        port.postMessage({
            action: 'setApiKey',
            apiKey: apiKey
        });

        apiKeyInput.value = '';
    }

    // API key banner
    function showApiKeyBanner() {
        apiKeyBanner.classList.add('visible');
    }

    function hideApiKeyBanner() {
        apiKeyBanner.classList.remove('visible');
    }

    // Show toast notification
    function showToast(message, isSuccess = true) {
        // Create toast element
        const toast = document.createElement('div');
        toast.className = 'toast-notification';
        toast.style.cssText = `
            position: fixed;
            bottom: 120px;
            left: 50%;
            transform: translateX(-50%);
            background: ${isSuccess ? '#10B981' : '#EF4444'};
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            font-size: 13px;
            z-index: 1000;
            animation: fadeInUp 0.3s ease;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        `;
        toast.textContent = message;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.3s';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // Event Listeners
    messageInput.addEventListener('input', () => {
        updateSendButton();
        autoResizeInput();
    });

    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    sendBtn.addEventListener('click', sendMessage);

    clearBtn.addEventListener('click', () => {
        if (confirm('Clear conversation history?')) {
            clearChat(); // Action sent inside clearChat if port exists
        }
    });

    settingsBtn.addEventListener('click', openSettingsModal);
    modalClose.addEventListener('click', closeSettingsModal);
    toggleKeyBtn.addEventListener('click', toggleApiKeyVisibility);
    saveApiKeyBtn.addEventListener('click', saveApiKey);
    openSettingsBanner.addEventListener('click', openSettingsModal);

    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
            closeSettingsModal();
        }
    });

    // Suggestion chips
    suggestionChips.forEach(chip => {
        chip.addEventListener('click', () => {
            const message = chip.dataset.message;
            if (message) {
                messageInput.value = message;
                updateSendButton();
                sendMessage();
            }
        });
    });

    // ============ TEST MODE ============
    const testPanel = document.getElementById('test-panel');
    const testModeBtn = document.getElementById('test-mode-btn');
    const closeTestPanelBtn = document.getElementById('close-test-panel');
    const testOutput = document.getElementById('test-output-content');

    // Test mode elements
    const testSearchBtn = document.getElementById('test-search-btn');
    const testSearchKeyword = document.getElementById('test-search-keyword');
    const testScrapeBtn = document.getElementById('test-scrape-btn');
    const testScrapeMax = document.getElementById('test-scrape-max');
    const testPageInfoBtn = document.getElementById('test-pageinfo-btn');
    const testWaitContentBtn = document.getElementById('test-waitcontent-btn');

    function toggleTestPanel() {
        testPanel.classList.toggle('visible');
    }

    function setTestOutput(data) {
        testOutput.textContent = JSON.stringify(data, null, 2);
    }

    // Send test tool request through the background script
    function runTestTool(action, params = {}) {
        if (!port) {
            setTestOutput({ error: 'Not connected to background script' });
            return;
        }

        setTestOutput({ status: 'Running...', action, params });

        // Send to background, which will forward to content script
        port.postMessage({
            action: 'testTool',
            toolAction: action,
            toolParams: params
        });
    }

    if (testModeBtn) {
        testModeBtn.addEventListener('click', toggleTestPanel);
    }

    if (closeTestPanelBtn) {
        closeTestPanelBtn.addEventListener('click', toggleTestPanel);
    }

    if (testSearchBtn) {
        testSearchBtn.addEventListener('click', async () => {
            const keyword = testSearchKeyword.value.trim();
            if (!keyword) {
                setTestOutput({ error: 'Please enter a keyword' });
                return;
            }
            await runTestTool('searchShopee', { keyword });
        });
    }

    if (testScrapeBtn) {
        testScrapeBtn.addEventListener('click', async () => {
            const maxItems = parseInt(testScrapeMax.value) || 20;
            await runTestTool('scrapeListings', { maxItems });
        });
    }

    if (testPageInfoBtn) {
        testPageInfoBtn.addEventListener('click', async () => {
            await runTestTool('getPageInfo', {});
        });
    }

    if (testWaitContentBtn) {
        testWaitContentBtn.addEventListener('click', async () => {
            await runTestTool('waitForContent', { timeout: 10000 });
        });
    }

    // Initialize
    connect();
})();

/**
 * Shopee Shopping Assistant - Sidebar Script
 * Handles UI interactions and communication with background script
 * Runs in a POPUP WINDOW (separate from the main page)
 */

(function () {
    'use strict';

    // DOM Elements
    const chatContainer = document.getElementById('chat-container');
    const welcomeMessage = document.getElementById('welcome-message');
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const stopBtn = document.getElementById('stop-btn');
    const fullscreenBtn = document.getElementById('fullscreen-btn');
    const clearBtn = document.getElementById('clear-btn');
    const settingsBtn = document.getElementById('settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    const modalClose = document.getElementById('modal-close');
    const apiKeyInput = document.getElementById('api-key-input');
    const toggleKeyBtn = document.getElementById('toggle-key');
    const serperKeyInput = document.getElementById('serper-key-input');
    const toggleSerperKeyBtn = document.getElementById('toggle-serper-key');
    const saveApiKeyBtn = document.getElementById('save-api-key');
    const apiKeyBanner = document.getElementById('api-key-banner');
    const openSettingsBanner = document.getElementById('open-settings-banner');
    const toolStatus = document.getElementById('tool-status');
    const toolStatusText = document.getElementById('tool-status-text');
    const suggestionChips = document.querySelectorAll('.suggestion-chip');
    const modeToggleBtn = document.getElementById('mode-toggle-btn');

    // State
    let port = null;
    let isStreaming = false;
    let currentStreamingMessage = null;
    let tabId = null;
    let singlePickMode = false; // Mode toggle state
    let deepScrapeProgressState = null;

    // Get tabId from URL query param
    function getTabIdFromUrl() {
        const params = new URLSearchParams(window.location.search);
        return parseInt(params.get('tabId'), 10) || null;
    }

    // Connect to background script
    function connect() {
        try {
            tabId = getTabIdFromUrl();
            port = browser.runtime.connect({ name: 'sidebar' });

            port.onMessage.addListener(handleMessage);

            port.onDisconnect.addListener(() => {
                console.log('Disconnected, reconnecting...');
                port = null;
                setTimeout(connect, 2000);
            });

            // Init request with tabId
            port.postMessage({ action: 'init', tabId });

        } catch (e) {
            console.error('Connection failed:', e);
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
                // Show stop button, hide send button
                if (sendBtn) sendBtn.style.display = 'none';
                if (stopBtn) stopBtn.style.display = 'flex';
                break;

            case 'streamChunk':
                appendToStreamingMessage(message.chunk);
                break;

            case 'streamEnd':
                isStreaming = false;
                finalizeStreamingMessage();
                // Hide stop button, show send button
                if (stopBtn) stopBtn.style.display = 'none';
                if (sendBtn) sendBtn.style.display = 'flex';
                break;

            case 'toolCall':
                showToolStatus(`Using: ${formatToolName(message.name)}...`);
                // For deep_scrape_urls, add a special progress indicator
                if (message.name === 'deep_scrape_urls') {
                    addDeepScrapeProgress(message.args?.urls?.length || 0);
                } else {
                    addToolBadge(message.name, 'executing');
                }
                break;

            case 'toolExecuting':
                showToolStatus(`Running: ${formatToolName(message.name)}...`);
                break;

            case 'toolProgress':
                if (message.total > 0) {
                    showToolStatus(`${formatToolName(message.name)}: ${message.current}/${message.total}...`);
                    // Update deep scrape progress if applicable
                    if (message.name === 'deep_scrape_urls') {
                        updateDeepScrapeProgress(message.current, message.total);
                    } else {
                        updateToolBadgeTitle(message.name, `${formatToolName(message.name)} (${message.current}/${message.total})`);
                    }
                }
                break;

            case 'toolResult':
                // Complete the deep scrape progress indicator
                if (message.name === 'deep_scrape_urls') {
                    completeDeepScrapeProgress();
                } else {
                    updateToolBadge(message.name, 'complete');
                }
                showToolStatus(`Done: ${formatToolName(message.name)}`);
                setTimeout(hideToolStatus, 1500);
                break;

            case 'error':
                hideToolStatus();
                addErrorMessage(message.message);
                isStreaming = false;
                // Reset button visibility
                if (stopBtn) stopBtn.style.display = 'none';
                if (sendBtn) sendBtn.style.display = 'flex';
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

            case 'settingsSaved':
                if (message.success) {
                    hideApiKeyBanner();
                    closeSettingsModal();
                    showToast('Settings saved!', true);
                } else {
                    showToast('Failed to save: ' + (message.error || 'Unknown error'), false);
                }
                break;

            case 'apiKeySet':
                if (message.success) {
                    hideApiKeyBanner();
                    closeSettingsModal();
                    showToast('Settings saved!', true);
                } else {
                    showToast('Failed to save: ' + (message.error || 'Unknown error'), false);
                }
                break;

                break;

            case 'currentSettings':
                // Set all settings fields
                if (message.model) {
                    const modelSelect = document.getElementById('model-select');
                    if (modelSelect) modelSelect.value = message.model;
                }
                if (message.apiMode) {
                    const modeSelect = document.getElementById('api-mode-select');
                    if (modeSelect) modeSelect.value = message.apiMode;
                }
                if (message.geminiUrl) {
                    const geminiUrlInput = document.getElementById('gemini-url-input');
                    if (geminiUrlInput) geminiUrlInput.value = message.geminiUrl;
                }
                if (message.geminiMode) {
                    const geminiModeSelect = document.getElementById('gemini-mode-select');
                    if (geminiModeSelect) geminiModeSelect.value = message.geminiMode;
                }
                // Update visibility based on mode
                updateSettingsVisibility(message.apiMode || 'native');
                break;

            case 'testToolResult':
                const testOutput = document.getElementById('test-output-content');
                if (testOutput) {
                    // If result has a 'data' field that's a string (text report), show it directly
                    if (message.result && typeof message.result.data === 'string') {
                        testOutput.textContent = message.result.data;
                    } else {
                        testOutput.textContent = JSON.stringify(message.result, null, 2);
                    }
                }
                break;
        }
    }

    // Add a message to the chat
    function addMessage(content, role) {
        const { messageDiv, contentDiv } = createMessageShell(role);
        contentDiv.innerHTML = formatMarkdown(content);
        chatContainer.appendChild(messageDiv);
        scrollToBottom();

        return messageDiv;
    }

    function createMessageShell(role) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${role}`;

        const avatar = document.createElement('div');
        avatar.className = `message-avatar ${role}`;
        avatar.textContent = role === 'assistant' ? 'AI' : 'ME';

        const bubble = document.createElement('div');
        bubble.className = 'message-bubble';

        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';

        bubble.appendChild(contentDiv);
        messageDiv.appendChild(avatar);
        messageDiv.appendChild(bubble);

        return { messageDiv, contentDiv, bubble };
    }

    // Start a streaming message
    function startStreamingMessage() {
        hideWelcome();

        const { messageDiv, contentDiv } = createMessageShell('assistant');
        messageDiv.id = 'streaming-message';

        // Create separate containers for text and tools
        const textContent = document.createElement('div');
        textContent.className = 'text-content';
        textContent.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';

        const toolContent = document.createElement('div');
        toolContent.className = 'tool-content';

        contentDiv.appendChild(textContent);
        contentDiv.appendChild(toolContent);
        chatContainer.appendChild(messageDiv);
        scrollToBottom();

        currentStreamingMessage = {
            div: messageDiv,
            content: '',
            hasTools: false
        };
    }

    // Append to streaming message
    function appendToStreamingMessage(chunk) {
        if (!currentStreamingMessage) return;

        // Handle clear signal - reset content to remove "Processing..." etc.
        if (chunk === '__CLEAR__') {
            currentStreamingMessage.content = '';
            const textContent = currentStreamingMessage.div.querySelector('.text-content');
            if (textContent) {
                textContent.innerHTML = '';
            }
            return;
        }

        currentStreamingMessage.content += chunk;
        const textContent = currentStreamingMessage.div.querySelector('.text-content');
        if (textContent) {
            textContent.innerHTML = formatMarkdown(currentStreamingMessage.content);
        }
        scrollToBottom();
    }

    // Finalize streaming message
    function finalizeStreamingMessage() {
        if (!currentStreamingMessage) return;

        const textContent = currentStreamingMessage.div.querySelector('.text-content');

        if (currentStreamingMessage.content) {
            if (textContent) textContent.innerHTML = formatMarkdown(currentStreamingMessage.content);
        } else {
            // If no content, remove text container (unless it's the only thing, then maybe remove message?)
            // If we have tools, keep message. If no tools and no content, remove message.
            if (!currentStreamingMessage.hasTools) {
                currentStreamingMessage.div.remove();
            } else if (textContent) {
                // Remove typing indicator if it's there
                if (textContent.querySelector('.typing-indicator')) {
                    textContent.remove();
                }
            }
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
            currentStreamingMessage.hasTools = true;
            // Append to tool-content container
            const toolContent = currentStreamingMessage.div.querySelector('.tool-content');
            if (toolContent) {
                toolContent.appendChild(badge);
            } else {
                // Fallback if structure is weird
                currentStreamingMessage.div.querySelector('.message-content').appendChild(badge);
            }
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

    // Update tool badge title (for progress)
    function updateToolBadgeTitle(toolName, newTitle) {
        const badge = document.querySelector(`.tool-call-badge[data-tool="${toolName}"]`);
        if (badge) {
            const span = badge.querySelector('span');
            if (span) span.textContent = newTitle;
        }
    }

    // Add deep scrape progress indicator
    function addDeepScrapeProgress(totalUrls) {
        deepScrapeProgressState = {
            startTime: Date.now(),
            total: totalUrls
        };
        const progressDiv = document.createElement('div');
        progressDiv.className = 'deep-scrape-progress';
        progressDiv.id = 'deep-scrape-progress';
        progressDiv.innerHTML = `
            <div class="progress-header">
                <span>🔍 DeepScrape V9</span>
                <svg viewBox="0 0 24 24">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                </svg>
            </div>
            <div class="progress-bar">
                <div class="progress-fill" style="width: 0%"></div>
            </div>
            <div class="progress-text">Initializing... (0/${totalUrls} sites)</div>
        `;

        if (currentStreamingMessage) {
            currentStreamingMessage.hasTools = true;
            const toolContent = currentStreamingMessage.div.querySelector('.tool-content');
            if (toolContent) {
                toolContent.appendChild(progressDiv);
            } else {
                currentStreamingMessage.div.querySelector('.message-content').appendChild(progressDiv);
            }
        } else {
            chatContainer.appendChild(progressDiv);
        }
        scrollToBottom();
    }

    // Update deep scrape progress
    function updateDeepScrapeProgress(current, total) {
        const progressDiv = document.getElementById('deep-scrape-progress');
        if (!progressDiv) return;
        if (!deepScrapeProgressState) {
            deepScrapeProgressState = { startTime: Date.now(), total };
        }
        if (deepScrapeProgressState.total !== total) {
            deepScrapeProgressState.total = total;
        }

        const percentage = Math.round((current / total) * 100);
        const remaining = total - current;

        const progressFill = progressDiv.querySelector('.progress-fill');
        const progressText = progressDiv.querySelector('.progress-text');

        if (progressFill) {
            progressFill.style.width = `${percentage}%`;
        }
        if (progressText) {
            const etaText = formatEta(current, remaining, deepScrapeProgressState.startTime);
            progressText.textContent = `Scraping site ${current}/${total} (${remaining} remaining) • ${etaText}`;
        }
    }

    // Complete deep scrape progress
    function completeDeepScrapeProgress() {
        const progressDiv = document.getElementById('deep-scrape-progress');
        if (!progressDiv) return;

        const progressFill = progressDiv.querySelector('.progress-fill');
        const progressText = progressDiv.querySelector('.progress-text');
        const header = progressDiv.querySelector('.progress-header');

        if (progressFill) {
            progressFill.style.width = '100%';
            progressFill.style.background = 'linear-gradient(90deg, #10B981, #34d399)';
        }
        if (progressText) {
            progressText.textContent = '✓ All sites scraped successfully!';
        }
        if (header) {
            header.style.color = '#10B981';
            const svg = header.querySelector('svg');
            if (svg) svg.style.animation = 'none';
        }

        progressDiv.style.borderColor = '#10B981';
        deepScrapeProgressState = null;
    }

    function formatEta(current, remaining, startTime) {
        if (!current || !remaining || !startTime) return 'ETA --';
        const elapsed = Date.now() - startTime;
        if (elapsed <= 0) return 'ETA --';
        const avgPerItem = elapsed / current;
        const remainingMs = remaining * avgPerItem;
        if (!Number.isFinite(remainingMs) || remainingMs <= 0) return 'ETA --';
        const totalSeconds = Math.max(1, Math.round(remainingMs / 1000));
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        if (minutes > 0) {
            return `ETA ${minutes}m ${seconds}s`;
        }
        return `ETA ${seconds}s`;
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
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

        // Markdown links [text](url)
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" class="product-link">$1</a>');

        // Auto-detect bare URLs and convert to clickable links
        // Regex improvement: Stop matching at whitespace, quotes, or common punctuation followed by space
        html = html.replace(
            /(?<!href="|">)(https?:\/\/[^\s<>"]+?)(?=[\s,)]|(\.\s)|$)/g,
            (match) => {
                // Determine if it looks like a Shopee product URL
                if (match.includes('shopee.co.id')) {
                    // Try to get product name from URL
                    // Improved regex to handle various shopee URL patterns and avoid capturing trailing chars
                    const productMatch = match.match(/shopee\.co\.id\/([^\?#]+)/);
                    let productName = 'View Product';

                    if (productMatch && productMatch[1]) {
                        // Clean up the slug: remove IDs at the end if possible, replace hyphens with spaces
                        let slug = productMatch[1];
                        // Remove the shop ID/item ID suffix usually found like: name-of-product-i.123.456
                        slug = slug.replace(/-i\.\d+\.\d+.*$/, '');
                        productName = slug.replace(/-/g, ' ').substring(0, 40) + '...';
                    }

                    return `<a href="${match}" target="_blank" class="product-link shopee-link">🛒 ${productName}</a>`;
                }

                // Generic URL
                const displayUrl = match.length > 50 ? match.substring(0, 47) + '...' : match;
                return `<a href="${match}" target="_blank" class="external-link">🔗 ${displayUrl}</a>`;
            }
        );

        html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
        html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
        html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
        html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

        // Wrap lists
        html = html.replace(/(<li>[\s\S]+?<\/li>)/g, '<ul>$1</ul>');
        // Fix double wrapping of lists if they were adjacent
        html = html.replace(/<\/ul><ul>/g, '');

        // Convert newlines to breaks, but ignore newlines inside pre/code tags or around headers/lists
        // Simplest approach: Replace double newlines with paragraph breaks, single with br
        html = html.replace(/\n\n/g, '<br><br>');
        html = html.replace(/\n/g, '<br>');

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
        const messages = chatContainer.querySelectorAll('.message, .tool-call-badge, .error-message');
        messages.forEach(m => m.remove());
        showWelcome();
    }

    function showWelcome() { welcomeMessage.style.display = 'block'; }
    function hideWelcome() { welcomeMessage.style.display = 'none'; }
    function scrollToBottom() { chatContainer.scrollTop = chatContainer.scrollHeight; }

    // Send message
    function sendMessage() {
        let text = messageInput.value.trim();
        if (!text || isStreaming || !port) return;

        // Append single pick mode tag if active
        if (singlePickMode) {
            text = text + ' {Single_pick_mode}';
        }

        port.postMessage({
            action: 'sendMessage',
            text: text,
            tabId: tabId
        });

        messageInput.value = '';
        updateSendButton();
    }

    function updateSendButton() {
        sendBtn.disabled = !messageInput.value.trim() || isStreaming;
    }

    function autoResizeInput() {
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
    }

    function openSettingsModal() { settingsModal.classList.add('visible'); }
    function closeSettingsModal() { settingsModal.classList.remove('visible'); }

    // Show/hide native-only settings based on API mode
    function updateSettingsVisibility(mode) {
        const apiKeyGroup = document.getElementById('api-key-group');
        const modelGroup = document.getElementById('model-group');
        const geminiUrlGroup = document.getElementById('gemini-url-group');
        const serperKeyGroup = document.getElementById('serper-key-group');
        const geminiModeGroup = document.getElementById('gemini-mode-group');
        const isWeb = mode === 'web';

        // Hide API key, model, and Serper key for Web mode (uses native Google Search)
        if (apiKeyGroup) apiKeyGroup.style.display = isWeb ? 'none' : 'block';
        if (modelGroup) modelGroup.style.display = isWeb ? 'none' : 'block';
        if (serperKeyGroup) serperKeyGroup.style.display = isWeb ? 'none' : 'block';
        if (geminiUrlGroup) geminiUrlGroup.style.display = isWeb ? 'block' : 'none';
        // Show Gemini Mode selector only in Web mode
        if (geminiModeGroup) geminiModeGroup.style.display = isWeb ? 'block' : 'none';
    }

    // Attach mode change event
    const apiModeSelect = document.getElementById('api-mode-select');
    if (apiModeSelect) {
        apiModeSelect.addEventListener('change', (e) => updateSettingsVisibility(e.target.value));
    }

    function toggleApiKeyVisibility() {
        apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
    }

    function toggleSerperKeyVisibility() {
        serperKeyInput.type = serperKeyInput.type === 'password' ? 'text' : 'password';
    }

    function saveSettings() {
        if (!port) return;

        const apiKey = apiKeyInput.value.trim();
        const serperKey = serperKeyInput.value.trim();
        const modelSelect = document.getElementById('model-select');
        const model = modelSelect?.value || 'gemini-2.5-flash';
        const geminiUrlInput = document.getElementById('gemini-url-input');
        const geminiUrl = geminiUrlInput?.value.trim();
        const geminiModeSelect = document.getElementById('gemini-mode-select');
        const geminiMode = geminiModeSelect?.value || 'fast';

        // Send settings to background
        port.postMessage({
            action: 'saveSettings',
            apiKey: apiKey || null,  // null if empty (don't overwrite existing)
            serperKey: serperKey || null,
            model: model,
            apiMode: document.getElementById('api-mode-select')?.value || 'native',
            geminiUrl: geminiUrl || null,
            geminiMode: geminiMode,
            tabId
        });

        apiKeyInput.value = '';
        serperKeyInput.value = '';
    }

    function showApiKeyBanner() { apiKeyBanner.classList.add('visible'); }
    function hideApiKeyBanner() { apiKeyBanner.classList.remove('visible'); }

    function showToast(message, isSuccess = true) {
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed; bottom: 120px; left: 50%; transform: translateX(-50%);
            background: ${isSuccess ? '#10B981' : '#EF4444'}; color: white;
            padding: 12px 20px; border-radius: 8px; font-size: 13px; z-index: 1000;
        `;
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    // Event Listeners
    messageInput.addEventListener('input', () => { updateSendButton(); autoResizeInput(); });
    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });

    sendBtn.addEventListener('click', sendMessage);

    // Stop button - abort generation
    if (stopBtn) {
        stopBtn.addEventListener('click', () => {
            if (port) {
                port.postMessage({ action: 'stopGeneration', tabId });
            }
            // Reset UI immediately
            isStreaming = false;
            stopBtn.style.display = 'none';
            sendBtn.style.display = 'flex';
            hideToolStatus();
            // Add a "stopped" message
            if (currentStreamingMessage) {
                const textContent = currentStreamingMessage.div.querySelector('.text-content');
                if (textContent) {
                    textContent.innerHTML += '<br><em style="color: var(--warning);">⏹️ Generation stopped by user</em>';
                }
                finalizeStreamingMessage();
            }
        });
    }
    if (fullscreenBtn) {
        fullscreenBtn.addEventListener('click', async () => {
            try {
                // Try to toggle locally first (faster, reliable)
                const win = await browser.windows.getCurrent();
                const newState = win.state === 'fullscreen' ? 'normal' : 'fullscreen';
                await browser.windows.update(win.id, { state: newState });
            } catch (e) {
                console.error('Local fullscreen toggle failed, using background fallback:', e);
                if (port) port.postMessage({ action: 'toggleFullscreen', tabId });
            }
        });
    }
    clearBtn.addEventListener('click', () => {
        if (confirm('Clear conversation?') && port) {
            port.postMessage({ action: 'clearConversation', tabId });
        }
    });

    settingsBtn.addEventListener('click', openSettingsModal);
    modalClose.addEventListener('click', closeSettingsModal);
    toggleKeyBtn.addEventListener('click', toggleApiKeyVisibility);
    if (toggleSerperKeyBtn) toggleSerperKeyBtn.addEventListener('click', toggleSerperKeyVisibility);
    saveApiKeyBtn.addEventListener('click', saveSettings);
    openSettingsBanner.addEventListener('click', openSettingsModal);

    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) closeSettingsModal();
    });

    // Mode Toggle Button
    if (modeToggleBtn) {
        modeToggleBtn.addEventListener('click', () => {
            singlePickMode = !singlePickMode;
            modeToggleBtn.classList.toggle('active', singlePickMode);
            const label = modeToggleBtn.querySelector('.mode-label');
            if (label) {
                label.textContent = singlePickMode ? 'Single' : 'Normal';
            }
        });
    }

    // ============ DYNAMIC SUGGESTIONS ============
    const SUGGESTION_POOL = [
        // Tech & Gadgets
        { icon: '📱', label: 'Best mid-range phones 2024', message: 'Find me the best mid-range smartphones released in late 2023 or 2024 available on Shopee.' },
        { icon: '🎧', label: 'Wireless earbuds under 500k', message: 'Recommend top-rated true wireless earbuds under Rp 500.000 with good bass.' },
        { icon: '⌨️', label: 'Mechanical keyboards for work', message: 'Suggest mechanical keyboards suitable for office work, preferably silent switches.' },
        { icon: '🖱️', label: 'Ergonomic mouse cheap', message: 'Find affordable ergonomic mouse options for large hands.' },
        { icon: '🔋', label: '20000mAh power banks', message: 'Show me reliable 20.000mAh power banks with fast charging support.' },
        { icon: '🎮', label: 'Budget gaming headset', message: 'What are the best budget gaming headsets with a microphone under 300k?' },

        // Home & Living
        { icon: '🔧', label: 'Complete screwdriver set', message: 'Find a complete precision screwdriver set for repairing electronics.' },
        { icon: '💡', label: 'Smart LED bulbs', message: 'Compare affordable smart LED bulbs compatible with Google Home.' },
        { icon: '🍳', label: 'Non-stick frying pans', message: 'Recommend durable non-stick frying pans that are PFOA free.' },
        { icon: '🧹', label: 'Robot vacuum cleaners', message: 'Find good entry-level robot vacuum cleaners available on Shopee.' },
        { icon: '🪑', label: 'Ergonomic office chair', message: 'Look for high-rated ergonomic office chairs under 2 million.' },
        { icon: '🌡️', label: 'Digital thermometer', message: 'Find accurate digital thermometers for cooking.' },

        // Fashion & Beauty
        { icon: '👟', label: 'Running shoes for beginners', message: 'Suggest comfortable running shoes for beginners under 1 million.' },
        { icon: '🎒', label: 'Waterproof laptop backpack', message: 'Find a stylish waterproof backpack that fits a 15.6 inch laptop.' },
        { icon: '🕶️', label: 'Polarized sunglasses', message: 'Search for cool polarized sunglasses for driving.' },
        { icon: '🧴', label: 'Sunscreen for oily skin', message: 'Recommend popular sunscreens for oily and acne-prone skin.' },

        // Hobbies & Gifts
        { icon: '🎁', label: 'Gift for tech lover', message: 'Give me 5 gift ideas for a tech enthusiast under Rp 200.000.' },
        { icon: '🎨', label: 'Watercolor starter set', message: 'Find a good quality watercolor painting set for beginners.' },
        { icon: '⛺', label: 'Camping tent for 2', message: 'Show me lightweight camping tents suitable for 2 people.' },
        { icon: '🚗', label: 'Car detailed cleaning kit', message: 'Find a complete car detailing kit with microfiber towels.' },

        // Comparison
        { icon: '🆚', label: 'Sony vs JBL headphones', message: 'Compare Sony and JBL wireless headphones in the 1-2 million price range.' },
        { icon: '🆚', label: 'Logitech vs Razer mouse', message: 'Compare budget gaming mice from Logitech and Razer.' },
        { icon: '📊', label: 'Top rated air fryers', message: 'Find the top 3 rated air fryers on Shopee and compare their features.' }
    ];

    function getRandomSuggestions(count = 3) {
        const shuffled = [...SUGGESTION_POOL].sort(() => 0.5 - Math.random());
        return shuffled.slice(0, count);
    }

    function renderSuggestions() {
        const container = document.querySelector('.suggestions');
        if (!container) return;

        container.innerHTML = ''; // Clear existing

        const suggestions = getRandomSuggestions(3);

        suggestions.forEach(item => {
            const btn = document.createElement('button');
            btn.className = 'suggestion-chip';
            btn.innerHTML = `${item.icon} ${item.label}`;
            // Store message in dataset or closure
            btn.addEventListener('click', () => {
                messageInput.value = item.message;
                updateSendButton();
                sendMessage();
            });
            container.appendChild(btn);
        });
    }

    // Initial render
    renderSuggestions();

    // ============ TEST MODE ============
    const testPanel = document.getElementById('test-panel');
    const testModeBtn = document.getElementById('test-mode-btn');
    const closeTestPanelBtn = document.getElementById('close-test-panel');
    const testOutput = document.getElementById('test-output-content');
    const testSearchBtn = document.getElementById('test-search-btn');
    const testSearchKeyword = document.getElementById('test-search-keyword');
    const testScrapeBtn = document.getElementById('test-scrape-btn');

    const testDeepScrapeBtn = document.getElementById('test-deep-scrape-btn');
    const testDeepUrls = document.getElementById('test-deep-urls');
    const testPageInfoBtn = document.getElementById('test-pageinfo-btn');
    const testWaitContentBtn = document.getElementById('test-waitcontent-btn');

    function toggleTestPanel() {
        if (testPanel) testPanel.classList.toggle('visible');
    }

    function setTestOutput(data) {
        if (testOutput) {
            // If data is a string, show it directly; otherwise JSON stringify
            if (typeof data === 'string') {
                testOutput.textContent = data;
            } else {
                testOutput.textContent = JSON.stringify(data, null, 2);
            }
        }
    }

    const testSerperBtn = document.getElementById('test-serper-btn');
    const testSerperQuery = document.getElementById('test-serper-query');

    function runTestTool(action, params = {}) {
        if (!port) { setTestOutput({ error: 'Not connected' }); return; }
        setTestOutput({ status: 'Running...', action });
        port.postMessage({ action: 'testTool', toolAction: action, toolParams: params, tabId });
    }

    if (testModeBtn) testModeBtn.addEventListener('click', toggleTestPanel);
    if (closeTestPanelBtn) closeTestPanelBtn.addEventListener('click', toggleTestPanel);
    if (testSearchBtn) {
        testSearchBtn.addEventListener('click', () => {
            const keyword = testSearchKeyword?.value.trim();
            if (!keyword) { setTestOutput({ error: 'Enter keyword' }); return; }
            runTestTool('searchShopee', { keyword });
        });
    }
    if (testSerperBtn) {
        testSerperBtn.addEventListener('click', () => {
            const query = testSerperQuery?.value.trim();
            if (!query) { setTestOutput({ error: 'Enter query' }); return; }
            runTestTool('serperSearch', { query });
        });
    }
    if (testScrapeBtn) {
        testScrapeBtn.addEventListener('click', () => {
            // New behavior: Scrape all (smart scroll)
            runTestTool('scrapeListings');
        });
    }
    if (testDeepScrapeBtn) {
        testDeepScrapeBtn.addEventListener('click', () => {
            const urlsText = testDeepUrls?.value.trim();
            if (!urlsText) { setTestOutput({ error: 'Enter at least one product URL' }); return; }

            // Parse URLs - one per line, filter empties
            const urls = urlsText.split('\n')
                .map(url => url.trim())
                .filter(url => url.length > 0 && url.includes('shopee'));

            if (urls.length === 0) {
                setTestOutput({ error: 'No valid Shopee URLs found. Enter URLs one per line.' });
                return;
            }

            setTestOutput({ status: `Deep scraping ${urls.length} URL(s)...`, urls });
            runTestTool('deepScrapeUrls', { urls });
        });
    }
    if (testPageInfoBtn) testPageInfoBtn.addEventListener('click', () => runTestTool('getPageInfo'));
    if (testWaitContentBtn) testWaitContentBtn.addEventListener('click', () => runTestTool('waitForContent', { timeout: 10000 }));

    // Initialize
    connect();
})();

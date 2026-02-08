/**
 * Shopping Assistant - Web Interface Client
 * Handles WebSocket communication and UI interactions
 */

(function () {
    'use strict';

    // ============================================================================
    // DOM ELEMENTS
    // ============================================================================
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
    const toolStatus = document.getElementById('tool-status');
    const toolStatusText = document.getElementById('tool-status-text');
    const modeToggleBtn = document.getElementById('mode-toggle-btn');
    const connectionStatus = document.getElementById('connection-status');
    const extensionNotice = document.getElementById('extension-notice');

    // ============================================================================
    // STATE
    // ============================================================================
    let socket = null;
    let sessionId = localStorage.getItem('shopping_assistant_session') || null;
    let isStreaming = false;
    let currentStreamingMessage = null;
    let singlePickMode = false;
    let extensionConnected = false;
    let deepScrapeProgressState = null;

    // ============================================================================
    // SOCKET.IO CONNECTION
    // ============================================================================
    function connect() {
        // Connect to the same origin
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;

        console.log('[WS] Connecting to:', wsUrl);

        socket = io(wsUrl, {
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000
        });

        socket.on('connect', () => {
            console.log('[WS] Connected');
            updateConnectionStatus('connected');

            // Register as web client
            socket.emit('register_web_client', { session_id: sessionId });
        });

        socket.on('disconnect', () => {
            console.log('[WS] Disconnected');
            updateConnectionStatus('disconnected');
        });

        socket.on('connect_error', (error) => {
            console.error('[WS] Connection error:', error);
            updateConnectionStatus('error');
        });

        socket.on('registered', (data) => {
            sessionId = data.session_id;
            localStorage.setItem('shopping_assistant_session', sessionId);
            extensionConnected = data.extension_connected;
            updateExtensionStatus(extensionConnected);

            document.getElementById('session-id').textContent = sessionId.substring(0, 8) + '...';
            console.log('[WS] Registered with session:', sessionId);
        });

        socket.on('extension_status', (data) => {
            extensionConnected = data.connected;
            updateExtensionStatus(extensionConnected);
        });

        socket.on('conversation_history', (data) => {
            loadConversationHistory(data.messages);
        });

        socket.on('message_added', (data) => {
            if (data.role === 'user') {
                addMessage(data.content, 'user');
                hideWelcome();
            }
        });

        socket.on('stream_start', () => {
            isStreaming = true;
            startStreamingMessage();
            if (sendBtn) sendBtn.style.display = 'none';
            if (stopBtn) stopBtn.style.display = 'flex';
        });

        socket.on('stream_chunk', (data) => {
            appendToStreamingMessage(data.chunk);
        });

        socket.on('stream_end', () => {
            isStreaming = false;
            finalizeStreamingMessage();
            if (stopBtn) stopBtn.style.display = 'none';
            if (sendBtn) sendBtn.style.display = 'flex';
        });

        socket.on('tool_call', (data) => {
            console.log('[WS] tool_call received:', data);  // DEBUG
            showToolStatus(`Using: ${formatToolName(data.name)}...`);
            if (data.name === 'deep_scrape_urls') {
                addDeepScrapeProgress(data.args?.urls?.length || 0);
            } else {
                addToolBadge(data.name, 'executing');
            }
        });

        socket.on('tool_executing', (data) => {
            console.log('[WS] tool_executing received:', data);  // DEBUG
            showToolStatus(`Running: ${formatToolName(data.name)}...`);
        });

        socket.on('tool_progress', (data) => {
            console.log('[WS] tool_progress received:', data);  // DEBUG
            if (data.total > 0) {
                // Extract product name from URL for cleaner display
                let displayInfo = `${data.current}/${data.total}`;
                if (data.url) {
                    // Extract product name from Shopee URL or show truncated URL
                    const urlMatch = data.url.match(/shopee\.co\.id\/([^?]+)/);
                    if (urlMatch) {
                        const productPath = decodeURIComponent(urlMatch[1]).replace(/-i\.\d+\.\d+$/, '').replace(/-/g, ' ');
                        displayInfo = `${data.current}/${data.total}: ${productPath.substring(0, 40)}...`;
                    } else {
                        displayInfo = `${data.current}/${data.total}: ${data.url.substring(0, 50)}...`;
                    }
                }
                showToolStatus(`${formatToolName(data.name)}: ${displayInfo}`);
                if (data.name === 'deep_scrape_urls') {
                    updateDeepScrapeProgress(data.current, data.total, data.url);
                } else {
                    updateToolBadgeTitle(data.name, `${formatToolName(data.name)} (${data.current}/${data.total})`);
                }
            }
        });

        socket.on('tool_result', (data) => {
            console.log('[WS] tool_result received:', data);  // DEBUG
            if (data.name === 'deep_scrape_urls') {
                completeDeepScrapeProgress();
            } else {
                updateToolBadge(data.name, 'complete');
            }
            showToolStatus(`Done: ${formatToolName(data.name)}`);
            setTimeout(hideToolStatus, 1500);
        });

        socket.on('error', (data) => {
            hideToolStatus();
            addErrorMessage(data.message);
            isStreaming = false;
            if (stopBtn) stopBtn.style.display = 'none';
            if (sendBtn) sendBtn.style.display = 'flex';
        });

        socket.on('conversation_cleared', () => {
            clearChat();
        });
    }

    // ============================================================================
    // CONNECTION STATUS
    // ============================================================================
    function updateConnectionStatus(status) {
        const dot = connectionStatus.querySelector('.status-dot');
        const text = connectionStatus.querySelector('.status-text');

        dot.className = 'status-dot ' + status;

        switch (status) {
            case 'connected':
                text.textContent = 'Connected';
                break;
            case 'disconnected':
                text.textContent = 'Disconnected';
                break;
            case 'error':
                text.textContent = 'Connection Error';
                break;
            default:
                text.textContent = 'Connecting...';
        }

        document.getElementById('server-status').className = 'status-badge ' + status;
        document.getElementById('server-status').textContent = status === 'connected' ? 'Connected' : 'Disconnected';
    }

    function updateExtensionStatus(connected) {
        const badge = document.getElementById('extension-status');
        const notice = document.getElementById('extension-notice');

        badge.className = 'status-badge ' + (connected ? 'connected' : 'disconnected');
        badge.textContent = connected ? 'Connected' : 'Not Connected';

        if (notice) {
            notice.style.display = connected ? 'none' : 'flex';
        }
    }

    // ============================================================================
    // MESSAGES
    // ============================================================================
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

    function startStreamingMessage() {
        hideWelcome();

        const { messageDiv, contentDiv } = createMessageShell('assistant');
        messageDiv.id = 'streaming-message';

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

    function appendToStreamingMessage(chunk) {
        if (!currentStreamingMessage) return;

        if (chunk === '__CLEAR__') {
            currentStreamingMessage.content = '';
            const textContent = currentStreamingMessage.div.querySelector('.text-content');
            if (textContent) textContent.innerHTML = '';
            return;
        }

        currentStreamingMessage.content += chunk;
        const textContent = currentStreamingMessage.div.querySelector('.text-content');
        if (textContent) {
            textContent.innerHTML = formatMarkdown(currentStreamingMessage.content);
        }
        scrollToBottom();
    }

    function finalizeStreamingMessage() {
        if (!currentStreamingMessage) return;

        const textContent = currentStreamingMessage.div.querySelector('.text-content');

        if (currentStreamingMessage.content) {
            if (textContent) textContent.innerHTML = formatMarkdown(currentStreamingMessage.content);
        } else {
            if (!currentStreamingMessage.hasTools) {
                currentStreamingMessage.div.remove();
            } else if (textContent && textContent.querySelector('.typing-indicator')) {
                textContent.remove();
            }
        }

        currentStreamingMessage = null;
        scrollToBottom();
    }

    // ============================================================================
    // TOOL BADGES & PROGRESS
    // ============================================================================
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
            const toolContent = currentStreamingMessage.div.querySelector('.tool-content');
            if (toolContent) {
                toolContent.appendChild(badge);
            }
        } else {
            chatContainer.appendChild(badge);
        }
        scrollToBottom();
    }

    function updateToolBadge(toolName, status) {
        const badge = document.querySelector(`.tool-call-badge[data-tool="${toolName}"]`);
        if (badge) badge.className = `tool-call-badge ${status}`;
    }

    function updateToolBadgeTitle(toolName, newTitle) {
        const badge = document.querySelector(`.tool-call-badge[data-tool="${toolName}"]`);
        if (badge) {
            const span = badge.querySelector('span');
            if (span) span.textContent = newTitle;
        }
    }

    function addDeepScrapeProgress(totalUrls) {
        deepScrapeProgressState = { startTime: Date.now(), total: totalUrls };
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
            if (toolContent) toolContent.appendChild(progressDiv);
        } else {
            chatContainer.appendChild(progressDiv);
        }
        scrollToBottom();
    }

    function updateDeepScrapeProgress(current, total, url) {
        const progressDiv = document.getElementById('deep-scrape-progress');
        if (!progressDiv) return;

        if (!deepScrapeProgressState) {
            deepScrapeProgressState = { startTime: Date.now(), total };
        }

        const percentage = Math.round((current / total) * 100);
        const remaining = total - current;
        const progressFill = progressDiv.querySelector('.progress-fill');
        const progressText = progressDiv.querySelector('.progress-text');
        const urlText = progressDiv.querySelector('.progress-url');

        if (progressFill) progressFill.style.width = `${percentage}%`;
        if (progressText) {
            const etaText = formatEta(current, remaining, deepScrapeProgressState.startTime);
            progressText.textContent = `Scraping site ${current}/${total} (${remaining} remaining) • ${etaText}`;
        }

        // Show current URL being scraped
        if (url) {
            if (!urlText) {
                // Create URL display element if it doesn't exist
                const urlDiv = document.createElement('div');
                urlDiv.className = 'progress-url';
                urlDiv.style.cssText = 'font-size: 11px; color: #9ca3af; margin-top: 4px; font-family: monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
                progressDiv.appendChild(urlDiv);
            }
            const displayUrl = progressDiv.querySelector('.progress-url');
            if (displayUrl) {
                // Extract product name from URL for cleaner display
                const urlMatch = url.match(/shopee\.co\.id\/([^?]+)/);
                if (urlMatch) {
                    const productPath = decodeURIComponent(urlMatch[1]).replace(/-i\.\d+\.\d+$/, '').replace(/-/g, ' ');
                    displayUrl.textContent = `📦 ${productPath.substring(0, 60)}${productPath.length > 60 ? '...' : ''}`;
                } else {
                    displayUrl.textContent = `🔗 ${url.substring(0, 70)}...`;
                }
            }
        }
    }

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
        if (progressText) progressText.textContent = '✓ All sites scraped successfully!';
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
        return minutes > 0 ? `ETA ${minutes}m ${seconds}s` : `ETA ${seconds}s`;
    }

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

    // ============================================================================
    // TOOL STATUS
    // ============================================================================
    function showToolStatus(text) {
        toolStatusText.textContent = text;
        toolStatus.classList.add('visible');
    }

    function hideToolStatus() {
        toolStatus.classList.remove('visible');
    }

    function formatToolName(name) {
        return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

    // ============================================================================
    // MARKDOWN FORMATTING
    // ============================================================================
    function formatMarkdown(content) {
        if (!content) return '';

        let html = escapeHtml(content);

        // Code blocks
        html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

        // Links
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" class="product-link">$1</a>');

        // Auto-detect URLs
        html = html.replace(
            /(?<!href="|">)(https?:\/\/[^\s<>"]+?)(?=[\s,)]|(\.\\s)|$)/g,
            (match) => {
                if (match.includes('shopee.co.id')) {
                    const productMatch = match.match(/shopee\.co\.id\/([^\?#]+)/);
                    let productName = 'View Product';
                    if (productMatch && productMatch[1]) {
                        let slug = productMatch[1].replace(/-i\.\d+\.\d+.*$/, '');
                        productName = slug.replace(/-/g, ' ').substring(0, 40) + '...';
                    }
                    return `<a href="${match}" target="_blank" class="product-link shopee-link">🛒 ${productName}</a>`;
                }
                const displayUrl = match.length > 50 ? match.substring(0, 47) + '...' : match;
                return `<a href="${match}" target="_blank" class="external-link">🔗 ${displayUrl}</a>`;
            }
        );

        // Headers
        html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
        html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

        // Lists
        html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
        html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
        html = html.replace(/(<li>[\s\S]+?<\/li>)/g, '<ul>$1</ul>');
        html = html.replace(/<\/ul><ul>/g, '');

        // Line breaks
        html = html.replace(/\n\n/g, '<br><br>');
        html = html.replace(/\n/g, '<br>');

        return html;
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ============================================================================
    // CONVERSATION MANAGEMENT
    // ============================================================================
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

    function clearChat() {
        const messages = chatContainer.querySelectorAll('.message, .tool-call-badge, .error-message, .deep-scrape-progress');
        messages.forEach(m => m.remove());
        showWelcome();
    }

    function showWelcome() { welcomeMessage.style.display = 'block'; }
    function hideWelcome() { welcomeMessage.style.display = 'none'; }
    function scrollToBottom() { chatContainer.scrollTop = chatContainer.scrollHeight; }

    // ============================================================================
    // SEND MESSAGE
    // ============================================================================
    function sendMessage() {
        let text = messageInput.value.trim();

        // Debug logging
        console.log('[UI] sendMessage called');
        console.log('[UI] text:', text);
        console.log('[UI] socket:', socket);
        console.log('[UI] socket.connected:', socket?.connected);
        console.log('[UI] isStreaming:', isStreaming);
        console.log('[UI] sessionId:', sessionId);

        if (!text || isStreaming) {
            console.log('[UI] Blocked: no text or streaming');
            return;
        }

        if (!socket || !socket.connected) {
            console.log('[UI] Blocked: socket not connected');
            addErrorMessage('Not connected to server. Please refresh the page.');
            return;
        }

        if (singlePickMode) {
            text = text + ' {Single_pick_mode}';
        }

        console.log('[UI] Emitting send_message:', { session_id: sessionId, text });
        socket.emit('send_message', {
            session_id: sessionId,
            text: text
        });

        messageInput.value = '';
        updateSendButton();
    }

    function updateSendButton() {
        sendBtn.disabled = !messageInput.value.trim() || isStreaming || !socket?.connected;
    }

    function autoResizeInput() {
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
    }

    // ============================================================================
    // MODALS
    // ============================================================================
    function openSettingsModal() { settingsModal.classList.add('visible'); }
    function closeSettingsModal() { settingsModal.classList.remove('visible'); }

    // ============================================================================
    // SUGGESTIONS
    // ============================================================================
    const SUGGESTION_POOL = [
        { icon: '📱', label: 'Best mid-range phones', message: 'Find me the best mid-range smartphones available on Shopee.' },
        { icon: '🎧', label: 'Wireless earbuds under 500k', message: 'Recommend top-rated true wireless earbuds under Rp 500.000.' },
        { icon: '⌨️', label: 'Mechanical keyboards', message: 'Suggest mechanical keyboards suitable for office work.' },
        { icon: '🔧', label: 'Complete screwdriver set', message: 'Find a complete precision screwdriver set.' },
        { icon: '💡', label: 'Smart LED bulbs', message: 'Compare affordable smart LED bulbs.' },
        { icon: '🎮', label: 'Budget gaming headset', message: 'Find the best budget gaming headsets under 300k.' },
        { icon: '📊', label: 'Compare air fryers', message: 'Find the top 3 rated air fryers and compare features.' }
    ];

    function getRandomSuggestions(count = 3) {
        const shuffled = [...SUGGESTION_POOL].sort(() => 0.5 - Math.random());
        return shuffled.slice(0, count);
    }

    function renderSuggestions() {
        const container = document.getElementById('suggestions');
        if (!container) return;

        container.innerHTML = '';
        const suggestions = getRandomSuggestions(3);

        suggestions.forEach(item => {
            const btn = document.createElement('button');
            btn.className = 'suggestion-chip';
            btn.innerHTML = `${item.icon} ${item.label}`;
            btn.addEventListener('click', () => {
                messageInput.value = item.message;
                updateSendButton();
                sendMessage();
            });
            container.appendChild(btn);
        });
    }

    // ============================================================================
    // EVENT LISTENERS
    // ============================================================================
    messageInput.addEventListener('input', () => { updateSendButton(); autoResizeInput(); });
    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });

    sendBtn.addEventListener('click', sendMessage);

    if (stopBtn) {
        stopBtn.addEventListener('click', () => {
            // For now, just reset UI (server-side abort can be added later)
            isStreaming = false;
            stopBtn.style.display = 'none';
            sendBtn.style.display = 'flex';
            hideToolStatus();
            if (currentStreamingMessage) {
                const textContent = currentStreamingMessage.div.querySelector('.text-content');
                if (textContent) {
                    textContent.innerHTML += '<br><em style="color: var(--warning);">⏹️ Generation stopped</em>';
                }
                finalizeStreamingMessage();
            }
        });
    }

    if (fullscreenBtn) {
        fullscreenBtn.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen();
            } else {
                document.exitFullscreen();
            }
        });
    }

    clearBtn.addEventListener('click', () => {
        if (confirm('Clear conversation?') && socket?.connected) {
            socket.emit('clear_conversation', { session_id: sessionId });
        }
    });

    settingsBtn.addEventListener('click', openSettingsModal);
    modalClose.addEventListener('click', closeSettingsModal);
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) closeSettingsModal();
    });

    if (modeToggleBtn) {
        modeToggleBtn.addEventListener('click', () => {
            singlePickMode = !singlePickMode;
            modeToggleBtn.classList.toggle('active', singlePickMode);
            const label = modeToggleBtn.querySelector('.mode-label');
            if (label) label.textContent = singlePickMode ? 'Single' : 'Normal';
        });
    }

    // Test Ping Button
    const testPingBtn = document.getElementById('test-ping-btn');
    const pingResult = document.getElementById('ping-result');

    if (testPingBtn) {
        testPingBtn.addEventListener('click', () => {
            if (!socket?.connected) {
                pingResult.textContent = '❌ Not connected to server';
                pingResult.style.color = '#ef4444';
                return;
            }

            pingResult.textContent = '⏳ Sending ping to extension...';
            pingResult.style.color = '#f59e0b';

            const pingTime = Date.now();

            // Listen for pong response
            const pongHandler = (data) => {
                const latency = Date.now() - pingTime;
                pingResult.textContent = `✅ Pong received! Round-trip: ${latency}ms`;
                pingResult.style.color = '#10b981';

                // Also add a message to chat as proof
                hideWelcome();
                addMessage(`🏓 Ping test successful! Response: "${data.message}" (${latency}ms)`, 'assistant');

                socket.off('pong_response', pongHandler);
            };

            socket.on('pong_response', pongHandler);

            // Send ping
            socket.emit('test_ping', { session_id: sessionId, timestamp: pingTime });

            // Timeout after 10 seconds
            setTimeout(() => {
                socket.off('pong_response', pongHandler);
                if (pingResult.textContent.includes('Sending')) {
                    pingResult.textContent = '❌ Timeout - no response from extension';
                    pingResult.style.color = '#ef4444';
                }
            }, 10000);
        });
    }

    // ============================================================================
    // INITIALIZE
    // ============================================================================
    renderSuggestions();
    connect();
})();

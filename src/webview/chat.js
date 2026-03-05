/* ═══════════════════════════════════════════════════════
   Mercury Chat — Webview JavaScript
   Extracted from chatViewProvider.ts _getHtml()
   ═══════════════════════════════════════════════════════ */
// @ts-nocheck
var vscode = acquireVsCodeApi();
var logoUri = document.body.dataset.logoUri || '';
var $ = function(id) { return document.getElementById(id); };

var chatMessages  = $('chat-messages');
var messageInput  = $('message-input');
var sendBtn       = $('send-btn');
var stopBtn       = $('stop-btn');
var welcome       = $('welcome');
var sidebar       = $('sidebar');
var sessionList   = $('session-list');
var activeTitle   = $('active-title');
var renameOverlay = $('rename-overlay');
var renameInput   = $('rename-input');
var inputModeSelect = $('input-mode-select');
var inputModel    = $('input-model');
var modelDropdown = $('model-dropdown');
var confirmOverlay= $('confirm-overlay');
var sysPromptArea = $('sys-prompt-area');
var sysPromptInput= $('sys-prompt-input');
var scrollBottomBtn = $('scroll-bottom-btn');
var scrollAnchor  = $('scroll-anchor');
var scrollTopBtn  = $('scroll-top-btn');
var followUpsDiv  = $('follow-ups');
var charCount     = $('char-count');
var fileBreadcrumb = $('file-breadcrumb');
var breadcrumbPath = $('breadcrumb-path');
var breadcrumbDiags = $('breadcrumb-diags');
var recentFilesDropdown = $('recent-files-dropdown');
var sessionSearchInput = $('session-search-input');
var loadingBar    = $('loading-bar');
var shortcutsOverlay = $('shortcuts-overlay');
var statsOverlay  = $('stats-overlay');
var statsContent  = $('stats-content');
var thinkingTimer = $('thinking-timer');
var tokenSpeed    = $('token-speed');
var chatSearchBar = $('chat-search-bar');
var chatSearchInput = $('chat-search-input');
var chatSearchCount = $('chat-search-count');
var contextChips  = $('context-chips');
var templatesGrid = $('templates-grid');
var slashHint     = $('slash-hint');
var dropZone      = $('drop-zone');
var effortSelect  = $('effort-select');
var tempSelect    = $('temp-select');
var tokensSelect  = $('tokens-select');
var welcomeTip    = $('welcome-tip');
var quickActions  = $('quick-actions');
var scrollLockBtn = $('scroll-lock-btn');
var streamStats   = $('stream-stats');
var imagePasteIndicator = $('image-paste-indicator');

var isStreaming = false;
var currentStreamDiv = null;
var streamContent = '';
var renamingId = null;
var currentMode = 'code';
var toolGroupDiv = null;
var toolGroupBody = null;
var toolCount = 0;
var renderTimer = null;
var currentModel = 'mercury-2';
var savedModel = null;
var autoScroll = true;
var msgIndex = 0;

/* ═══ NEW: input history ═══ */
var inputHistory = [];
var historyIdx = -1;

/* ═══ NEW: thinking timer ═══ */
var thinkingInterval = null;
var thinkingStart = 0;

/* ═══ NEW: token counting ═══ */
var streamTokenCount = 0;
var streamStartTs = 0;

/* ═══ v0.19.0: session token & cost tracking ═══ */
var sessionTotalTokens = 0;
var sessionTotalInputTokens = 0;
var sessionTotalOutputTokens = 0;
var sessionTotalReasoningTokens = 0;
var sessionTotalCachedTokens = 0;
var sessionTotalCost = 0;
var INPUT_PRICE_PER_1M = 0.25;
var CACHED_PRICE_PER_1M = 0.025;
var OUTPUT_PRICE_PER_1M = 0.75;
function calculateCost(inputTokens, outputTokens, cachedTokens) {
    var uncachedInput = Math.max(0, inputTokens - (cachedTokens || 0));
    return (uncachedInput / 1000000) * INPUT_PRICE_PER_1M
         + ((cachedTokens || 0) / 1000000) * CACHED_PRICE_PER_1M
         + (outputTokens / 1000000) * OUTPUT_PRICE_PER_1M;
}
function formatCost(usd) {
    if (usd < 0.001) return '<$0.001';
    if (usd < 0.01) return '$' + usd.toFixed(4);
    if (usd < 1) return '$' + usd.toFixed(3);
    return '$' + usd.toFixed(2);
}

/* ═══ v0.14.0: auto-scroll lock state ═══ */
var userScrolledUp = false;

/* ═══ NEW: welcome tips ═══ */
var tips = [
    'Type / for slash commands like /explain, /fix, /test',
    'Use @workspace to include your project file list',
    'Use @selection to include the current editor selection',
    'Use @problems to include current diagnostics',
    'Press Up/Down in the input to cycle through message history',
    'Drag and drop files into the chat to include their content',
    'Press Ctrl+F to search within the conversation',
    'Click the bookmark star to save important messages',
    'Use Shift+Tab to cycle between Ask/Plan/Code modes',
    'Export your session as JSON from the top bar',
];
if (welcomeTip) { welcomeTip.textContent = tips[Math.floor(Math.random() * tips.length)]; }

/* ═══ v0.14.0: Quick Actions Toolbar (#23) ═══ */
if (quickActions) {
    quickActions.classList.add('visible');
    quickActions.querySelectorAll('.quick-action-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            messageInput.value = this.dataset.action;
            sendMessage();
        });
    });
}

/* ═══ v0.14.0: Auto-scroll lock (#14) ═══ */
chatMessages.addEventListener('scroll', function() {
    var atBottom = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < 80;
    if (isStreaming) {
        if (!atBottom) {
            userScrolledUp = true;
            autoScroll = false;
            if (scrollLockBtn) scrollLockBtn.classList.add('visible');
        } else {
            userScrolledUp = false;
            autoScroll = true;
            if (scrollLockBtn) scrollLockBtn.classList.remove('visible');
        }
    }
});
if (scrollLockBtn) {
    scrollLockBtn.addEventListener('click', function() {
        autoScroll = true;
        userScrolledUp = false;
        chatMessages.scrollTop = chatMessages.scrollHeight;
        scrollLockBtn.classList.remove('visible');
    });
}

/* ═══ v0.14.0: Image paste handler (#20) ═══ */
messageInput.addEventListener('paste', function(e) {
    var items = (e.clipboardData || {}).items || [];
    for (var i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
            e.preventDefault();
            if (imagePasteIndicator) {
                imagePasteIndicator.classList.add('visible');
                setTimeout(function() { imagePasteIndicator.classList.remove('visible'); }, 3000);
            }
            // Insert placeholder in input
            var pos = messageInput.selectionStart;
            var text = messageInput.value;
            var placeholder = '[pasted image — image support coming soon]';
            messageInput.value = text.slice(0, pos) + placeholder + text.slice(pos);
            messageInput.setSelectionRange(pos + placeholder.length, pos + placeholder.length);
            break;
        }
    }
});

// ─── State persistence ───
function saveState() {
    vscode.setState({
        inputText: messageInput.value,
        mode: currentMode,
        model: currentModel,
        scrollTop: chatMessages.scrollTop,
        inputHistory: inputHistory.slice(-50),
    });
}
var prevState = vscode.getState();
if (prevState) {
    if (prevState.inputText) { messageInput.value = prevState.inputText; }
    if (prevState.mode) {
        currentMode = prevState.mode;
        if (inputModeSelect) inputModeSelect.value = currentMode;
    }
    if (prevState.model) {
        currentModel = prevState.model;
        inputModel.textContent = currentModel;
    }
    if (prevState.inputHistory) { inputHistory = prevState.inputHistory; }
}

// ─── Input + char counter ───
messageInput.addEventListener('input', function() {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 150) + 'px';
    var len = messageInput.value.length;
    charCount.textContent = len > 0 ? len + ' chars' : '';

    /* ═══ NEW: slash command hint ═══ */
    var val = messageInput.value;
    if (val.startsWith('/') && !val.includes(' ') && val.length < 12) {
        showSlashHint(val);
    } else {
        slashHint.classList.remove('open');
    }

    saveState();
});

/* ═══ NEW: slash commands ═══ */
var slashCommands = [
    { cmd: '/explain', desc: 'Explain the current code' },
    { cmd: '/fix', desc: 'Fix bugs in the current code' },
    { cmd: '/test', desc: 'Generate tests for code' },
    { cmd: '/doc', desc: 'Generate documentation' },
    { cmd: '/commit', desc: 'Generate a commit message' },
    { cmd: '/clear', desc: 'Clear the conversation' },
    { cmd: '/help', desc: 'Show available commands' },
    { cmd: '/compact', desc: 'Toggle compact mode' },
    { cmd: '/new', desc: 'Start a new chat' },
    { cmd: '/rapid', desc: 'Rapid Code — autonomous plan, code, validate, audit' },
];
function showSlashHint(prefix) {
    var filtered = slashCommands.filter(function(s) { return s.cmd.startsWith(prefix); });
    if (filtered.length === 0) { slashHint.classList.remove('open'); return; }
    slashHint.innerHTML = '';
    for (var i = 0; i < filtered.length; i++) {
        var item = document.createElement('div');
        item.className = 'slash-item';
        item.innerHTML = '<span class="slash-item-cmd">' + filtered[i].cmd + '</span><span class="slash-item-desc">' + filtered[i].desc + '</span>';
        item.dataset.cmd = filtered[i].cmd;
        item.addEventListener('click', function() {
            messageInput.value = this.dataset.cmd + ' ';
            slashHint.classList.remove('open');
            messageInput.focus();
        });
        slashHint.appendChild(item);
    }
    slashHint.classList.add('open');
}

// ─── Auto-scroll + scroll-to-top ───
chatMessages.addEventListener('scroll', function() {
    var atBottom = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < 60;
    autoScroll = atBottom;
    scrollBottomBtn.style.display = atBottom ? 'none' : 'block';
    scrollTopBtn.style.display = chatMessages.scrollTop > 200 ? 'block' : 'none';
});
scrollBottomBtn.addEventListener('click', function() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
    autoScroll = true;
    scrollBottomBtn.style.display = 'none';
});
scrollTopBtn.addEventListener('click', function() {
    chatMessages.scrollTop = 0;
    scrollTopBtn.style.display = 'none';
});

// ─── Mode system ───
var modePlaceholders = { ask: 'Ask Mercury anything...', plan: 'Describe what you want to build...', code: 'What should I code?' };
if (inputModeSelect) {
    messageInput.placeholder = modePlaceholders[currentMode] || '';
    inputModeSelect.addEventListener('change', function() {
        currentMode = this.value;
        messageInput.placeholder = modePlaceholders[currentMode] || '';
        messageInput.focus();
        saveState();
    });
}

// ─── Keyboard shortcuts ───
document.addEventListener('keydown', function(e) {
    if (e.shiftKey && e.key === 'Tab') {
        e.preventDefault();
        var modes = ['ask','plan','code'];
        var idx = (modes.indexOf(currentMode) + 1) % modes.length;
        currentMode = modes[idx];
        if (inputModeSelect) inputModeSelect.value = currentMode;
        messageInput.placeholder = modePlaceholders[currentMode] || '';
        saveState();
    }
    if (e.ctrlKey && e.key === 'l') {
        e.preventDefault();
        vscode.postMessage({ type: 'newChat' });
    }
    if (e.key === 'Escape' && isStreaming) {
        vscode.postMessage({ type: 'stopGeneration' });
    }
    if (e.ctrlKey && e.key === '/') {
        e.preventDefault();
        messageInput.focus();
    }
    /* ═══ NEW: Ctrl+F search in chat ═══ */
    if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        chatSearchBar.classList.toggle('open');
        if (chatSearchBar.classList.contains('open')) { chatSearchInput.focus(); }
        else { clearSearchHighlights(); }
    }
    /* ═══ NEW: ? for shortcuts ═══ */
    if (e.key === '?' && !e.ctrlKey && document.activeElement !== messageInput && document.activeElement !== sysPromptInput && document.activeElement !== chatSearchInput) {
        e.preventDefault();
        shortcutsOverlay.classList.toggle('open');
    }
});

/* ═══ NEW: Input history (Up/Down) ═══ */
messageInput.addEventListener('keydown', function(e) {
    if (e.key === 'ArrowUp' && messageInput.selectionStart === 0 && !e.shiftKey) {
        if (inputHistory.length > 0) {
            e.preventDefault();
            if (historyIdx === -1) { historyIdx = inputHistory.length; }
            historyIdx = Math.max(0, historyIdx - 1);
            messageInput.value = inputHistory[historyIdx] || '';
            messageInput.dispatchEvent(new Event('input'));
        }
    }
    if (e.key === 'ArrowDown' && messageInput.selectionEnd === messageInput.value.length && !e.shiftKey) {
        if (historyIdx >= 0) {
            e.preventDefault();
            historyIdx = Math.min(inputHistory.length, historyIdx + 1);
            messageInput.value = historyIdx === inputHistory.length ? '' : (inputHistory[historyIdx] || '');
            messageInput.dispatchEvent(new Event('input'));
        }
    }
});

// ─── Sidebar ───
$('new-chat-sidebar').addEventListener('click', function() { vscode.postMessage({ type: 'newChat' }); });
$('new-chat-top').addEventListener('click', function() { vscode.postMessage({ type: 'newChat' }); });

/* ═══ NEW: Sidebar collapse ═══ */
$('sidebar-collapse-btn').addEventListener('click', function() {
    sidebar.classList.toggle('collapsed');
    this.innerHTML = sidebar.classList.contains('collapsed') ? '&#9654;' : '&#9664;';
    this.title = sidebar.classList.contains('collapsed') ? 'Expand sidebar' : 'Collapse sidebar';
});

// ─── Undo ───
$('undo-btn').addEventListener('click', function() { vscode.postMessage({ type: 'undoLast' }); });

// ─── System prompt ───
$('sys-prompt-btn').addEventListener('click', function() {
    sysPromptArea.classList.toggle('open');
    if (sysPromptArea.classList.contains('open')) { sysPromptInput.focus(); }
});
$('sys-prompt-save').addEventListener('click', function() {
    vscode.postMessage({ type: 'setSessionSystemPrompt', prompt: sysPromptInput.value });
    sysPromptArea.classList.remove('open');
});

// ─── Export ───
$('export-btn').addEventListener('click', function() { vscode.postMessage({ type: 'exportChat' }); });

// ─── Clear all sessions ───
$('clear-all-sessions').addEventListener('click', function() {
    if (confirm('Delete ALL sessions? This cannot be undone.')) {
        vscode.postMessage({ type: 'clearAllSessions' });
    }
});

/* ═══ NEW: Shortcuts overlay ═══ */
$('shortcuts-btn').addEventListener('click', function() { shortcutsOverlay.classList.add('open'); });
$('shortcuts-close').addEventListener('click', function() { shortcutsOverlay.classList.remove('open'); });
shortcutsOverlay.addEventListener('click', function(e) { if (e.target === shortcutsOverlay) shortcutsOverlay.classList.remove('open'); });

/* ═══ NEW: Stats overlay ═══ */
$('stats-btn').addEventListener('click', function() {
    vscode.postMessage({ type: 'getSessionStats' });
    statsOverlay.classList.add('open');
});
$('stats-close').addEventListener('click', function() { statsOverlay.classList.remove('open'); });
statsOverlay.addEventListener('click', function(e) { if (e.target === statsOverlay) statsOverlay.classList.remove('open'); });

/* ═══ NEW: Search in chat ═══ */
$('search-chat-btn').addEventListener('click', function() {
    chatSearchBar.classList.toggle('open');
    if (chatSearchBar.classList.contains('open')) { chatSearchInput.focus(); }
    else { clearSearchHighlights(); }
});
$('chat-search-close').addEventListener('click', function() {
    chatSearchBar.classList.remove('open');
    clearSearchHighlights();
});
chatSearchInput.addEventListener('input', function() {
    clearSearchHighlights();
    var q = this.value.trim().toLowerCase();
    if (!q) { chatSearchCount.textContent = ''; return; }
    var bubbles = chatMessages.querySelectorAll('.msg-bubble');
    var count = 0;
    bubbles.forEach(function(b) {
        var text = b.textContent || '';
        if (text.toLowerCase().includes(q)) {
            b.style.outline = '2px solid var(--mercury-accent)';
            b.dataset.searchHit = 'true';
            count++;
        }
    });
    chatSearchCount.textContent = count + ' match' + (count !== 1 ? 'es' : '');
});
function clearSearchHighlights() {
    chatMessages.querySelectorAll('[data-search-hit]').forEach(function(b) {
        b.style.outline = '';
        delete b.dataset.searchHit;
    });
    chatSearchCount.textContent = '';
}

/* ═══ NEW: Reasoning effort toggle ═══ */
effortSelect.addEventListener('change', function() {
    vscode.postMessage({ type: 'setReasoningEffort', effort: this.value });
});

/* ═══ NEW: Temperature selector ═══ */
tempSelect.addEventListener('change', function() {
    vscode.postMessage({ type: 'setTemperature', temperature: parseFloat(this.value) });
});

/* ═══ NEW: Max tokens selector ═══ */
tokensSelect.addEventListener('change', function() {
    vscode.postMessage({ type: 'setMaxTokens', maxTokens: parseInt(this.value, 10) });
});

/* ═══ NEW: Drag & drop files ═══ */
document.addEventListener('dragover', function(e) { e.preventDefault(); dropZone.classList.add('active'); });
document.addEventListener('dragleave', function(e) {
    if (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
        dropZone.classList.remove('active');
    }
});
document.addEventListener('drop', function(e) {
    e.preventDefault();
    dropZone.classList.remove('active');
    if (e.dataTransfer && e.dataTransfer.files.length > 0) {
        for (var i = 0; i < e.dataTransfer.files.length; i++) {
            var f = e.dataTransfer.files[i];
            messageInput.value += ' @file(' + f.name + ')';
        }
        messageInput.dispatchEvent(new Event('input'));
        messageInput.focus();
    }
});

/* ═══ NEW: Welcome quick actions ═══ */
document.querySelectorAll('.welcome-action-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
        messageInput.value = this.dataset.action;
        sendMessage();
    });
});

/* ═══ NEW: Templates grid (show/hide) ═══ */
var templateItems = [
    'Explain this code', 'Fix the bugs', 'Write unit tests',
    'Add error handling', 'Optimize performance', 'Add comments',
    'Refactor this function', 'Convert to TypeScript',
];
function renderTemplates() {
    templatesGrid.innerHTML = '';
    for (var t = 0; t < templateItems.length; t++) {
        var btn = document.createElement('button');
        btn.className = 'template-btn';
        btn.textContent = templateItems[t];
        btn.addEventListener('click', function() {
            messageInput.value = this.textContent;
            sendMessage();
        });
        templatesGrid.appendChild(btn);
    }
}
renderTemplates();

// ─── Session search ───
sessionSearchInput.addEventListener('input', function() {
    vscode.postMessage({ type: 'searchSessions', query: this.value });
});

// ─── Model selector ───
inputModel.addEventListener('click', function(e) { e.stopPropagation(); modelDropdown.classList.toggle('open'); });
document.addEventListener('click', function() { modelDropdown.classList.remove('open'); recentFilesDropdown.classList.remove('open'); });
modelDropdown.addEventListener('click', function(e) { e.stopPropagation(); });
document.querySelectorAll('.model-option').forEach(function(opt) {
    opt.addEventListener('click', function() {
        var model = this.dataset.model;
        currentModel = model;
        inputModel.textContent = model;
        document.querySelectorAll('.model-option').forEach(function(o) { o.classList.remove('active'); });
        this.classList.add('active');
        modelDropdown.classList.remove('open');
        if (savedModel && currentMode === 'code') { savedModel = null; }
        vscode.postMessage({ type: 'changeModel', model: model });
        saveState();
    });
});

// ─── Recent files ───
$('at-file-hint').addEventListener('click', function(e) {
    e.stopPropagation();
    vscode.postMessage({ type: 'getRecentFiles' });
});

// ─── Tool confirmation ───
$('confirm-approve').addEventListener('click', function() {
    vscode.postMessage({ type: 'toolConfirmResult', approved: true });
    confirmOverlay.classList.remove('open');
});
$('confirm-deny').addEventListener('click', function() {
    vscode.postMessage({ type: 'toolConfirmResult', approved: false });
    confirmOverlay.classList.remove('open');
});

// ─── Time formatting ───
function formatTime(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    var h = d.getHours(); var m = d.getMinutes();
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
}
function formatDateGroup(ts) {
    var now = new Date();
    var d = new Date(ts);
    var diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return 'This Week';
    if (diffDays < 30) return 'This Month';
    return 'Older';
}

// ─── Session list with date groups, pins, and color tags ───
function renderSessionList(sessions, activeId) {
    sessionList.innerHTML = '';
    var sorted = sessions.slice().sort(function(a, b) {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt);
    });
    var lastGroup = '';
    var tagColors = ['#e85149','#e8a030','#4ec970','#4e9fd5','#7c6bf5','#c586c0'];
    for (var i = 0; i < sorted.length; i++) {
        var s = sorted[i];
        var group = s.pinned ? 'Pinned' : formatDateGroup(s.updatedAt || s.createdAt);
        if (group !== lastGroup) {
            var groupDiv = document.createElement('div');
            groupDiv.className = 'session-date-group';
            groupDiv.textContent = group;
            sessionList.appendChild(groupDiv);
            lastGroup = group;
        }
        var div = document.createElement('div');
        div.className = 'session-item' + (s.id === activeId ? ' active' : '');

        /* ═══ NEW: Color tag ═══ */
        var tag = document.createElement('span');
        tag.className = 'session-tag';
        tag.style.background = s.tag || 'transparent';
        tag.title = 'Set color tag';
        tag.dataset.id = s.id;
        tag.dataset.tagIdx = String(tagColors.indexOf(s.tag || '') + 1);
        tag.addEventListener('click', function(e) {
            e.stopPropagation();
            var idx = (parseInt(this.dataset.tagIdx) + 1) % (tagColors.length + 1);
            this.dataset.tagIdx = String(idx);
            var color = idx === 0 ? '' : tagColors[idx - 1];
            this.style.background = color || 'transparent';
            vscode.postMessage({ type: 'tagSession', id: this.dataset.id, tag: color });
        });
        div.appendChild(tag);

        // Pin button
        var pin = document.createElement('span');
        pin.className = 'session-pin' + (s.pinned ? ' pinned' : '');
        pin.innerHTML = '&#128204;';
        pin.title = s.pinned ? 'Unpin' : 'Pin';
        pin.dataset.id = s.id;
        pin.dataset.pinned = s.pinned ? 'true' : 'false';
        pin.addEventListener('click', function(e) {
            e.stopPropagation();
            var newPinned = this.dataset.pinned !== 'true';
            vscode.postMessage({ type: 'pinSession', id: this.dataset.id, pinned: newPinned });
        });
        div.appendChild(pin);

        var infoCol = document.createElement('div');
        infoCol.style.cssText = 'flex:1; min-width:0; display:flex; flex-direction:column;';
        var titleSpan = document.createElement('span');
        titleSpan.className = 'session-title';
        titleSpan.textContent = s.title;
        infoCol.appendChild(titleSpan);
        if (s.intent) {
            var intentSpan = document.createElement('span');
            intentSpan.className = 'session-intent';
            intentSpan.textContent = s.intent;
            infoCol.appendChild(intentSpan);
        }
        div.appendChild(infoCol);

        var actions = document.createElement('div');
        actions.className = 'session-actions';
        var renBtn = document.createElement('button');
        renBtn.textContent = '\u270f';
        renBtn.title = 'Rename';
        renBtn.dataset.id = s.id;
        renBtn.dataset.title = s.title;
        renBtn.addEventListener('click', function(e) { e.stopPropagation(); openRename(this.dataset.id, this.dataset.title); });
        actions.appendChild(renBtn);
        var delBtn = document.createElement('button');
        delBtn.textContent = '\u00d7';
        delBtn.title = 'Delete';
        delBtn.dataset.id = s.id;
        delBtn.dataset.title = s.title;
        delBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            if (confirm('Delete "' + this.dataset.title + '"?')) { vscode.postMessage({ type: 'deleteSession', id: this.dataset.id }); }
        });
        actions.appendChild(delBtn);
        div.appendChild(actions);

        div.dataset.id = s.id;
        div.addEventListener('click', function() { vscode.postMessage({ type: 'switchSession', id: this.dataset.id }); });
        sessionList.appendChild(div);
    }
}

// ─── Rename dialog ───
function openRename(id, title) {
    renamingId = id;
    renameInput.value = title;
    renameOverlay.classList.add('open');
    renameInput.focus();
    renameInput.select();
}
$('rename-save').addEventListener('click', saveRename);
$('rename-cancel').addEventListener('click', function() { renameOverlay.classList.remove('open'); });
renameInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') saveRename();
    if (e.key === 'Escape') renameOverlay.classList.remove('open');
});
function saveRename() {
    var title = renameInput.value.trim();
    if (title && renamingId) { vscode.postMessage({ type: 'renameSession', id: renamingId, title: title }); }
    renameOverlay.classList.remove('open');
}

// ─── Input ───
messageInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
sendBtn.addEventListener('click', sendMessage);
stopBtn.addEventListener('click', function() { vscode.postMessage({ type: 'stopGeneration' }); });

function sendMessage() {
    var text = messageInput.value.trim();
    if (!text || isStreaming) return;

    /* ═══ NEW: Slash command detection ═══ */
    if (text.startsWith('/')) {
        var parts = text.split(/\s+/);
        var cmd = parts[0];
        var args = parts.slice(1).join(' ');
        vscode.postMessage({ type: 'slashCommand', command: cmd, args: args });
        messageInput.value = '';
        messageInput.style.height = 'auto';
        charCount.textContent = '';
        slashHint.classList.remove('open');
        return;
    }

    /* ═══ NEW: Save to input history ═══ */
    inputHistory.push(text);
    if (inputHistory.length > 50) inputHistory.shift();
    historyIdx = -1;

    /* ═══ NEW: Save input draft ═══ */
    vscode.postMessage({ type: 'saveInputDraft', text: '' });

    welcome.style.display = 'none';
    followUpsDiv.classList.remove('visible');
    vscode.postMessage({ type: 'sendMessage', text: text, mode: currentMode });
    messageInput.value = '';
    messageInput.style.height = 'auto';
    charCount.textContent = '';
    slashHint.classList.remove('open');
    saveState();
}

/* ═══ NEW: Save draft on input ═══ */
messageInput.addEventListener('blur', function() {
    vscode.postMessage({ type: 'saveInputDraft', text: messageInput.value });
});

// ─── Markdown rendering ───
function escapeHtml(t) { return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function highlightCode(code, lang) {
    var kwPat = /\b(function|const|let|var|class|return|if|else|for|while|do|switch|case|break|continue|default|import|export|from|as|async|await|new|this|try|catch|throw|finally|typeof|instanceof|void|delete|in|of|yield|interface|type|enum|extends|implements|private|protected|public|static|constructor|abstract|readonly|def|self|elif|lambda|pass|raise|except|None|True|False)\b/g;
    var biPat = /\b(console|document|window|Math|JSON|Array|Object|String|Number|Boolean|Promise|Map|Set|RegExp|Error|Date|parseInt|parseFloat|setTimeout|setInterval|fetch|require|module|exports|process|null|undefined|true|false|NaN|Infinity|print|len|range|list|dict|tuple|set|str|int|float|bool)\b/g;
    code = code.replace(/(\/\/.*$)/gm, '<span class="hljs-cmt">$1</span>');
    code = code.replace(/\b(\d+\.?\d*)\b/g, '<span class="hljs-num">$1</span>');
    code = code.replace(kwPat, '<span class="hljs-kw">$1</span>');
    code = code.replace(biPat, '<span class="hljs-bi">$1</span>');
    return code;
}

var codeBlockLangs = [];
function renderMarkdown(text) {
    if (!text) return '';
    var blocks = [];
    codeBlockLangs = [];
    text = text.replace(/```(\w*)?\\n([\\s\\S]*?)```/g, function(_, lang, code) {
        var i = blocks.length;
        codeBlockLangs.push(lang || '');
        var escaped = escapeHtml(code.trim());
        var highlighted = highlightCode(escaped, lang || '');

        /* ═══ NEW: Line numbers in code blocks ═══ */
        var lines = highlighted.split('\\n');
        var numberedLines = lines.map(function(line, idx) {
            var diffClass = '';
            if (line.match(/^\+[^+]/) || line.match(/^<span class="diff-add">/)) diffClass = ' diff-add';
            else if (line.match(/^-[^-]/) || line.match(/^<span class="diff-del">/)) diffClass = ' diff-del';
            return '<span class="line-num-gutter">' + (idx + 1) + '</span>' + line;
        }).join('\\n');

        blocks.push('<pre class="line-numbers" data-lang="' + (lang||'') + '"><code class="language-' + (lang||'') + '">' + numberedLines + '</code></pre>');
        return '%%CB' + i + '%%';
    });
    var html = escapeHtml(text);
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
    html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
    html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');
    html = html.replace(/^---+$/gm, '<hr>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function(_, label, url) {
        if (/^(javascript|data|vbscript):/i.test(url.trim())) { return label; }
        return '<a href="' + url + '" target="_blank">' + label + '</a>';
    });
    html = html.replace(/^&gt;\s?(.*)$/gm, '<blockquote>$1</blockquote>');
    html = html.replace(/<\/blockquote>\n<blockquote>/g, '\n');
    html = html.replace(/(^|\n)([-*]\s+.+(\n|$))+/g, function(block) {
        var items = block.trim().split('\n').map(function(line) { return '<li>' + line.replace(/^[-*]\s+/, '') + '</li>'; }).join('');
        return '<ul>' + items + '</ul>';
    });
    html = html.replace(/(^|\n)(\d+\.\s+.+(\n|$))+/g, function(block) {
        var items = block.trim().split('\n').map(function(line) { return '<li>' + line.replace(/^\d+\.\s+/, '') + '</li>'; }).join('');
        return '<ol>' + items + '</ol>';
    });
    html = html.replace(/((\|.+\|[\t ]*\n)+)/g, function(tableBlock) {
        var rows = tableBlock.trim().split('\n');
        var result = '<table>';
        for (var r = 0; r < rows.length; r++) {
            if (rows[r].match(/^\|[\s\-:|]+\|$/)) continue;
            var cells = rows[r].replace(/^\||\|$/g, '').split('|');
            var tag = r === 0 ? 'th' : 'td';
            result += '<tr>' + cells.map(function(c) { return '<' + tag + '>' + c.trim() + '</' + tag + '>'; }).join('') + '</tr>';
        }
        result += '</table>';
        return result;
    });
    html = html.replace(/\n/g, '<br>');
    html = html.replace(/<\/(h[1-6]|blockquote|pre|ul|ol|li|table|hr)><br>/g, '</$1>');
    html = html.replace(/<br><(h[1-6]|blockquote|pre|ul|ol|table|hr|\/)/g, '<$1');
    for (var i = 0; i < blocks.length; i++) { html = html.replace('%%CB' + i + '%%', blocks[i]); }
    return html;
}

function addCodeActionButtons(container) {
    container.querySelectorAll('pre').forEach(function(pre) {
        if (pre.querySelector('.code-actions')) return;
        pre.style.position = 'relative';
        var actionsDiv = document.createElement('div');
        actionsDiv.className = 'code-actions';
        var lang = pre.dataset.lang || '';
        var code = pre.querySelector('code');
        var codeText = code ? code.textContent || '' : '';
        var btns = [
            { label: 'Copy', action: function(btn) { navigator.clipboard.writeText(codeText); btn.textContent = 'Copied!'; setTimeout(function() { btn.textContent = 'Copy'; }, 2000); } },
            { label: 'Insert', title: 'Insert at cursor', action: function(btn) { vscode.postMessage({ type: 'insertAtCursor', code: codeText }); btn.textContent = 'Inserted!'; setTimeout(function() { btn.textContent = 'Insert'; }, 2000); } },
            { label: 'Apply', title: 'Replace selection', action: function(btn) { vscode.postMessage({ type: 'applyToFile', code: codeText, language: lang }); btn.textContent = 'Applied!'; setTimeout(function() { btn.textContent = 'Apply'; }, 2000); } },
            { label: 'New File', title: 'Open in new file', action: function() { vscode.postMessage({ type: 'newFileWithCode', code: codeText, language: lang }); } },
        ];
        btns.forEach(function(b) {
            var btn = document.createElement('button');
            btn.className = 'code-action-btn';
            btn.textContent = b.label;
            if (b.title) btn.title = b.title;
            btn.addEventListener('click', function() { b.action(btn); });
            actionsDiv.appendChild(btn);
        });
        pre.appendChild(actionsDiv);
    });
}

function addMessage(role, content, timestamp) {
    welcome.style.display = 'none';
    followUpsDiv.classList.remove('visible');
    var myIdx = msgIndex++;
    var row = document.createElement('div');
    row.className = 'msg-row ' + role;
    row.style.position = 'relative';
    row.dataset.msgIdx = myIdx;

    var avatar = document.createElement('div');
    avatar.className = 'msg-avatar ' + (role === 'user' ? 'user-av' : 'bot-av');
    if (role === 'user') { avatar.textContent = 'U'; }
    else { avatar.innerHTML = '<img src="' + logoUri + '" alt="M">'; }
    row.appendChild(avatar);

    var bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.innerHTML = renderMarkdown(content);

    // Collapsible long user messages
    if (role === 'user' && content && content.length > 500) {
        bubble.classList.add('collapsible');
        var expandBtn = document.createElement('button');
        expandBtn.className = 'expand-btn';
        expandBtn.textContent = 'Show more';
        expandBtn.addEventListener('click', function() {
            bubble.classList.toggle('expanded');
            expandBtn.textContent = bubble.classList.contains('expanded') ? 'Show less' : 'Show more';
        });
        row.appendChild(expandBtn);
    }

    row.appendChild(bubble);

    // Timestamp
    var timeDiv = document.createElement('div');
    timeDiv.className = 'msg-time';
    timeDiv.textContent = formatTime(timestamp || Date.now());
    row.appendChild(timeDiv);

    /* ═══ NEW: Word count for assistant ═══ */
    if (role === 'assistant' && content) {
        var words = content.trim().split(/\s+/).length;
        var wcDiv = document.createElement('div');
        wcDiv.className = 'word-count-badge';
        wcDiv.textContent = words + ' words';
        row.appendChild(wcDiv);

        /* ═══ v0.19.0: Estimated token cost badge ═══ */
        var estTokens = Math.ceil(content.length / 4);
        var estCost = calculateCost(0, estTokens, 0);
        sessionTotalTokens += estTokens;
        sessionTotalOutputTokens += estTokens;
        sessionTotalCost += estCost;
        var tcBadge = document.createElement('div');
        tcBadge.className = 'token-cost-badge';
        tcBadge.innerHTML = '<span>\u26a1 ~' + estTokens.toLocaleString() + ' out (est.)</span><span>\u00b7 ~' + formatCost(estCost) + '</span><span>\u00b7 Session: ' + sessionTotalTokens.toLocaleString() + ' \u00b7 ' + formatCost(sessionTotalCost) + '</span>';
        row.appendChild(tcBadge);
    }

    // Message action buttons
    var actionsDiv = document.createElement('div');
    actionsDiv.className = 'msg-actions';

    /* ═══ NEW: Bookmark button ═══ */
    var bookmarkBtn = document.createElement('button');
    bookmarkBtn.className = 'msg-action-btn msg-bookmark';
    bookmarkBtn.innerHTML = '&#9733;';
    bookmarkBtn.title = 'Bookmark';
    bookmarkBtn.addEventListener('click', function() {
        var isBookmarked = this.classList.toggle('bookmarked');
        vscode.postMessage({ type: 'bookmarkMessage', messageIndex: myIdx, bookmarked: isBookmarked });
    });
    actionsDiv.appendChild(bookmarkBtn);

    /* ═══ NEW: Markdown toggle (assistant only) ═══ */
    if (role === 'assistant') {
        var mdToggle = document.createElement('button');
        mdToggle.className = 'msg-action-btn md-toggle-btn';
        mdToggle.textContent = 'MD';
        mdToggle.title = 'Toggle raw markdown';
        mdToggle.dataset.raw = 'false';
        mdToggle.addEventListener('click', function() {
            if (this.dataset.raw === 'false') {
                bubble.textContent = content;
                this.dataset.raw = 'true';
                this.textContent = 'HTML';
            } else {
                bubble.innerHTML = renderMarkdown(content);
                addCodeActionButtons(bubble);
                this.dataset.raw = 'false';
                this.textContent = 'MD';
            }
        });
        actionsDiv.appendChild(mdToggle);
    }

    if (role === 'user') {
        var editBtn = document.createElement('button');
        editBtn.className = 'msg-action-btn';
        editBtn.textContent = '\u270f';
        editBtn.title = 'Edit & resubmit';
        editBtn.addEventListener('click', function() {
            var newText = prompt('Edit message:', content);
            if (newText !== null && newText.trim()) {
                vscode.postMessage({ type: 'editAndResubmit', messageIndex: myIdx, newText: newText, mode: currentMode });
            }
        });
        actionsDiv.appendChild(editBtn);
    } else {
        var regenBtn = document.createElement('button');
        regenBtn.className = 'msg-action-btn';
        regenBtn.textContent = '\u21bb';
        regenBtn.title = 'Regenerate';
        regenBtn.addEventListener('click', function() { vscode.postMessage({ type: 'regenerate' }); });
        actionsDiv.appendChild(regenBtn);
        var copyMd = document.createElement('button');
        copyMd.className = 'msg-action-btn';
        copyMd.textContent = '\ud83d\udccb';
        copyMd.title = 'Copy as Markdown';
        copyMd.addEventListener('click', function() {
            navigator.clipboard.writeText(content || '');
            copyMd.textContent = '\u2713';
            setTimeout(function() { copyMd.textContent = '\ud83d\udccb'; }, 2000);
        });
        actionsDiv.appendChild(copyMd);
    }
    var delMsgBtn = document.createElement('button');
    delMsgBtn.className = 'msg-action-btn';
    delMsgBtn.textContent = '\u00d7';
    delMsgBtn.title = 'Delete message';
    delMsgBtn.addEventListener('click', function() {
        if (confirm('Delete this message?')) { vscode.postMessage({ type: 'deleteMessage', messageIndex: myIdx }); }
    });
    actionsDiv.appendChild(delMsgBtn);
    row.appendChild(actionsDiv);

    /* ═══ NEW: Reaction buttons (assistant only) ═══ */
    if (role === 'assistant') {
        var reactDiv = document.createElement('div');
        reactDiv.className = 'msg-reactions';
        var thumbUp = document.createElement('button');
        thumbUp.className = 'reaction-btn';
        thumbUp.innerHTML = '&#128077;';
        thumbUp.title = 'Helpful';
        thumbUp.addEventListener('click', function() {
            this.classList.toggle('active');
            vscode.postMessage({ type: 'reactionMessage', messageIndex: myIdx, reaction: 'thumbsUp' });
        });
        var thumbDown = document.createElement('button');
        thumbDown.className = 'reaction-btn';
        thumbDown.innerHTML = '&#128078;';
        thumbDown.title = 'Not helpful';
        thumbDown.addEventListener('click', function() {
            this.classList.toggle('active');
            vscode.postMessage({ type: 'reactionMessage', messageIndex: myIdx, reaction: 'thumbsDown' });
        });
        reactDiv.appendChild(thumbUp);
        reactDiv.appendChild(thumbDown);
        row.appendChild(reactDiv);

        /* ═══ v0.14.0: Rating bar (#13) ═══ */
        var ratingBar = document.createElement('div');
        ratingBar.className = 'rating-bar';
        var rateLabel = document.createElement('span');
        rateLabel.style.cssText = 'font-size:0.72em;opacity:0.45;';
        rateLabel.textContent = 'Was this helpful?';
        ratingBar.appendChild(rateLabel);
        ['\ud83d\udc4d Yes', '\ud83d\udc4e No', '\ud83d\udd04 Needs work'].forEach(function(lbl) {
            var rbtn = document.createElement('button');
            rbtn.className = 'rate-btn';
            rbtn.textContent = lbl;
            rbtn.addEventListener('click', function() {
                ratingBar.querySelectorAll('.rate-btn').forEach(function(b) { b.classList.remove('selected'); });
                rbtn.classList.add('selected');
                ratingBar.classList.add('rated');
                vscode.postMessage({ type: 'rateResponse', messageIndex: myIdx, rating: lbl });
            });
            ratingBar.appendChild(rbtn);
        });
        row.appendChild(ratingBar);
    }

    chatMessages.insertBefore(row, followUpsDiv);
    addCodeActionButtons(bubble);
    smartScroll();
    return row;
}

function smartScroll() { if (autoScroll) chatMessages.scrollTop = chatMessages.scrollHeight; }

function addToolGroupForReload(toolCalls) {
    var group = document.createElement('div');
    group.className = 'tool-group collapsed';
    var header = document.createElement('div');
    header.className = 'tool-group-header';
    header.innerHTML = '<span class="tool-chevron">&#9660;</span> <span class="tool-count">Used ' + toolCalls.length + ' tool' + (toolCalls.length > 1 ? 's' : '') + '</span>';
    header.addEventListener('click', function() { group.classList.toggle('collapsed'); });
    group.appendChild(header);
    var body = document.createElement('div');
    body.className = 'tool-group-body';
    var icons = { 'read_file': '&#128196;', 'write_file': '&#9997;', 'edit_file': '&#9986;', 'list_files': '&#128194;', 'search_files': '&#128269;', 'run_command': '&#9654;' };
    for (var t = 0; t < toolCalls.length; t++) {
        var tc = toolCalls[t];
        var icon = icons[tc.function.name] || '&#128295;';
        var argDisplay = '';
        try { var a = JSON.parse(tc.function.arguments); argDisplay = a.path || a.pattern || a.command || ''; } catch(e) {}
        var item = document.createElement('div');
        item.className = 'tool-item';
        item.innerHTML = '<span class="tool-item-icon">' + icon + '</span><span class="tool-item-name">' + escapeHtml(tc.function.name) + '</span><span class="tool-item-arg">' + escapeHtml(argDisplay) + '</span><span class="tool-item-status">&#9989;</span>';
        body.appendChild(item);
    }
    group.appendChild(body);
    chatMessages.insertBefore(group, followUpsDiv);
}

function ensureToolGroup() {
    if (!toolGroupDiv) {
        toolGroupDiv = document.createElement('div');
        toolGroupDiv.className = 'tool-group';
        var header = document.createElement('div');
        header.className = 'tool-group-header';
        header.innerHTML = '<span class="tool-chevron">&#9660;</span> <span class="tool-spinner"></span> <span class="tool-count">Working...</span>';
        header.addEventListener('click', function() { toolGroupDiv.classList.toggle('collapsed'); });
        toolGroupDiv.appendChild(header);
        toolGroupBody = document.createElement('div');
        toolGroupBody.className = 'tool-group-body';
        toolGroupDiv.appendChild(toolGroupBody);
        toolCount = 0;
        if (currentStreamDiv) { chatMessages.insertBefore(toolGroupDiv, currentStreamDiv); }
        else { chatMessages.insertBefore(toolGroupDiv, followUpsDiv); }
    }
}

function addToolItem(name, args, status, result) {
    ensureToolGroup();
    toolCount++;
    var icons = { 'read_file': '&#128196;', 'write_file': '&#9997;', 'edit_file': '&#9986;', 'list_files': '&#128194;', 'search_files': '&#128269;', 'run_command': '&#9654;' };
    var icon = icons[name] || '&#128295;';
    var statusIcon = status === 'running' ? '<span class="tool-spinner"></span>' : status === 'done' ? '&#9989;' : '&#10060;';
    var argDisplay = '';
    try { var a = JSON.parse(args); argDisplay = a.path || a.pattern || a.command || ''; } catch(e) {}
    var item = document.createElement('div');
    item.className = 'tool-item';
    item.innerHTML = '<span class="tool-item-icon">' + icon + '</span><span class="tool-item-name">' + escapeHtml(name) + '</span><span class="tool-item-arg">' + escapeHtml(argDisplay) + '</span><span class="tool-item-status">' + statusIcon + '</span>';
    if (result) { var resDiv = document.createElement('div'); resDiv.className = 'tool-item-result'; resDiv.textContent = result; item.appendChild(resDiv); }
    /* v0.14.0: Click to expand/collapse tool result (#16) */
    item.addEventListener('click', function() { item.classList.toggle('expanded'); });
    toolGroupBody.appendChild(item);
    var runningTools = toolGroupBody.querySelectorAll('.tool-spinner').length;
    var headerCount = toolGroupDiv.querySelector('.tool-count');
    var headerSpinner = toolGroupDiv.querySelector('.tool-group-header > .tool-spinner');
    if (runningTools > 0) {
        headerCount.textContent = 'Using ' + toolCount + ' tool' + (toolCount > 1 ? 's' : '') + '...';
        if (headerSpinner) headerSpinner.style.display = '';
    } else {
        headerCount.textContent = 'Used ' + toolCount + ' tool' + (toolCount > 1 ? 's' : '');
        if (headerSpinner) headerSpinner.style.display = 'none';
        toolGroupDiv.classList.add('collapsed');
    }
    smartScroll();
}

/* ═══ Incremental stream rendering state ═══ */
var lastRenderedLen = 0;
var insideCodeFence = false;

function renderStreamContent() {
    if (!currentStreamDiv) return;
    var bubble = currentStreamDiv.querySelector('.msg-bubble');
    if (!bubble) return;

    // Detect open code fences in the new delta
    var delta = streamContent.slice(lastRenderedLen);
    var fenceMatches = delta.match(/```/g);
    if (fenceMatches) {
        for (var fi = 0; fi < fenceMatches.length; fi++) insideCodeFence = !insideCodeFence;
    }

    // If we're inside an open code fence, defer — partial code blocks render badly
    // But still do a full render every 2000 chars to avoid huge deferred batches
    if (insideCodeFence && (streamContent.length - lastRenderedLen) < 2000) {
        smartScroll();
        return;
    }

    // Full markdown render (safest for tables, lists, headings)
    bubble.innerHTML = renderMarkdown(streamContent);
    lastRenderedLen = streamContent.length;
    smartScroll();
}

function renderFollowUps(items) {
    followUpsDiv.innerHTML = '';
    if (!items || items.length === 0) { followUpsDiv.classList.remove('visible'); return; }
    for (var f = 0; f < items.length; f++) {
        var btn = document.createElement('button');
        btn.className = 'follow-up-btn';
        btn.textContent = items[f];
        btn.addEventListener('click', function() {
            messageInput.value = this.textContent;
            sendMessage();
        });
        followUpsDiv.appendChild(btn);
    }
    followUpsDiv.classList.add('visible');
}

/* ═══ NEW: Update context chips ═══ */
function updateContextChips(context) {
    contextChips.innerHTML = '';
    if (!context) { contextChips.classList.remove('visible'); return; }
    var chips = [];
    if (context.path) chips.push({ icon: '\ud83d\udcc4', label: context.path });
    if (context.selection) chips.push({ icon: '\u2702', label: 'Selection (' + context.selection.split('\n').length + ' lines)' });
    if (context.diagnostics && context.diagnostics.length > 0) chips.push({ icon: '\u26a0', label: context.diagnostics.length + ' problems' });
    if (chips.length === 0) { contextChips.classList.remove('visible'); return; }
    for (var c = 0; c < chips.length; c++) {
        var chip = document.createElement('span');
        chip.className = 'context-chip';
        chip.innerHTML = chips[c].icon + ' ' + escapeHtml(chips[c].label);
        contextChips.appendChild(chip);
    }
    contextChips.classList.add('visible');
}

// ─── Message handler ───
window.addEventListener('message', function(event) {
    var msg = event.data;
    switch (msg.type) {
        case 'sessionList':
            renderSessionList(msg.sessions, msg.activeId);
            break;
        case 'loadSession':
            var children = Array.from(chatMessages.children);
            for (var c = 0; c < children.length; c++) {
                if (children[c] !== welcome && children[c] !== scrollAnchor && children[c] !== followUpsDiv
                    && children[c] !== thinkingTimer && children[c] !== tokenSpeed && children[c] !== $('auto-scroll-indicator')) {
                    chatMessages.removeChild(children[c]);
                }
            }
            toolGroupDiv = null; toolGroupBody = null; toolCount = 0; msgIndex = 0;
            followUpsDiv.classList.remove('visible');
            if (msg.session.messages.length === 0) { welcome.style.display = ''; }
            else {
                welcome.style.display = 'none';
                /* ═══ DOM batch: build all messages in a DocumentFragment ═══ */
                var frag = document.createDocumentFragment();
                // Temporarily redirect addMessage to append into the fragment
                var origInsertBefore = chatMessages.insertBefore.bind(chatMessages);
                chatMessages.insertBefore = function(node) { frag.appendChild(node); return node; };
                var msgs = msg.session.messages;
                for (var i = 0; i < msgs.length; i++) {
                    var m = msgs[i];
                    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
                        if (m.content) addMessage('assistant', m.content);
                        addToolGroupForReload(m.tool_calls);
                    } else if (m.role === 'tool') { continue; }
                    else if (m.content) { addMessage(m.role, m.content); }
                }
                // Restore and insert all at once (single reflow)
                chatMessages.insertBefore = origInsertBefore;
                chatMessages.insertBefore(frag, followUpsDiv);
            }
            activeTitle.textContent = msg.session.title;
            sysPromptInput.value = msg.session.systemPrompt || '';
            if (prevState && prevState.scrollTop) { chatMessages.scrollTop = prevState.scrollTop; prevState = null; }
            break;
        case 'updateTitle':
            activeTitle.textContent = msg.title;
            break;
        case 'addMessage':
            addMessage(msg.role, msg.content);
            break;
        case 'startStream':
            isStreaming = true;
            document.body.classList.add('streaming');
            sendBtn.style.display = 'none';
            stopBtn.style.display = '';
            sendBtn.disabled = true;
            streamContent = '';
            streamTokenCount = 0;
            streamStartTs = Date.now();
            lastRenderedLen = 0;
            insideCodeFence = false;
            toolGroupDiv = null; toolGroupBody = null; toolCount = 0;
            autoScroll = true;
            userScrolledUp = false;
            followUpsDiv.classList.remove('visible');
            if (quickActions) quickActions.classList.remove('visible');
            if (scrollLockBtn) scrollLockBtn.classList.remove('visible');
            if (streamStats) streamStats.innerHTML = '';

            /* ═══ NEW: Thinking timer ═══ */
            thinkingStart = Date.now();
            thinkingTimer.textContent = 'Thinking... 0.0s';
            if (thinkingInterval) clearInterval(thinkingInterval);
            thinkingInterval = setInterval(function() {
                var elapsed = ((Date.now() - thinkingStart) / 1000).toFixed(1);
                thinkingTimer.textContent = 'Thinking... ' + elapsed + 's';
            }, 100);

            currentStreamDiv = document.createElement('div');
            currentStreamDiv.className = 'msg-row assistant';
            var sAvatar = document.createElement('div');
            sAvatar.className = 'msg-avatar bot-av';
            sAvatar.innerHTML = '<img src="' + logoUri + '" alt="M">';
            currentStreamDiv.appendChild(sAvatar);
            var sBubble = document.createElement('div');
            sBubble.className = 'msg-bubble';
            sBubble.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
            currentStreamDiv.appendChild(sBubble);
            chatMessages.insertBefore(currentStreamDiv, followUpsDiv);
            smartScroll();
            break;
        case 'streamToken':
            if (currentStreamDiv) {
                streamContent += msg.token;
                streamTokenCount++;

                /* ═══ NEW: Tokens/sec display ═══ */
                var elapsedSec = (Date.now() - streamStartTs) / 1000;
                if (elapsedSec > 0.5) {
                    var tps = (streamTokenCount / elapsedSec).toFixed(1);
                    tokenSpeed.textContent = '\u26a1 ' + tps + ' tokens/sec';
                    /* v0.14.0: stream stats (#15) */
                    if (streamStats) {
                        streamStats.innerHTML = '<span class="stream-stat">\u26a1 ' + tps + ' t/s</span><span class="stream-stat">\ud83d\udcdd ' + streamTokenCount + ' tokens</span><span class="stream-stat">\u23f1 ' + elapsedSec.toFixed(1) + 's</span>';
                    }
                }

                /* ═══ NEW: Stop thinking timer once tokens arrive ═══ */
                if (thinkingInterval && streamTokenCount === 1) {
                    clearInterval(thinkingInterval);
                    thinkingInterval = null;
                    var ttft = ((Date.now() - thinkingStart) / 1000).toFixed(1);
                    thinkingTimer.textContent = 'Time to first token: ' + ttft + 's';
                }

                if (renderTimer) clearTimeout(renderTimer);
                /* ═══ Adaptive render throttle: scale with content size ═══ */
                /* ═══ Skip-render-on-scroll-up: defer DOM work while user reads earlier content ═══ */
                var renderDelay = autoScroll
                    ? (streamContent.length < 2000 ? 30 : streamContent.length < 8000 ? 60 : 120)
                    : 500;
                renderTimer = setTimeout(renderStreamContent, renderDelay);
            }
            break;
        case 'endStream':
            isStreaming = false;
            document.body.classList.remove('streaming');
            sendBtn.style.display = '';
            stopBtn.style.display = 'none';
            sendBtn.disabled = false;
            if (thinkingInterval) { clearInterval(thinkingInterval); thinkingInterval = null; }
            if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
            if (currentStreamDiv) {
                var endBubble = currentStreamDiv.querySelector('.msg-bubble');
                if (streamContent && endBubble) {
                    endBubble.innerHTML = renderMarkdown(streamContent);
                    addCodeActionButtons(endBubble);

                    /* ═══ NEW: Word count ═══ */
                    var wc = streamContent.trim().split(/\s+/).length;
                    var wcDiv = document.createElement('div');
                    wcDiv.className = 'word-count-badge';
                    wcDiv.textContent = wc + ' words';
                    currentStreamDiv.appendChild(wcDiv);

                    /* ═══ Provider badge ═══ */
                    if (msg.provider) {
                        var provBadge = document.createElement('div');
                        provBadge.className = 'provider-badge';
                        provBadge.textContent = 'via ' + msg.provider;
                        currentStreamDiv.appendChild(provBadge);
                    }

                    /* ═══ NEW: Reaction buttons ═══ */
                    var reactDiv = document.createElement('div');
                    reactDiv.className = 'msg-reactions';
                    var myStreamIdx = msgIndex;
                    var thumbUp = document.createElement('button');
                    thumbUp.className = 'reaction-btn';
                    thumbUp.innerHTML = '&#128077;';
                    thumbUp.addEventListener('click', function() {
                        this.classList.toggle('active');
                        vscode.postMessage({ type: 'reactionMessage', messageIndex: myStreamIdx, reaction: 'thumbsUp' });
                    });
                    var thumbDown = document.createElement('button');
                    thumbDown.className = 'reaction-btn';
                    thumbDown.innerHTML = '&#128078;';
                    thumbDown.addEventListener('click', function() {
                        this.classList.toggle('active');
                        vscode.postMessage({ type: 'reactionMessage', messageIndex: myStreamIdx, reaction: 'thumbsDown' });
                    });
                    reactDiv.appendChild(thumbUp);
                    reactDiv.appendChild(thumbDown);
                    currentStreamDiv.appendChild(reactDiv);

                    /* v0.14.0: Rating bar on streamed responses (#13) */
                    var ratingBar = document.createElement('div');
                    ratingBar.className = 'rating-bar';
                    var rateLabel = document.createElement('span');
                    rateLabel.style.cssText = 'font-size:0.72em;opacity:0.45;';
                    rateLabel.textContent = 'Was this helpful?';
                    ratingBar.appendChild(rateLabel);
                    ['\ud83d\udc4d Yes', '\ud83d\udc4e No', '\ud83d\udd04 Needs work'].forEach(function(lbl) {
                        var rbtn = document.createElement('button');
                        rbtn.className = 'rate-btn';
                        rbtn.textContent = lbl;
                        rbtn.addEventListener('click', function() {
                            ratingBar.querySelectorAll('.rate-btn').forEach(function(b) { b.classList.remove('selected'); });
                            rbtn.classList.add('selected');
                            ratingBar.classList.add('rated');
                            vscode.postMessage({ type: 'rateResponse', messageIndex: myStreamIdx, rating: lbl });
                        });
                        ratingBar.appendChild(rbtn);
                    });
                    currentStreamDiv.appendChild(ratingBar);

                    msgIndex++;
                } else if (msg.cancelled && endBubble) {
                    endBubble.innerHTML = renderMarkdown(streamContent + '\n\n*Cancelled.*');
                    addCodeActionButtons(endBubble);
                }
                if (msg.usage) {
                    var inputTk = msg.usage.prompt || 0;
                    var outputTk = msg.usage.completion || 0;
                    var totalTk = msg.usage.total || 0;
                    var reasonTk = msg.usage.reasoning || 0;
                    var cachedTk = msg.usage.cached || 0;
                    var msgCost = calculateCost(inputTk, outputTk, cachedTk);
                    sessionTotalInputTokens += inputTk;
                    sessionTotalOutputTokens += outputTk;
                    sessionTotalReasoningTokens += reasonTk;
                    sessionTotalCachedTokens += cachedTk;
                    sessionTotalTokens += totalTk;
                    sessionTotalCost += msgCost;
                    var costBadge = document.createElement('div');
                    costBadge.className = 'token-cost-badge';
                    var parts = '<span>\u26a1 ' + inputTk.toLocaleString() + ' in</span>';
                    parts += '<span>' + outputTk.toLocaleString() + ' out</span>';
                    if (reasonTk > 0) parts += '<span>' + reasonTk.toLocaleString() + ' reasoning</span>';
                    if (cachedTk > 0) parts += '<span>' + cachedTk.toLocaleString() + ' cached</span>';
                    parts += '<span>= ' + totalTk.toLocaleString() + ' total</span>';
                    parts += '<span>\u00b7 ' + formatCost(msgCost) + '</span>';
                    parts += '<span>\u00b7 Session: ' + sessionTotalTokens.toLocaleString() + ' \u00b7 ' + formatCost(sessionTotalCost) + '</span>';
                    costBadge.innerHTML = parts;
                    currentStreamDiv.appendChild(costBadge);
                }
                /* ═══ NEW: Response time display ═══ */
                if (msg.responseTime) {
                    var rtDiv = document.createElement('div');
                    rtDiv.className = 'response-time-badge';
                    rtDiv.textContent = '\u23f1 ' + msg.responseTime + 's response time';
                    chatMessages.insertBefore(rtDiv, followUpsDiv);
                }
            }
            currentStreamDiv = null;
            toolGroupDiv = null; toolGroupBody = null; toolCount = 0;
            if (msg.followUps) { renderFollowUps(msg.followUps); }
            thinkingTimer.textContent = '';
            tokenSpeed.textContent = '';
            if (streamStats) streamStats.innerHTML = '';
            if (quickActions) quickActions.classList.add('visible');
            if (scrollLockBtn) scrollLockBtn.classList.remove('visible');
            userScrolledUp = false;
            messageInput.focus();
            break;
        case 'streamError':
            isStreaming = false;
            document.body.classList.remove('streaming');
            sendBtn.style.display = '';
            stopBtn.style.display = 'none';
            sendBtn.disabled = false;
            if (thinkingInterval) { clearInterval(thinkingInterval); thinkingInterval = null; }
            if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }

            /* ═══ Partial response recovery ═══ */
            if (currentStreamDiv && streamContent && streamContent.length > 20) {
                // Keep the partial content, just render it final and append error
                var partialBubble = currentStreamDiv.querySelector('.msg-bubble');
                if (partialBubble) { partialBubble.innerHTML = renderMarkdown(streamContent); }
                var partialErr = document.createElement('div');
                partialErr.className = 'error-message';
                partialErr.style.margin = '8px 0 4px 34px';
                partialErr.innerHTML = '\u26a0\ufe0f Stream interrupted: ' + escapeHtml(msg.error)
                    + ' <button class="msg-action-btn" style="display:inline;opacity:1;margin-left:8px;">Resume</button>'
                    + ' <button class="msg-action-btn" style="display:inline;opacity:1;margin-left:4px;">Retry</button>';
                currentStreamDiv.appendChild(partialErr);
                var partialBtns = partialErr.querySelectorAll('button');
                if (partialBtns[0]) { partialBtns[0].addEventListener('click', function() {
                    vscode.postMessage({ type: 'resumeFromPartial', partial: streamContent });
                    partialErr.remove();
                }); }
                if (partialBtns[1]) { partialBtns[1].addEventListener('click', function() {
                    vscode.postMessage({ type: 'retryAfterError' });
                    if (currentStreamDiv) currentStreamDiv.remove();
                    partialErr.remove();
                }); }
                currentStreamDiv = null;
            } else {
                // No meaningful content — remove the stream div entirely
                if (currentStreamDiv) currentStreamDiv.remove();
                var errDiv = document.createElement('div');
                errDiv.className = 'error-message';
                errDiv.innerHTML = '\u274c ' + escapeHtml(msg.error) + ' <button class="msg-action-btn" id="retry-btn" style="display:inline;opacity:1;margin-left:8px;">Retry</button>';
                chatMessages.insertBefore(errDiv, followUpsDiv);
                var retryBtn = errDiv.querySelector('#retry-btn');
                if (retryBtn) { retryBtn.addEventListener('click', function() { vscode.postMessage({ type: 'retryAfterError' }); errDiv.remove(); }); }
                currentStreamDiv = null;
            }
            toolGroupDiv = null; toolGroupBody = null; toolCount = 0;
            thinkingTimer.textContent = '';
            tokenSpeed.textContent = '';
            smartScroll();
            messageInput.focus();
            break;
        case 'toolAction':
            addToolItem(msg.name, msg.args, msg.status, msg.result);
            break;
        case 'toolActions':
            /* ═══ Batched tool action messages ═══ */
            if (msg.items) {
                for (var ti = 0; ti < msg.items.length; ti++) {
                    addToolItem(msg.items[ti].name, msg.items[ti].args, msg.items[ti].status, msg.items[ti].result);
                }
            }
            break;
        case 'confirmTool':
            $('confirm-tool-name').textContent = msg.name;
            $('confirm-tool-args').textContent = msg.args;
            confirmOverlay.classList.add('open');
            break;
        case 'toggleSidebar':
            sidebar.classList.toggle('collapsed');
            break;
        case 'modelChanged':
            currentModel = msg.model;
            inputModel.textContent = msg.model;
            document.querySelectorAll('.model-option').forEach(function(o) { o.classList.toggle('active', o.dataset.model === msg.model); });
            saveState();
            break;
        case 'clearChat':
            var clr = Array.from(chatMessages.children);
            for (var ci = 0; ci < clr.length; ci++) {
                if (clr[ci] !== welcome && clr[ci] !== scrollAnchor && clr[ci] !== followUpsDiv
                    && clr[ci] !== thinkingTimer && clr[ci] !== tokenSpeed && clr[ci] !== $('auto-scroll-indicator')) {
                    chatMessages.removeChild(clr[ci]);
                }
            }
            welcome.style.display = '';
            followUpsDiv.classList.remove('visible');
            toolGroupDiv = null; toolGroupBody = null; toolCount = 0; msgIndex = 0;
            break;
        case 'insertText':
            messageInput.value += msg.text;
            messageInput.dispatchEvent(new Event('input'));
            messageInput.focus();
            saveState();
            break;
        case 'activeFileContext':
            if (msg.context) {
                fileBreadcrumb.classList.add('active');
                breadcrumbPath.textContent = msg.context.path + ' (' + msg.context.language + ')';
                var diagHtml = '';
                if (msg.context.diagnostics) {
                    var errorCount = msg.context.diagnostics.filter(function(d) { return d.severity === 'error'; }).length;
                    var warnCount = msg.context.diagnostics.filter(function(d) { return d.severity === 'warning'; }).length;
                    if (errorCount > 0) diagHtml += '<span class="diag-badge">' + errorCount + ' errors</span> ';
                    if (warnCount > 0) diagHtml += '<span class="warn-badge">' + warnCount + ' warnings</span>';
                }
                breadcrumbDiags.innerHTML = diagHtml;
                updateContextChips(msg.context);
            } else {
                fileBreadcrumb.classList.remove('active');
                updateContextChips(null);
            }
            break;
        case 'recentFiles':
            recentFilesDropdown.innerHTML = '';
            if (msg.files && msg.files.length > 0) {
                for (var rf = 0; rf < msg.files.length; rf++) {
                    var item = document.createElement('div');
                    item.className = 'recent-file-item';
                    item.textContent = msg.files[rf];
                    item.dataset.path = msg.files[rf];
                    item.addEventListener('click', function(e) {
                        e.stopPropagation();
                        vscode.postMessage({ type: 'insertRecentFile', path: this.dataset.path });
                        recentFilesDropdown.classList.remove('open');
                    });
                    recentFilesDropdown.appendChild(item);
                }
                recentFilesDropdown.classList.add('open');
            }
            break;
        /* ═══ NEW message handlers ═══ */
        case 'restoreDraft':
            if (msg.text) {
                messageInput.value = msg.text;
                messageInput.dispatchEvent(new Event('input'));
            }
            break;
        case 'sessionStats':
            if (msg.stats) {
                statsContent.innerHTML = '';
                var rows = [
                    ['Messages', msg.stats.messageCount],
                    ['You', msg.stats.userCount],
                    ['Assistant', msg.stats.assistantCount],
                    ['Est. Tokens', msg.stats.tokenEstimate],
                    ['Words', msg.stats.wordCount],
                    ['Duration', msg.stats.duration],
                ];
                for (var si = 0; si < rows.length; si++) {
                    var sRow = document.createElement('div');
                    sRow.className = 'stat-row';
                    sRow.innerHTML = '<span>' + rows[si][0] + '</span><span class="stat-val">' + rows[si][1] + '</span>';
                    statsContent.appendChild(sRow);
                }
            }
            break;
        case 'showShortcuts':
            shortcutsOverlay.classList.add('open');
            break;
        case 'showChatSearch':
            chatSearchBar.classList.add('open');
            chatSearchInput.focus();
            break;
        case 'compactMode':
            if (msg.compact) document.body.classList.add('compact');
            else document.body.classList.remove('compact');
            break;
        case 'accentColor':
            if (msg.color) document.documentElement.style.setProperty('--mercury-accent', msg.color);
            break;
    }
});

vscode.postMessage({ type: 'ready' });

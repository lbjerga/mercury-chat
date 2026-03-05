/**
 * getWebviewHtml.ts — Generates the HTML shell for the Mercury Chat webview.
 * CSS and JS are loaded as external files via webview URIs.
 * Extracted from chatViewProvider.ts _getHtml().
 */
import * as vscode from 'vscode';
import { getNonce } from '../utils';

export function getWebviewHtml(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
): string {
    const nonce = getNonce();

    const logoUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'public', 'pluslarslogo2025white.png'),
    );
    const cssUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'src', 'webview', 'chat.css'),
    );
    const jsUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'src', 'webview', 'chat.js'),
    );

    return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<title>Mercury Chat</title>
<link rel="stylesheet" href="${cssUri}">
</head>
<body data-logo-uri="${logoUri}">

<!-- MAIN CHAT COLUMN -->
<div id="main">
    <div id="loading-bar"></div>
    <!-- Top bar -->
    <div id="top-bar">
        <span id="active-title">Mercury Chat</span>
        <select id="effort-select" title="Reasoning effort">
            <option value="low">Low</option>
            <option value="medium" selected>Medium</option>
            <option value="high">High</option>
        </select>
        <span class="top-bar-group">
            <span class="top-bar-label">Temp</span>
            <select id="temp-select" title="Temperature (0.5–1.0)">
                <option value="0.5">0.5</option>
                <option value="0.6" selected>0.6</option>
                <option value="0.7">0.7</option>
                <option value="0.75">0.75</option>
                <option value="0.8">0.8</option>
                <option value="0.9">0.9</option>
                <option value="1.0">1.0</option>
            </select>
        </span>
        <span class="top-bar-group">
            <span class="top-bar-label">Tokens</span>
            <select id="tokens-select" title="Max response tokens">
                <option value="1024">1K</option>
                <option value="2048">2K</option>
                <option value="4096">4K</option>
                <option value="8192">8K</option>
                <option value="16384">16K</option>
                <option value="32768" selected>32K</option>
                <option value="50000">50K</option>
            </select>
        </span>
        <button class="icon-btn" id="stats-btn" title="Session Statistics">&#128202;</button>
        <button class="icon-btn" id="shortcuts-btn" title="Keyboard Shortcuts">&#63;</button>
        <button class="icon-btn" id="search-chat-btn" title="Search in Chat (Ctrl+F)">&#128269;</button>
        <button class="icon-btn" id="sys-prompt-btn" title="System Prompt">&#9881;</button>
        <button class="icon-btn" id="export-btn" title="Export chat">&#128190;</button>
        <button class="icon-btn" id="undo-btn" title="Undo last message">&#8617;</button>
        <button class="icon-btn" id="new-chat-top" title="New Chat">+</button>
    </div>

    <!-- Search in chat bar -->
    <div id="chat-search-bar">
        <input id="chat-search-input" type="text" placeholder="Search in conversation..." />
        <span id="chat-search-count"></span>
        <button class="icon-btn" id="chat-search-close" title="Close">&times;</button>
    </div>

    <!-- Active file breadcrumb -->
    <div id="file-breadcrumb">
        <span class="file-icon">&#128196;</span>
        <span id="breadcrumb-path">—</span>
        <span id="breadcrumb-diags"></span>
    </div>

    <!-- System prompt editor -->
    <div id="sys-prompt-area">
        <textarea id="sys-prompt-input" placeholder="Custom system prompt for this session..."></textarea>
        <button id="sys-prompt-save">Save Prompt</button>
    </div>

    <!-- v0.14.0: Quick Actions Toolbar (#23) -->
    <div id="quick-actions">
        <button class="quick-action-btn" data-action="Explain this code" title="Explain code"><span class="quick-action-icon">&#128218;</span> Explain</button>
        <button class="quick-action-btn" data-action="Fix the errors in my code" title="Fix errors"><span class="quick-action-icon">&#128295;</span> Fix</button>
        <button class="quick-action-btn" data-action="Refactor and improve this code" title="Refactor"><span class="quick-action-icon">&#9881;</span> Refactor</button>
        <button class="quick-action-btn" data-action="Write tests for this code" title="Write tests"><span class="quick-action-icon">&#9989;</span> Test</button>
        <button class="quick-action-btn" data-action="Review this code for issues" title="Review"><span class="quick-action-icon">&#128269;</span> Review</button>
        <button class="quick-action-btn" data-action="Optimize this code for performance" title="Optimize"><span class="quick-action-icon">&#9889;</span> Optimize</button>
        <button class="quick-action-btn" data-action="Generate documentation" title="Docs"><span class="quick-action-icon">&#128196;</span> Docs</button>
    </div>

    <!-- Messages -->
    <div id="chat-messages">
        <div class="welcome" id="welcome">
            <div class="welcome-icon"><img src="${logoUri}" alt="M"></div>
            <h2>+Lars AI Chat</h2>
            <p>Ask Mercury 2 anything about coding.<br>Powered by Inception &mdash; no Copilot credits used.<br><br>
            <b>Ask</b> &middot; questions &amp; explanations<br>
            <b>Plan</b> &middot; architecture &amp; design<br>
            <b>Code</b> &middot; generate &amp; edit files<br><br>
            <span style="opacity:0.6;font-size:0.9em">Tip: use <code>@file(path)</code>, <code>@workspace</code>, <code>@selection</code>, <code>@problems</code></span></p>
            <div class="welcome-actions">
                <button class="welcome-action-btn" data-action="Explain this code">Explain Code</button>
                <button class="welcome-action-btn" data-action="Fix the bugs in the current file">Fix Bugs</button>
                <button class="welcome-action-btn" data-action="Write tests for the current file">Write Tests</button>
                <button class="welcome-action-btn" data-action="Generate documentation for this code">Generate Docs</button>
                <button class="welcome-action-btn" data-action="Refactor and improve the current code">Refactor</button>
                <button class="welcome-action-btn" data-action="Review the code for issues and improvements">Review Code</button>
            </div>
            <div class="welcome-tip" id="welcome-tip"></div>
        </div>
        <div id="thinking-timer"></div>
        <div id="token-speed"></div>
        <div id="stream-stats"></div>
        <div id="auto-scroll-indicator">&#8595; Auto-scrolling</div>
        <div id="follow-ups"></div>
        <div id="scroll-anchor"><button id="scroll-bottom-btn" title="Scroll to bottom">&#8595;</button></div>
    </div>
    <button id="scroll-top-btn" title="Scroll to top">&#8593;</button>
    <button id="scroll-lock-btn" title="Resume auto-scroll">&#8595;</button>

    <!-- Image paste indicator (#20) -->
    <div class="image-paste-indicator" id="image-paste-indicator">&#128247; Image pasted — will be described as context</div>

    <!-- Drop zone overlay -->
    <div id="drop-zone">Drop files to include in chat</div>

    <!-- Rename dialog -->
    <div id="rename-overlay">
        <div id="rename-dialog">
            <h3>Rename Chat</h3>
            <input id="rename-input" type="text" placeholder="Chat title..." />
            <div class="btn-row">
                <button id="rename-cancel">Cancel</button>
                <button id="rename-save">Save</button>
            </div>
        </div>
    </div>

    <!-- Tool confirm dialog -->
    <div id="confirm-overlay">
        <div id="confirm-dialog">
            <h3>Allow <span id="confirm-tool-name"></span>?</h3>
            <div class="confirm-details" id="confirm-tool-args"></div>
            <div class="btn-row">
                <button id="confirm-deny">Deny</button>
                <button id="confirm-approve">Allow</button>
            </div>
        </div>
    </div>

    <!-- Shortcuts overlay -->
    <div id="shortcuts-overlay">
        <div id="shortcuts-dialog">
            <h3>Keyboard Shortcuts</h3>
            <div class="shortcut-row"><span>Send message</span><span class="shortcut-key">Enter</span></div>
            <div class="shortcut-row"><span>New line</span><span class="shortcut-key">Shift+Enter</span></div>
            <div class="shortcut-row"><span>New chat</span><span class="shortcut-key">Ctrl+L</span></div>
            <div class="shortcut-row"><span>Focus input</span><span class="shortcut-key">Ctrl+/</span></div>
            <div class="shortcut-row"><span>Switch mode</span><span class="shortcut-key">Shift+Tab</span></div>
            <div class="shortcut-row"><span>Stop generation</span><span class="shortcut-key">Escape</span></div>
            <div class="shortcut-row"><span>Search in chat</span><span class="shortcut-key">Ctrl+F</span></div>
            <div class="shortcut-row"><span>Input history</span><span class="shortcut-key">Up/Down</span></div>
            <div class="shortcut-row"><span>Slash commands</span><span class="shortcut-key">/command</span></div>
            <div class="shortcut-row"><span>@-mentions</span><span class="shortcut-key">@workspace @selection @problems</span></div>
            <div class="btn-row" style="margin-top:12px;"><button id="shortcuts-close" style="padding:5px 14px;border:none;border-radius:4px;cursor:pointer;background:var(--mercury-accent);color:#fff;">Close</button></div>
        </div>
    </div>

    <!-- Stats overlay -->
    <div id="stats-overlay">
        <div id="stats-dialog">
            <h3>Session Statistics</h3>
            <div id="stats-content"></div>
            <div class="btn-row" style="margin-top:12px;"><button id="stats-close" style="padding:5px 14px;border:none;border-radius:4px;cursor:pointer;background:var(--mercury-accent);color:#fff;">Close</button></div>
        </div>
    </div>

    <!-- Context chips -->
    <div id="context-chips"></div>

    <!-- Templates -->
    <div id="templates-grid"></div>

    <!-- Input -->
    <div id="input-area">
        <div id="input-box" style="position:relative;">
            <div id="recent-files-dropdown"></div>
            <div id="slash-hint"></div>
            <textarea id="message-input" rows="1" placeholder="Ask Mercury anything..." autofocus></textarea>
            <div id="input-controls">
                <select id="input-mode-select" title="Mode" aria-label="Mode selector">
                    <option value="ask">Ask</option>
                    <option value="plan">Plan</option>
                    <option value="code" selected>Code</option>
                </select>
                <span id="input-model-wrap">
                    <span id="input-model" title="Click to change model">mercury-2</span>
                    <div id="model-dropdown">
                        <button class="model-option active" data-model="mercury-2">mercury-2</button>
                    </div>
                </span>
                <span class="at-file-hint" id="at-file-hint" title="Click to browse recent files">@file</span>
                <span id="char-count"></span>
                <span id="input-spacer"></span>
                <button id="send-btn">Send</button>
                <button id="stop-btn">Stop</button>
            </div>
        </div>
    </div>
</div>

<!-- SESSION SIDEBAR (right, persistent) -->
<div id="sidebar">
    <div id="sidebar-header">
        <span>Sessions</span>
        <button class="icon-btn" id="sidebar-collapse-btn" title="Collapse sidebar">&#9664;</button>
        <button class="icon-btn" id="new-chat-sidebar" title="New Chat">+</button>
    </div>
    <div id="session-search">
        <input id="session-search-input" type="text" placeholder="Search sessions..." />
    </div>
    <div id="session-list"></div>
    <button id="clear-all-sessions" title="Delete all sessions">Clear All</button>
</div>

<script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
}

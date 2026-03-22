/**
 * WhatNext Companion Client
 * Vanilla JS WebSocket client for the mobile phone session viewer.
 */

// ========================================
// State
// ========================================

let ws = null;
let displayName = localStorage.getItem('wn-companion-name') ?? '';
let currentTrackId = null;
let isPlaying = false;
let progressMs = 0;
let durationMs = 0;
let progressInterval = null;
let reconnectAttempt = 0;
let reconnectTimer = null;
let heartbeatTimer = null;
let timeRequestCooldown = false;
let isHost = false;

// ========================================
// DOM References
// ========================================

const $ = (sel) => document.querySelector(sel);
const joinScreen = $('#join-screen');
const sessionScreen = $('#session-screen');
const joinForm = $('#join-form');
const nameInput = $('#display-name-input');
const sessionName = $('#session-name');
const connectionDot = $('#connection-dot');
const clientCount = $('#client-count');
const albumArt = $('#album-art');
const albumArtPlaceholder = $('#album-art-placeholder');
const trackTitle = $('#track-title');
const trackArtists = $('#track-artists');
const progressBar = $('#progress-bar');
const progressTime = $('#progress-time');
const durationTime = $('#duration-time');
const trackList = $('#track-list');
const trackListEmpty = $('#track-list-empty');
const participantList = $('#participant-list');
const reactionContainer = $('#reaction-container');
const timeRequestBtn = $('#time-request-btn');

// ========================================
// Connection Management
// ========================================

function getWsUrl() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Detect relay mode: URL like /s/<SESSION_CODE>
    const relayMatch = location.pathname.match(/^\/s\/([A-Z0-9]+)\/?$/);
    if (relayMatch) {
        return `${protocol}//${location.host}/ws/${relayMatch[1]}`;
    }
    // Local LAN mode: plain /ws
    return `${protocol}//${location.host}/ws`;
}

function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        return;
    }

    ws = new WebSocket(getWsUrl());

    ws.onopen = () => {
        reconnectAttempt = 0;
        setConnectionStatus('connected');

        // Re-join if we have a name (reconnection)
        if (displayName) {
            send({ type: 'join', displayName });
        }

        startHeartbeat();
    };

    ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            handleMessage(msg);
        } catch { /* ignore malformed */ }
    };

    ws.onclose = () => {
        stopHeartbeat();
        scheduleReconnect();
    };

    ws.onerror = () => {
        setConnectionStatus('disconnected');
    };
}

function scheduleReconnect() {
    if (reconnectTimer) return;

    setConnectionStatus('reconnecting');
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempt), 10000);
    reconnectAttempt++;

    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
    }, delay);
}

function send(msg) {
    if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
    }
}

function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => send({ type: 'heartbeat' }), 15000);
}

function stopHeartbeat() {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }
}

// ========================================
// Connection Status UI
// ========================================

function setConnectionStatus(status) {
    connectionDot.className = 'connection-dot';
    connectionDot.classList.add(`connection-dot--${status}`);
}

// ========================================
// Message Handling
// ========================================

function handleMessage(msg) {
    switch (msg.type) {
        case 'session:snapshot':
            renderSnapshot(msg.data);
            break;
        case 'playback:update':
            renderPlayback(msg.data);
            break;
        case 'tracks:update':
            renderTracks(msg.data.tracks);
            break;
        case 'participants:update':
            renderParticipants(msg.data.participants);
            break;
        case 'turn:update':
            // Turn updates could highlight the current turn in the UI
            break;
        case 'reaction:broadcast':
            showFloatingReaction(msg.data.emoji);
            break;
        case 'time-request:ack':
            handleTimeRequestAck(msg.data.status);
            break;
        case 'join:ack':
            isHost = msg.data.isHost;
            applyHostMode();
            break;
    }
}

// ========================================
// Rendering
// ========================================

function renderSnapshot(data) {
    sessionName.textContent = data.sessionName || 'Session';
    renderPlayback(data.playback);
    renderTracks(data.tracks);
    renderParticipants(data.participants);
    updateClientCount();
}

function renderPlayback(pb) {
    if (!pb) return;

    currentTrackId = pb.trackId;
    isPlaying = pb.isPlaying;
    progressMs = pb.progressMs;
    durationMs = pb.durationMs;

    trackTitle.textContent = pb.title || 'No track playing';
    trackArtists.textContent = pb.artists?.join(', ') || '';

    if (pb.albumArtUrl) {
        albumArt.src = pb.albumArtUrl;
        albumArt.classList.remove('hidden');
        albumArtPlaceholder.classList.add('hidden');
    } else {
        albumArt.classList.add('hidden');
        albumArtPlaceholder.classList.remove('hidden');
    }

    updateProgress(progressMs, durationMs);
    startProgressInterpolation();

    // Highlight current track in queue
    document.querySelectorAll('.track-item').forEach((el) => {
        el.classList.toggle('track-item--current', el.dataset.trackId === currentTrackId);
    });
}

function renderTracks(tracks) {
    if (!tracks || tracks.length === 0) {
        trackList.innerHTML = '';
        trackListEmpty.classList.remove('hidden');
        return;
    }

    trackListEmpty.classList.add('hidden');
    trackList.innerHTML = tracks.map((t) => {
        const isCurrent = t.id === currentTrackId;
        const artHtml = t.albumArtUrl
            ? `<img src="${escapeAttr(t.albumArtUrl)}" alt="" class="track-item-art">`
            : `<div class="track-item-art flex items-center justify-center text-gray-600"><svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg></div>`;

        return `<div class="track-item ${isCurrent ? 'track-item--current' : ''}" data-track-id="${escapeAttr(t.id)}">
            ${artHtml}
            <div class="flex-1 min-w-0">
                <p class="text-sm text-gray-200 truncate">${escape(t.title)}</p>
                <p class="text-xs text-gray-500 truncate">${escape(t.artists?.join(', ') || '')}</p>
            </div>
            <span class="text-xs text-gray-600 flex-shrink-0">${formatTime(t.durationMs)}</span>
        </div>`;
    }).join('');
}

function renderParticipants(participants) {
    if (!participants || participants.length === 0) {
        participantList.innerHTML = '<span class="text-xs text-gray-600">No participants</span>';
        return;
    }

    participantList.innerHTML = participants.map((p) => {
        const hostClass = p.isHost ? 'participant-chip--host' : '';
        const label = p.isHost ? ' (host)' : p.isCoHost ? ' (co-host)' : '';
        return `<span class="participant-chip ${hostClass}">${escape(p.displayName)}${label}</span>`;
    }).join('');

    updateClientCount();
}

function updateClientCount() {
    const chips = participantList.querySelectorAll('.participant-chip');
    clientCount.textContent = chips.length > 0 ? `${chips.length}` : '';
}

// ========================================
// Progress Bar Interpolation
// ========================================

function startProgressInterpolation() {
    if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
    }

    if (!isPlaying) {
        progressBar.classList.remove('interpolating');
        return;
    }

    progressBar.classList.add('interpolating');

    progressInterval = setInterval(() => {
        if (!isPlaying) {
            clearInterval(progressInterval);
            progressInterval = null;
            progressBar.classList.remove('interpolating');
            return;
        }
        progressMs = Math.min(progressMs + 100, durationMs);
        updateProgress(progressMs, durationMs);
    }, 100);
}

function updateProgress(current, total) {
    const pct = total > 0 ? (current / total) * 100 : 0;
    progressBar.style.width = `${pct}%`;
    progressTime.textContent = formatTime(current);
    durationTime.textContent = formatTime(total);
}

// ========================================
// Reactions
// ========================================

document.querySelectorAll('.reaction-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
        const emoji = btn.dataset.emoji;
        send({ type: 'reaction', emoji, trackId: currentTrackId });
        showFloatingReaction(emoji);
    });
});

function showFloatingReaction(emoji) {
    const el = document.createElement('div');
    el.className = 'floating-reaction';
    el.textContent = emoji;

    // Random horizontal position in the lower-center area
    const x = 30 + Math.random() * 40; // 30%-70% of viewport
    el.style.left = `${x}%`;
    el.style.bottom = '20%';

    reactionContainer.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
}

// ========================================
// Time Request
// ========================================

timeRequestBtn.addEventListener('click', () => {
    if (timeRequestCooldown) return;

    send({ type: 'time-request', trackId: currentTrackId });
    timeRequestBtn.classList.add('pending');
    timeRequestBtn.textContent = 'Requested...';
    timeRequestCooldown = true;

    // Auto-reset after 30s
    setTimeout(() => {
        resetTimeRequestBtn();
    }, 30000);
});

function handleTimeRequestAck(status) {
    if (status === 'granted') {
        timeRequestBtn.classList.remove('pending');
        timeRequestBtn.classList.add('granted');
        timeRequestBtn.textContent = 'Granted!';
        setTimeout(resetTimeRequestBtn, 3000);
    }
    // 'seen' just means coordinator noticed — keep pending state
}

function resetTimeRequestBtn() {
    timeRequestBtn.classList.remove('pending', 'granted');
    timeRequestBtn.textContent = 'More Time';
    timeRequestBtn.disabled = false;
    timeRequestCooldown = false;
}

// ========================================
// Host Mode
// ========================================

function applyHostMode() {
    if (isHost) {
        // Hide "More Time" button (host doesn't request time from themselves)
        timeRequestBtn.classList.add('hidden');

        // Show host badge in header
        const badge = document.createElement('span');
        badge.id = 'host-badge';
        badge.className = 'text-[10px] text-primary-400 bg-primary-400/10 border border-primary-400/20 rounded px-1.5 py-0.5 ml-1';
        badge.textContent = 'HOST';
        const existing = document.getElementById('host-badge');
        if (!existing) {
            sessionName.parentElement?.appendChild(badge);
        }
    }
}

// ========================================
// Join Flow
// ========================================

// Pre-fill name from localStorage
if (displayName) {
    nameInput.value = displayName;
}

joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    displayName = nameInput.value.trim();
    if (!displayName) return;

    localStorage.setItem('wn-companion-name', displayName);

    // Switch to session view
    joinScreen.classList.add('hidden');
    sessionScreen.classList.remove('hidden');

    // Connect and join
    connect();
});

// ========================================
// Helpers
// ========================================

function formatTime(ms) {
    if (!ms || ms < 0) return '0:00';
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
}

function escape(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function escapeAttr(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

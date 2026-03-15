/**
 * ShareSessionPanel
 * Shows invite URL + short code for the active session.
 * Also provides a Join field to enter a URL or short code from a friend.
 */

import { useState, useEffect } from 'react';

interface ShareSessionPanelProps {
    sessionId: string;
}

export function ShareSessionPanel({ sessionId }: ShareSessionPanelProps) {
    const [inviteUrl, setInviteUrl] = useState<string | null>(null);
    const [shortCode, setShortCode] = useState<string | null>(null);
    const [urlCopied, setUrlCopied] = useState(false);
    const [codeCopied, setCodeCopied] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);

    const [joinInput, setJoinInput] = useState('');
    const [joining, setJoining] = useState(false);
    const [joinError, setJoinError] = useState<string | null>(null);
    const [joinSuccess, setJoinSuccess] = useState(false);

    useEffect(() => {
        setLoadError(null);
        window.electron?.p2p.getInviteUrl(sessionId).then((result) => {
            if (result?.success && result.url) {
                setInviteUrl(result.url);
                setShortCode(result.shortCode ?? null);
            } else {
                setLoadError(result?.error ?? 'P2P node not running — start the node first.');
            }
        });
    }, [sessionId]);

    const copyUrl = async () => {
        if (!inviteUrl) return;
        await navigator.clipboard.writeText(inviteUrl);
        setUrlCopied(true);
        setTimeout(() => setUrlCopied(false), 2000);
    };

    const copyCode = async () => {
        if (!shortCode) return;
        await navigator.clipboard.writeText(shortCode);
        setCodeCopied(true);
        setTimeout(() => setCodeCopied(false), 2000);
    };

    const handleJoin = async () => {
        const trimmed = joinInput.trim();
        if (!trimmed) return;
        setJoinError(null);
        setJoinSuccess(false);
        setJoining(true);
        try {
            const result = await window.electron?.p2p.joinSession(trimmed);
            if (result?.success) {
                setJoinSuccess(true);
                setJoinInput('');
            } else {
                setJoinError(result?.error ?? 'Failed to join session');
            }
        } finally {
            setJoining(false);
        }
    };

    return (
        <div className="card card-body space-y-4">
            <h3 className="text-sm font-semibold text-gray-200">Share This Session</h3>

            {loadError ? (
                <p className="text-xs text-red-400">{loadError}</p>
            ) : (
                <>
                    {/* Invite URL */}
                    <div className="space-y-1">
                        <label className="text-xs text-gray-400">Invite Link</label>
                        <div className="flex gap-2">
                            <input
                                readOnly
                                value={inviteUrl ?? 'Generating…'}
                                className="flex-1 bg-gray-700 text-white text-xs font-mono rounded-lg px-3 py-2 border border-gray-600 focus:outline-none truncate"
                            />
                            <button
                                onClick={copyUrl}
                                disabled={!inviteUrl}
                                className="px-3 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white text-xs rounded-lg transition-colors whitespace-nowrap"
                            >
                                {urlCopied ? 'Copied!' : 'Copy'}
                            </button>
                        </div>
                    </div>

                    {/* Short code */}
                    {shortCode && (
                        <div className="space-y-1">
                            <label className="text-xs text-gray-400">Short Code (voice-friendly)</label>
                            <div className="flex items-center gap-2">
                                <span className="text-xl font-mono font-bold tracking-widest text-blue-300 bg-gray-700 rounded-lg px-4 py-2">
                                    {shortCode}
                                </span>
                                <button
                                    onClick={copyCode}
                                    className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded-lg transition-colors"
                                >
                                    {codeCopied ? 'Copied!' : 'Copy'}
                                </button>
                            </div>
                            <p className="text-xs text-gray-500">
                                Dictate this code over voice chat — your friend enters it to join.
                            </p>
                        </div>
                    )}
                </>
            )}

            {/* Join a session */}
            <div className="space-y-1 pt-2 border-t border-gray-700">
                <label className="text-xs text-gray-400">Join a Session</label>
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={joinInput}
                        onChange={(e) => { setJoinInput(e.target.value); setJoinError(null); setJoinSuccess(false); }}
                        onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                        placeholder="Paste whtnxt:// link or enter short code…"
                        className="flex-1 bg-gray-700 text-white text-xs font-mono rounded-lg px-3 py-2 border border-gray-600 focus:border-blue-500 focus:outline-none"
                    />
                    <button
                        onClick={handleJoin}
                        disabled={joining || !joinInput.trim()}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-xs rounded-lg transition-colors whitespace-nowrap"
                    >
                        {joining ? 'Joining…' : 'Join'}
                    </button>
                </div>
                {joinError && <p className="text-xs text-red-400">{joinError}</p>}
                {joinSuccess && <p className="text-xs text-green-400">Connecting to peer…</p>}
            </div>
        </div>
    );
}

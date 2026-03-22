/**
 * CompanionSharePanel
 * Starts the companion server and shows QR code + URL for phone viewers.
 * Supports both local LAN (always on) and relay tunnel (opt-in for tricky networks).
 */

import { useState, useEffect, useCallback } from 'react';

interface CompanionSharePanelProps {
    sessionActive: boolean;
}

export function CompanionSharePanel({ sessionActive }: CompanionSharePanelProps) {
    const [serverInfo, setServerInfo] = useState<{ port: number; localIp: string } | null>(null);
    const [localQr, setLocalQr] = useState<string | null>(null);
    const [starting, setStarting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [localCopied, setLocalCopied] = useState(false);

    // Relay tunnel state
    const [relayUrl, setRelayUrl] = useState<string | null>(null);
    const [relayQr, setRelayQr] = useState<string | null>(null);
    const [relayConnecting, setRelayConnecting] = useState(false);
    const [relayError, setRelayError] = useState<string | null>(null);
    const [relayCopied, setRelayCopied] = useState(false);
    const [relayHost, setRelayHost] = useState(
        () => localStorage.getItem('wn-companion-relay-host') ?? ''
    );

    const companion = window.electron?.companion;

    const localUrl = serverInfo
        ? `http://${serverInfo.localIp}:${serverInfo.port}`
        : null;

    // ---- Server lifecycle ----

    const startServer = useCallback(async () => {
        if (!companion) return;
        setStarting(true);
        setError(null);
        try {
            const info = await companion.start();
            setServerInfo(info);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to start companion server');
        } finally {
            setStarting(false);
        }
    }, [companion]);

    const stopServer = useCallback(async () => {
        if (!companion) return;
        try {
            await companion.stop();
            setServerInfo(null);
            setLocalQr(null);
            setRelayUrl(null);
            setRelayQr(null);
        } catch {
            // ignore
        }
    }, [companion]);

    // Stop when session ends
    useEffect(() => {
        if (!sessionActive && serverInfo) {
            stopServer();
        }
    }, [sessionActive, serverInfo, stopServer]);

    // ---- QR code generation ----

    useEffect(() => {
        if (!localUrl || !companion) return;
        companion.generateQrCode(localUrl).then(setLocalQr).catch(() => setLocalQr(null));
    }, [localUrl, companion]);

    useEffect(() => {
        if (!relayUrl || !companion) return;
        companion.generateQrCode(relayUrl).then(setRelayQr).catch(() => setRelayQr(null));
    }, [relayUrl, companion]);

    // ---- Relay tunnel ----

    const startRelay = useCallback(async () => {
        if (!companion || !relayHost.trim()) return;
        setRelayConnecting(true);
        setRelayError(null);
        try {
            localStorage.setItem('wn-companion-relay-host', relayHost.trim());
            const info = await companion.startRelayTunnel(relayHost.trim());
            setRelayUrl(info.relayUrl);
        } catch (err) {
            setRelayError(err instanceof Error ? err.message : 'Failed to connect to relay');
        } finally {
            setRelayConnecting(false);
        }
    }, [companion, relayHost]);

    const stopRelay = useCallback(async () => {
        if (!companion) return;
        try {
            await companion.stopRelayTunnel();
            setRelayUrl(null);
            setRelayQr(null);
        } catch {
            // ignore
        }
    }, [companion]);

    // ---- Copy helpers ----

    const copyLocal = async () => {
        if (!localUrl) return;
        await navigator.clipboard.writeText(localUrl);
        setLocalCopied(true);
        setTimeout(() => setLocalCopied(false), 2000);
    };

    const copyRelay = async () => {
        if (!relayUrl) return;
        await navigator.clipboard.writeText(relayUrl);
        setRelayCopied(true);
        setTimeout(() => setRelayCopied(false), 2000);
    };

    if (!companion) return null;

    return (
        <div className="card card-body space-y-3">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-on-surface">Phone Companion</h3>
                {serverInfo && (
                    <button
                        onClick={stopServer}
                        className="text-xs text-error hover:text-error/80 transition-colors"
                    >
                        Stop
                    </button>
                )}
            </div>

            {!serverInfo ? (
                <div className="space-y-2">
                    <p className="text-xs text-on-surface-variant">
                        Let guests follow along on their phones — see the queue, react, and request more time.
                    </p>
                    <button
                        onClick={startServer}
                        disabled={starting || !sessionActive}
                        className="w-full py-2 bg-primary hover:bg-primary-dim disabled:bg-surface-high disabled:text-on-surface-variant text-on-surface text-xs rounded-lg transition-colors"
                    >
                        {starting ? 'Starting...' : 'Start Phone Companion'}
                    </button>
                    {error && <p className="text-xs text-error">{error}</p>}
                </div>
            ) : (
                <div className="space-y-4">
                    {/* === Local LAN === */}
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-on-surface">Local Network</span>
                            <span className="text-[10px] text-on-surface-variant bg-surface-high rounded px-1.5 py-0.5">Same Wi-Fi</span>
                        </div>

                        {localQr && (
                            <div className="flex justify-center">
                                <div className="bg-surface-high rounded-xl p-3">
                                    <img src={localQr} alt="Local QR" className="w-40 h-40" draggable={false} />
                                </div>
                            </div>
                        )}

                        <div className="flex gap-2">
                            <input
                                readOnly
                                value={localUrl ?? ''}
                                className="flex-1 bg-surface-high text-on-surface text-xs font-mono rounded-lg px-3 py-2 border border-outline-variant focus:outline-none truncate"
                            />
                            <button
                                onClick={copyLocal}
                                className="px-3 py-2 bg-surface-high text-on-surface text-xs rounded-lg transition-colors whitespace-nowrap"
                            >
                                {localCopied ? 'Copied!' : 'Copy'}
                            </button>
                        </div>
                    </div>

                    {/* === Relay Tunnel === */}
                    <div className="space-y-2 pt-3 border-t border-outline-variant">
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-on-surface">Remote Access</span>
                            <span className="text-[10px] text-on-surface-variant bg-surface-high rounded px-1.5 py-0.5">Via Relay</span>
                        </div>

                        {!relayUrl ? (
                            <>
                                <p className="text-xs text-on-surface-variant">
                                    Can't reach from phone? Route through your relay server.
                                </p>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={relayHost}
                                        onChange={(e) => setRelayHost(e.target.value)}
                                        placeholder="http://your-relay:4003"
                                        className="flex-1 bg-surface-high text-on-surface text-xs font-mono rounded-lg px-3 py-2 border border-outline-variant focus:border-primary focus:outline-none"
                                    />
                                    <button
                                        onClick={startRelay}
                                        disabled={relayConnecting || !relayHost.trim()}
                                        className="px-3 py-2 bg-primary hover:bg-primary-dim disabled:bg-surface-high disabled:text-on-surface-variant text-on-surface text-xs rounded-lg transition-colors whitespace-nowrap"
                                    >
                                        {relayConnecting ? 'Connecting...' : 'Connect'}
                                    </button>
                                </div>
                                {relayError && <p className="text-xs text-error">{relayError}</p>}
                            </>
                        ) : (
                            <>
                                {relayQr && (
                                    <div className="flex justify-center">
                                        <div className="bg-surface-high rounded-xl p-3">
                                            <img src={relayQr} alt="Relay QR" className="w-40 h-40" draggable={false} />
                                        </div>
                                    </div>
                                )}

                                <p className="text-xs text-on-surface-variant text-center">
                                    Works from any network — share this link
                                </p>

                                <div className="flex gap-2">
                                    <input
                                        readOnly
                                        value={relayUrl}
                                        className="flex-1 bg-surface-high text-on-surface text-xs font-mono rounded-lg px-3 py-2 border border-outline-variant focus:outline-none truncate"
                                    />
                                    <button
                                        onClick={copyRelay}
                                        className="px-3 py-2 bg-surface-high text-on-surface text-xs rounded-lg transition-colors whitespace-nowrap"
                                    >
                                        {relayCopied ? 'Copied!' : 'Copy'}
                                    </button>
                                </div>

                                <button
                                    onClick={stopRelay}
                                    className="text-xs text-on-surface-variant hover:text-error transition-colors"
                                >
                                    Disconnect relay
                                </button>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

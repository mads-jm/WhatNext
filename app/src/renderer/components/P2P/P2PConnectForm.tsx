/**
 * P2PConnectForm — URL-based peer connection input.
 */

interface P2PConnectFormProps {
    connectUrl: string;
    onUrlChange: (url: string) => void;
    onConnect: () => void;
}

export function P2PConnectForm({
    connectUrl,
    onUrlChange,
    onConnect,
}: P2PConnectFormProps) {
    return (
        <div className="space-y-2">
            <input
                type="text"
                value={connectUrl}
                onChange={(e) => onUrlChange(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && onConnect()}
                placeholder="whtnxt://connect/12D3Koo..."
                className="w-full px-3 py-2 border border-outline-variant rounded text-xs bg-surface-high text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <button
                onClick={onConnect}
                disabled={!connectUrl.trim()}
                className="w-full px-4 py-2 bg-primary text-surface rounded hover:bg-primary-dim disabled:bg-surface-high disabled:text-on-surface-variant disabled:cursor-not-allowed text-xs font-semibold"
            >
                Connect
            </button>
            <p className="text-xs text-on-surface-variant">
                Paste a whtnxt:// connection URL from another peer
            </p>
        </div>
    );
}

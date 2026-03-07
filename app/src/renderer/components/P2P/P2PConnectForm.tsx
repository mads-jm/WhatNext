/**
 * P2PConnectForm — URL-based peer connection input.
 */

interface P2PConnectFormProps {
    connectUrl: string;
    onUrlChange: (url: string) => void;
    onConnect: () => void;
}

export function P2PConnectForm({ connectUrl, onUrlChange, onConnect }: P2PConnectFormProps) {
    return (
        <div className="space-y-2">
            <input
                type="text"
                value={connectUrl}
                onChange={(e) => onUrlChange(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && onConnect()}
                placeholder="whtnxt://connect/12D3Koo..."
                className="w-full px-3 py-2 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
                onClick={onConnect}
                disabled={!connectUrl.trim()}
                className="w-full px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-xs font-semibold"
            >
                Connect
            </button>
            <p className="text-xs text-gray-500">Paste a whtnxt:// connection URL from another peer</p>
        </div>
    );
}

import { useP2PStatus } from '../../hooks/useP2PStatus';

type ConnectionState = 'offline' | 'connecting' | 'connected';

export function ConnectionStatus() {
    const p2p = useP2PStatus();

    const state: ConnectionState = !p2p.nodeStarted
        ? 'offline'
        : p2p.connectedPeers.length > 0
          ? 'connected'
          : 'connecting';
    const peerCount = p2p.connectedPeers.length;

    const stateConfig = {
        offline: {
            icon: 'fa-circle',
            color: 'text-gray-500',
            label: 'Offline',
        },
        connecting: {
            icon: 'fa-circle-notch fa-spin',
            color: 'text-yellow-500',
            label: 'Connecting',
        },
        connected: {
            icon: 'fa-circle',
            color: 'text-green-500',
            label: 'Connected',
        },
    };

    const config = stateConfig[state];

    return (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-gray-900 border border-gray-800">
            <i className={`fa-solid ${config.icon} ${config.color} text-xs`} />
            <span className="text-sm text-gray-300">{config.label}</span>
            {state === 'connected' && peerCount > 0 && (
                <span className="badge-primary ml-1">{peerCount}</span>
            )}
        </div>
    );
}

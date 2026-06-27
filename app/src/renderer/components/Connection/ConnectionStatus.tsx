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
            color: 'text-on-surface-variant',
            label: 'Offline',
        },
        connecting: {
            icon: 'fa-circle-notch fa-spin',
            color: 'text-secondary',
            label: 'Connecting',
        },
        connected: {
            icon: 'fa-circle',
            color: 'text-primary',
            label: 'Connected',
        },
    };

    const config = stateConfig[state];

    return (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-surface border border-outline-variant">
            <i className={`fa-solid ${config.icon} ${config.color} text-xs`} />
            <span className="text-sm text-on-surface">{config.label}</span>
            {state === 'connected' && peerCount > 0 && (
                <span className="badge-primary ml-1">{peerCount}</span>
            )}
        </div>
    );
}

import { useState, useEffect } from 'react';

type ConnectionState = 'offline' | 'connecting' | 'connected';

export function ConnectionStatus() {
    const [state, setState] = useState<ConnectionState>('offline');
    const [peerCount, setPeerCount] = useState(0);

    // Placeholder - will be driven by P2P state in future
    useEffect(() => {
        // Simulate connection state for UI demonstration
        // In production, this will subscribe to actual P2P connection state
    }, []);

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

/**
 * Relay Configuration Store
 *
 * Persists user-configured relay server addresses to disk.
 * Relay addresses live in user settings, not hardcoded constants —
 * this is core to WhatNext's sovereignty model: users choose what
 * infrastructure their sessions route through.
 *
 * Storage: JSON file in Electron's userData directory.
 *   ~/.config/WhatNext/relay-config.json  (Linux)
 *   ~/Library/Application Support/WhatNext/relay-config.json  (macOS)
 *   %APPDATA%\WhatNext\relay-config.json  (Windows)
 *
 * Multiaddr format examples:
 *   /ip4/1.2.3.4/tcp/4001/p2p/12D3KooW...
 *   /ip4/1.2.3.4/tcp/4002/ws/p2p/12D3KooW...
 *   /dns4/relay.example.com/tcp/4001/p2p/12D3KooW...
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

interface RelayConfig {
    addresses: string[];
}

/**
 * WhatNext community relay — pre-populated on first run, but removable.
 * Users are not required to use it; it's just a sensible default that
 * works out of the box.
 *
 * This constant is intentionally NOT injected into P2P_CONFIG so the
 * relay address remains a runtime user setting, not a compile-time constant.
 */
const COMMUNITY_RELAY_PLACEHOLDER = '# Replace with your relay address';

const DEFAULT_CONFIG: RelayConfig = {
    // Empty by default — no relay until one is configured.
    // Users add addresses via P2P Settings or by clicking an invite link
    // that includes a relay hint.
    addresses: [],
};

function getConfigPath(): string {
    return path.join(app.getPath('userData'), 'relay-config.json');
}

function readConfig(): RelayConfig {
    const configPath = getConfigPath();
    try {
        const raw = fs.readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(raw) as RelayConfig;
        if (!Array.isArray(parsed.addresses)) {
            return DEFAULT_CONFIG;
        }
        // Filter out placeholder comments or blank entries
        parsed.addresses = parsed.addresses.filter(
            (a) => typeof a === 'string' && a.trim() && !a.startsWith('#'),
        );
        return parsed;
    } catch {
        return { ...DEFAULT_CONFIG };
    }
}

function writeConfig(config: RelayConfig): void {
    const configPath = getConfigPath();
    try {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    } catch (err) {
        console.error('[RelayConfigStore] Failed to write config:', err);
    }
}

/** Retrieve the current list of relay addresses. */
export function getRelayAddresses(): string[] {
    return readConfig().addresses;
}

/**
 * Add a relay address if it isn't already in the list.
 * Returns the updated address list.
 */
export function addRelayAddress(multiaddr: string): string[] {
    const config = readConfig();
    const normalized = multiaddr.trim();
    if (!normalized || config.addresses.includes(normalized)) {
        return config.addresses;
    }
    config.addresses.push(normalized);
    writeConfig(config);
    return config.addresses;
}

/**
 * Remove a relay address by exact match.
 * Returns the updated address list.
 */
export function removeRelayAddress(multiaddr: string): string[] {
    const config = readConfig();
    config.addresses = config.addresses.filter((a) => a !== multiaddr.trim());
    writeConfig(config);
    return config.addresses;
}

// Export placeholder for documentation purposes
export { COMMUNITY_RELAY_PLACEHOLDER };

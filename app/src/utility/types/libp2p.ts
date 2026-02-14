/**
 * Local libp2p Type Definitions
 *
 * Self-contained types mirroring the shapes we actually use from libp2p.
 * These don't depend on @libp2p/interface resolving at compile time.
 * Only the shapes we destructure/access are defined here.
 */

/** Anything with a toString() that produces a multiaddr string */
export interface MultiaddrLike {
    toString(): string;
}

/** Shape of the event emitted by libp2p 'peer:discovery' */
export interface PeerDiscoveryEvent {
    detail: {
        id: { toString(): string };
        multiaddrs: MultiaddrLike[];
    };
}

/** Shape of the event emitted by libp2p 'peer:connect' and 'peer:disconnect' */
export interface PeerConnectionEvent {
    detail: { toString(): string };
}

/** Shape of the argument passed to node.handle() stream handlers */
export interface StreamHandlerArg {
    stream: import('@libp2p/interface').Stream;
    connection: {
        remotePeer: { toString(): string };
        newStream(protocol: string): Promise<import('@libp2p/interface').Stream>;
        remoteAddr: MultiaddrLike;
    };
}

/** Shape of a peer store entry's address record */
export interface PeerStoreAddress {
    multiaddr: MultiaddrLike;
}

/** Shape of a peer store entry */
export interface PeerStoreEntry {
    addresses: PeerStoreAddress[];
}

/** Shape of the MessagePort event from Electron's utility process */
export interface UtilityProcessMessageEvent {
    data: unknown;
}

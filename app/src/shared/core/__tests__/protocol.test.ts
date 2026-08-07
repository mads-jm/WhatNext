import { describe, it, expect } from 'vitest';
import {
    parseProtocolUrl,
    createConnectUrl,
    isValidPeerId,
    extractPeerIdFromMultiaddr,
} from '../protocol';

// A valid modern libp2p peer ID (12D3Koo prefix, base58btc charset).
// base58btc excludes: 0 (zero), I (uppercase i), O (uppercase o), l (lowercase L).
const VALID_PEER_ID = '12D3KooWAbCdEfGhJkMnPqRsTvWxYzAbCdEfGhJkMnPqRsTvW';

describe('isValidPeerId', () => {
    it('accepts a valid 12D3Koo peer ID', () => {
        expect(isValidPeerId(VALID_PEER_ID)).toBe(true);
    });

    it('accepts a valid Qm peer ID', () => {
        expect(isValidPeerId('QmYwAPJzv5CZsnAztSdYVctFh65bZ66Bk3QJ')).toBe(
            true,
        );
    });

    it('accepts a valid bafz peer ID (base32)', () => {
        expect(
            isValidPeerId(
                'bafzbeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
            ),
        ).toBe(true);
    });

    it('rejects a string that is too short', () => {
        expect(isValidPeerId('12D3Koo')).toBe(false);
    });

    it('rejects a string that is too long (>100 chars)', () => {
        expect(isValidPeerId('12D3Koo' + 'A'.repeat(95))).toBe(false);
    });

    it('rejects an unknown prefix', () => {
        expect(isValidPeerId('unknownPrefixABCDEFGHIJKLMNOP')).toBe(false);
    });

    it('rejects base58 strings containing 0 (zero)', () => {
        // '0' is not in the base58btc alphabet
        expect(isValidPeerId('12D3KooW0InvalidCharHere00000000000000000')).toBe(
            false,
        );
    });

    it('rejects base58 strings containing O (uppercase O)', () => {
        expect(isValidPeerId('12D3KooWOInvalidCharHereOOOOOOOOOOOOOOOO')).toBe(
            false,
        );
    });
});

describe('parseProtocolUrl', () => {
    it('parses a valid whtnxt:// URL with a modern peer ID', () => {
        const url = `whtnxt://connect/${VALID_PEER_ID}`;
        const result = parseProtocolUrl(url);
        expect(result.action).toBe('connect');
        expect(result.peerId).toBe(VALID_PEER_ID);
        expect(result.relay).toBeUndefined();
        expect(result.metadata).toBeUndefined();
    });

    it('parses the relay query param', () => {
        const relay = '/ip4/1.2.3.4/tcp/4001/p2p/12D3KooWRelay';
        const url = `whtnxt://connect/${VALID_PEER_ID}?relay=${encodeURIComponent(relay)}`;
        const result = parseProtocolUrl(url);
        expect(result.relay).toBe(relay);
    });

    it('parses extra metadata params, excluding relay', () => {
        const url = `whtnxt://connect/${VALID_PEER_ID}?session=abc&relay=/ip4/1.2.3.4`;
        const result = parseProtocolUrl(url);
        expect(result.metadata).toEqual({ session: 'abc' });
        // relay should NOT appear in metadata
        expect(result.metadata?.relay).toBeUndefined();
    });

    it('returns undefined metadata when there are no extra params', () => {
        const url = `whtnxt://connect/${VALID_PEER_ID}`;
        const result = parseProtocolUrl(url);
        expect(result.metadata).toBeUndefined();
    });

    it('throws on wrong scheme', () => {
        expect(() =>
            parseProtocolUrl(`https://connect/${VALID_PEER_ID}`),
        ).toThrow();
    });

    it('throws on unknown action', () => {
        expect(() =>
            parseProtocolUrl(`whtnxt://unknown/${VALID_PEER_ID}`),
        ).toThrow();
    });

    it('throws when peer ID is missing', () => {
        expect(() => parseProtocolUrl('whtnxt://connect/')).toThrow();
    });

    it('throws when peer ID has an invalid format', () => {
        expect(() =>
            parseProtocolUrl('whtnxt://connect/not-a-peer-id'),
        ).toThrow();
    });
});

describe('createConnectUrl', () => {
    it('creates a basic connect URL with no options', () => {
        const url = createConnectUrl(VALID_PEER_ID);
        expect(url).toContain('whtnxt://');
        expect(url).toContain('connect');
        expect(url).toContain(VALID_PEER_ID);
    });

    it('includes relay as a query param', () => {
        const relay = '/ip4/1.2.3.4/tcp/4001/p2p/12D3KooWRelayNode';
        const url = createConnectUrl(VALID_PEER_ID, { relay });
        expect(url).toContain('relay=');
    });

    it('includes metadata as query params', () => {
        const url = createConnectUrl(VALID_PEER_ID, {
            metadata: { session: 'xyz' },
        });
        expect(url).toContain('session=xyz');
    });

    it('includes both relay and metadata', () => {
        const url = createConnectUrl(VALID_PEER_ID, {
            relay: '/ip4/1.2.3.4/tcp/4001/p2p/12D3KooWRelayNode',
            metadata: { foo: 'bar' },
        });
        expect(url).toContain('relay=');
        expect(url).toContain('foo=bar');
    });

    it('round-trips: createConnectUrl then parseProtocolUrl returns the same values', () => {
        const relay = '/ip4/1.2.3.4/tcp/4001/p2p/12D3KooWRelayNode';
        const url = createConnectUrl(VALID_PEER_ID, {
            relay,
            metadata: { session: 'abc' },
        });
        const parsed = parseProtocolUrl(url);
        expect(parsed.peerId).toBe(VALID_PEER_ID);
        expect(parsed.relay).toBe(relay);
        expect(parsed.metadata?.session).toBe('abc');
    });
});

describe('extractPeerIdFromMultiaddr', () => {
    it('extracts peer ID from a full multiaddr', () => {
        const multiaddr = `/ip4/127.0.0.1/tcp/4001/p2p/${VALID_PEER_ID}`;
        expect(extractPeerIdFromMultiaddr(multiaddr)).toBe(VALID_PEER_ID);
    });

    it('returns undefined when /p2p/ component is absent', () => {
        expect(
            extractPeerIdFromMultiaddr('/ip4/127.0.0.1/tcp/4001'),
        ).toBeUndefined();
    });

    it('returns undefined for a bare peer ID string (no multiaddr syntax)', () => {
        expect(extractPeerIdFromMultiaddr(VALID_PEER_ID)).toBeUndefined();
    });

    it('handles multiaddr with relay circuit suffix', () => {
        const multiaddr = `/ip4/1.2.3.4/tcp/4001/p2p/${VALID_PEER_ID}/p2p-circuit`;
        // Should still extract the first /p2p/ segment
        expect(extractPeerIdFromMultiaddr(multiaddr)).toBe(VALID_PEER_ID);
    });
});

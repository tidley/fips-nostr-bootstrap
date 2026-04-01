import { describe, expect, it } from 'vitest';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { wrapEvent } from 'nostr-tools/nip17';

// @ts-expect-error local JS package without type declarations
import { DEFAULT_RELAYS, createFipsNostrRendezvousNode } from '../packages/fips-nostr-rendezvous/src/index.js';

interface TraversalOfferLike {
  type: 'offer';
  app: string;
  eventKind: number;
  sessionId: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
  recipientNpub: string;
  reflexiveAddress: {
    protocol: 'udp';
    ip: string;
    port: number;
  };
}

interface LegacyHelloLike {
  type: 'fips.rendezvous.hello';
  sessionId: string;
  nonce: string;
  issuedAt: number;
}

describe('advertised rendezvous runtime', () => {
  it('publishes an advert event with relay and STUN metadata', async () => {
    const published: Array<{ relays: string[]; event: { content: string } }> = [];
    const node = createFipsNostrRendezvousNode({
      relays: ['wss://nip17.com', 'wss://nip17.tomdwyer.uk'],
      udpPort: 0,
      publicHost: '45.77.228.152',
      stunUri: 'stun:fips.tomdwyer.uk:3478',
      advertise: false,
    });

    node.pool = {
      publish(relays: string[], event: { content: string }) {
        published.push({ relays, event });
        return relays.map(() => Promise.resolve(true));
      },
    };
    node.socket = {
      address() {
        return { port: 9999 };
      },
    };

    node._publishAdvert();

    expect(published).toHaveLength(1);
    const [{ relays, event }] = published;
    expect(relays).toEqual(['wss://nip17.com', 'wss://nip17.tomdwyer.uk']);
    const content = JSON.parse(event.content);
    expect(content.publisherNpub).toBe(node.getNpub());
    expect(content.relays).toEqual(relays);
    expect(content.stunServers).toContain('stun:fips.tomdwyer.uk:3478');
    expect(content.transports).toContain('udp');
    expect(content.endpointHint.port).toBe(9999);
  });

  it('preserves an explicit udpPort of 0 for ephemeral client sockets', () => {
    const node = createFipsNostrRendezvousNode({
      udpPort: 0,
      advertise: false,
    });

    expect(node.udpPort).toBe(0);
  });

  it('uses embedded relay defaults when no relay list is provided', () => {
    const node = createFipsNostrRendezvousNode({
      advertise: false,
    });

    expect(node.relays).toEqual(DEFAULT_RELAYS);
  });

  it('discovers an advertised peer by npub', async () => {
    const targetNpub = nip19.npubEncode(getPublicKey(generateSecretKey()));
    const node = createFipsNostrRendezvousNode({
      relays: ['wss://nip17.tomdwyer.uk'],
      udpPort: 0,
      advertise: false,
    });

    node.pool = {
      subscribeMany(_relays: string[], _filter: Record<string, unknown>, handlers: { onevent: (evt: { content: string }) => void }) {
        setTimeout(() => {
          handlers.onevent({
            content: JSON.stringify({
              app: 'fips.nat.traversal.v1',
              publisherNpub: targetNpub,
              expiresAt: Date.now() + 60_000,
              relays: ['wss://nip17.tomdwyer.uk'],
              stunServers: ['stun:fips.tomdwyer.uk:3478'],
              transports: ['udp'],
            }),
          });
        }, 0);
        return { close() {} };
      },
    };

    const advert = await node.findAdvertisedPeer(targetNpub, { waitMs: 2_000 });

    expect(advert.publisherNpub).toBe(targetNpub);
    expect(advert.relays).toEqual(['wss://nip17.tomdwyer.uk']);
  });

  it('lists currently advertised peers without requiring a target npub', async () => {
    const node = createFipsNostrRendezvousNode({
      relays: ['wss://nip17.tomdwyer.uk'],
      udpPort: 0,
      advertise: false,
    });

    node.pool = {
      subscribeMany(_relays: string[], _filter: Record<string, unknown>, handlers: { onevent: (evt: { content: string }) => void }) {
        setTimeout(() => {
          handlers.onevent({
            content: JSON.stringify({
              app: 'fips.nat.traversal.v1',
              publisherNpub: nip19.npubEncode(getPublicKey(generateSecretKey())),
              expiresAt: Date.now() + 60_000,
              publishedAt: Date.now() - 1_000,
              sequence: 1,
              relays: ['wss://nip17.tomdwyer.uk'],
              stunServers: ['stun:fips.tomdwyer.uk:3478'],
              transports: ['udp'],
            }),
          });
          handlers.onevent({
            content: JSON.stringify({
              app: 'fips.nat.traversal.v1',
              publisherNpub: nip19.npubEncode(getPublicKey(generateSecretKey())),
              expiresAt: Date.now() + 120_000,
              publishedAt: Date.now(),
              sequence: 2,
              relays: ['wss://nip17.tomdwyer.uk'],
              stunServers: ['stun:fips.tomdwyer.uk:3478'],
              transports: ['udp'],
            }),
          });
        }, 0);
        return { close() {} };
      },
    };

    const adverts = await node.listAdvertisedPeers({ waitMs: 250, maxPeers: 10 });

    expect(adverts).toHaveLength(2);
    expect(adverts[0].publishedAt).toBeGreaterThanOrEqual(adverts[1].publishedAt);
    expect(adverts[0].publisherNpub).not.toBe(adverts[1].publisherNpub);
  });

  it('can settle advert discovery early once enough peers are found', async () => {
    const node = createFipsNostrRendezvousNode({
      relays: ['wss://nip17.tomdwyer.uk'],
      udpPort: 0,
      advertise: false,
    });

    node.pool = {
      subscribeMany(_relays: string[], _filter: Record<string, unknown>, handlers: { onevent: (evt: { content: string }) => void }) {
        setTimeout(() => {
          handlers.onevent({
            content: JSON.stringify({
              app: 'fips.nat.traversal.v1',
              publisherNpub: nip19.npubEncode(getPublicKey(generateSecretKey())),
              expiresAt: Date.now() + 60_000,
              publishedAt: Date.now(),
              sequence: 1,
              relays: ['wss://nip17.tomdwyer.uk'],
              stunServers: ['stun:fips.tomdwyer.uk:3478'],
              transports: ['udp'],
            }),
          });
        }, 0);
        return { close() {} };
      },
    };

    const startedAt = Date.now();
    const adverts = await node.listAdvertisedPeers({ waitMs: 5_000, maxPeers: 1, settleMs: 25 });

    expect(adverts).toHaveLength(1);
    expect(Date.now() - startedAt).toBeLessThan(500);
  });

  it('can exclude its own npub from advert discovery results', async () => {
    const node = createFipsNostrRendezvousNode({
      relays: ['wss://nip17.tomdwyer.uk'],
      udpPort: 0,
      advertise: false,
    });
    const selfNpub = node.getNpub();
    const otherNpub = nip19.npubEncode(getPublicKey(generateSecretKey()));

    node.pool = {
      subscribeMany(_relays: string[], _filter: Record<string, unknown>, handlers: { onevent: (evt: { content: string }) => void }) {
        setTimeout(() => {
          handlers.onevent({
            content: JSON.stringify({
              app: 'fips.nat.traversal.v1',
              publisherNpub: selfNpub,
              expiresAt: Date.now() + 60_000,
              publishedAt: Date.now(),
              sequence: 1,
              relays: ['wss://nip17.tomdwyer.uk'],
              stunServers: ['stun:fips.tomdwyer.uk:3478'],
              transports: ['udp'],
            }),
          });
          handlers.onevent({
            content: JSON.stringify({
              app: 'fips.nat.traversal.v1',
              publisherNpub: otherNpub,
              expiresAt: Date.now() + 60_000,
              publishedAt: Date.now() + 1,
              sequence: 2,
              relays: ['wss://nip17.tomdwyer.uk'],
              stunServers: ['stun:fips.tomdwyer.uk:3478'],
              transports: ['udp'],
            }),
          });
        }, 0);
        return { close() {} };
      },
    };

    const adverts = await node.listAdvertisedPeers({
      waitMs: 250,
      maxPeers: 10,
      excludePublisherNpubs: [selfNpub],
    });

    expect(adverts).toHaveLength(1);
    expect(adverts[0].publisherNpub).toBe(otherNpub);
  });

  it('connects through discovery before invoking the private bootstrap path', async () => {
    const targetNpub = nip19.npubEncode(getPublicKey(generateSecretKey()));
    const node = createFipsNostrRendezvousNode({
      relays: ['wss://nip17.tomdwyer.uk'],
      udpPort: 0,
      advertise: false,
    });

    node.findAdvertisedPeer = async () => ({
      app: 'fips.nat.traversal.v1',
      publisherNpub: targetNpub,
      expiresAt: Date.now() + 60_000,
      publishedAt: Date.now(),
      sequence: 1,
      relays: ['wss://nip17.tomdwyer.uk'],
      stunServers: ['stun:fips.tomdwyer.uk:3478'],
      transports: ['udp'],
    });
    node.connect = async (resolvedTargetNpub: string, opts: { discoveryWaitMs?: number; waitMs?: number }) => ({
      nonce: 'n-1',
      established: { established: true, remote: { host: '45.77.228.152', port: 9999 } },
      remote: { host: '45.77.228.152', port: 9999 },
      socket: {},
      session: {},
      targetNpub: resolvedTargetNpub,
      opts,
    });

    const conn = await node.connectToAdvertisedPeer(targetNpub, { discoveryWaitMs: 1_000, waitMs: 5_000 });

    expect(conn.discoveredAdvert.publisherNpub).toBe(targetNpub);
    expect(conn.targetNpub).toBe(targetNpub);
    expect(conn.established.established).toBe(true);
  });

  it('connects to the freshest advertised peer without a pre-known npub', async () => {
    const advertisedNpub = nip19.npubEncode(getPublicKey(generateSecretKey()));
    const node = createFipsNostrRendezvousNode({
      relays: ['wss://nip17.tomdwyer.uk'],
      udpPort: 0,
      advertise: false,
    });

    node.listAdvertisedPeers = async () => ([
      {
        app: 'fips.nat.traversal.v1',
        publisherNpub: advertisedNpub,
        relays: ['wss://nip17.tomdwyer.uk'],
        stunServers: ['stun:fips.tomdwyer.uk:3478'],
        transports: ['udp'],
        publishedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      },
    ]);
    node.connect = async (resolvedTargetNpub: string, opts: { discoveryWaitMs?: number; waitMs?: number }) => ({
      nonce: 'n-1',
      established: { established: true, remote: { host: '45.77.228.152', port: 9999 } },
      remote: { host: '45.77.228.152', port: 9999 },
      socket: {},
      session: {},
      targetNpub: resolvedTargetNpub,
      opts,
    });

    const conn = await node.connectToDiscoveredPeer({ discoveryWaitMs: 1_000, waitMs: 5_000 });

    expect(conn.discoveredAdvert.publisherNpub).toBe(advertisedNpub);
    expect(conn.targetNpub).toBe(advertisedNpub);
  });

  it('skips its own advert when dialing an unknown peer', async () => {
    const node = createFipsNostrRendezvousNode({
      relays: ['wss://nip17.tomdwyer.uk'],
      udpPort: 0,
      advertise: false,
    });
    const selfNpub = node.getNpub();
    const remoteNpub = nip19.npubEncode(getPublicKey(generateSecretKey()));

    node.listAdvertisedPeers = async (opts: { excludePublisherNpubs?: string[] }) => {
      expect(opts.excludePublisherNpubs).toContain(selfNpub);
      return [
        {
          app: 'fips.nat.traversal.v1',
          publisherNpub: remoteNpub,
          relays: ['wss://nip17.tomdwyer.uk'],
          stunServers: ['stun:fips.tomdwyer.uk:3478'],
          transports: ['udp'],
          publishedAt: Date.now(),
          expiresAt: Date.now() + 60_000,
        },
      ];
    };
    node.connect = async (resolvedTargetNpub: string) => ({
      nonce: 'n-1',
      established: { established: true, remote: { host: '45.77.228.152', port: 9999 } },
      remote: { host: '45.77.228.152', port: 9999 },
      socket: {},
      session: {},
      targetNpub: resolvedTargetNpub,
    });

    const conn = await node.connectToDiscoveredPeer({ discoveryWaitMs: 1_000, waitMs: 5_000 });

    expect(conn.discoveredAdvert.publisherNpub).toBe(remoteNpub);
    expect(conn.targetNpub).toBe(remoteNpub);
  });

  it('refuses to connect directly to its own npub', async () => {
    const node = createFipsNostrRendezvousNode({
      relays: ['wss://nip17.tomdwyer.uk'],
      udpPort: 0,
      advertise: false,
    });

    await expect(node.connect(node.getNpub(), { waitMs: 100 })).rejects.toThrow('refusing to connect to self');
  });

  it('publishes an issue-aligned traversal offer before waiting for an answer', async () => {
    const targetSk = generateSecretKey();
    const targetPubkey = getPublicKey(targetSk);
    const targetNpub = nip19.npubEncode(targetPubkey);
    const published: Array<Record<string, unknown>> = [];
    const filters: Array<Record<string, unknown>> = [];
    let dmHandler: ((evt: unknown) => void) | null = null;

    const node = createFipsNostrRendezvousNode({
      relays: ['wss://nip17.tomdwyer.uk'],
      udpPort: 0,
      publicHost: '198.51.100.10',
      advertise: false,
    });

    node.socket = {
      address() {
        return { port: 40123 };
      },
      on() {},
      off() {},
    };
    node.pool = {
      publish(relays: string[], event: { content: string }) {
        return relays.map(() => Promise.resolve(true));
      },
      subscribeMany(_relays: string[], _filter: Record<string, unknown>, handlers: { onevent: (evt: unknown) => void }) {
        filters.push(_filter);
        dmHandler = handlers.onevent;
        return { close() {} };
      },
    };
    node._publishDM = (_recipientPubkey: string, obj: Record<string, unknown>) => {
      published.push(obj);
    };
    node._startPunch = () => {};
    node.waitForPunch = async () => ({ established: true, remote: { host: '203.0.113.20', port: 49000 } });

    const connectPromise = node.connect(targetNpub, { waitMs: 2_000, retryMs: 50 });

    expect(published.length).toBeGreaterThanOrEqual(1);
    const publishedOffer = published.find((msg) => msg.type === 'offer') as TraversalOfferLike | undefined;
    expect(publishedOffer).toBeDefined();
    if (!publishedOffer) throw new Error('expected traversal offer');
    expect(publishedOffer.type).toBe('offer');
    expect(publishedOffer.app).toBe('fips.nat.traversal.v1');
    expect(publishedOffer.eventKind).toBe(21059);
    expect(publishedOffer.recipientNpub).toBe(targetNpub);
    expect(publishedOffer.reflexiveAddress).toEqual({
      protocol: 'udp',
      ip: '198.51.100.10',
      port: 40123,
    });
    expect(filters.some((filter) => Array.isArray(filter['#p']) && filter['#p'][0] === node.pubkey)).toBe(true);
    expect(filters.some((filter) => !('#p' in filter))).toBe(true);

    expect(dmHandler).toBeTypeOf('function');
    const answerHandler = dmHandler as ((evt: unknown) => void) | null;
    if (!answerHandler) throw new Error('expected DM handler');
    answerHandler(
      wrapEvent(targetSk, { publicKey: node.pubkey }, JSON.stringify({
        app: 'fips.nat.traversal.v1',
        eventKind: 21059,
        type: 'answer',
        sessionId: publishedOffer.sessionId,
        issuedAt: publishedOffer.issuedAt + 100,
        expiresAt: publishedOffer.expiresAt,
        nonce: 'answer-nonce-1',
        senderNpub: targetNpub,
        recipientNpub: node.getNpub(),
        inReplyTo: publishedOffer.nonce,
        accepted: true,
        reflexiveAddress: { protocol: 'udp', ip: '203.0.113.20', port: 49000 },
        localAddresses: [{ protocol: 'udp', ip: '192.168.1.20', port: 49000 }],
        punch: { startAtMs: publishedOffer.issuedAt + 500, intervalMs: 300, durationMs: 30_000 },
      })),
    );

    const conn = await connectPromise;
    expect(conn.remote).toEqual({ host: '203.0.113.20', port: 49000 });
    expect(conn.targetNpub).toBe(targetNpub);
  });

  it('keeps a legacy hello fallback so older responders can still return server-info', async () => {
    const targetSk = generateSecretKey();
    const targetPubkey = getPublicKey(targetSk);
    const targetNpub = nip19.npubEncode(targetPubkey);
    const published: Array<Record<string, unknown>> = [];
    let dmHandler: ((evt: unknown) => void) | null = null;

    const node = createFipsNostrRendezvousNode({
      relays: ['wss://nip17.tomdwyer.uk'],
      udpPort: 0,
      publicHost: '198.51.100.10',
      advertise: false,
    });

    node.socket = {
      address() {
        return { port: 40123 };
      },
      on() {},
      off() {},
    };
    node.pool = {
      publish(relays: string[], event: { content: string }) {
        return relays.map(() => Promise.resolve(true));
      },
      subscribeMany(_relays: string[], _filter: Record<string, unknown>, handlers: { onevent: (evt: unknown) => void }) {
        dmHandler = handlers.onevent;
        return { close() {} };
      },
    };
    node._publishDM = (_recipientPubkey: string, obj: Record<string, unknown>) => {
      published.push(obj);
    };
    node._startPunch = () => {};
    node.waitForPunch = async () => ({ established: true, remote: { host: '203.0.113.30', port: 9999 } });

    const connectPromise = node.connect(targetNpub, { waitMs: 2_000, retryMs: 50 });

    expect(published.some((msg) => msg.type === 'offer')).toBe(true);
    const hello = published.find((msg) => msg.type === 'fips.rendezvous.hello') as LegacyHelloLike | undefined;
    expect(hello).toBeDefined();
    if (!hello) throw new Error('expected legacy hello');

    expect(dmHandler).toBeTypeOf('function');
    const serverInfoHandler = dmHandler as ((evt: unknown) => void) | null;
    if (!serverInfoHandler) throw new Error('expected DM handler');
    serverInfoHandler(
      wrapEvent(targetSk, { publicKey: node.pubkey }, JSON.stringify({
        type: 'fips.rendezvous.server-info',
        version: '1.0',
        sessionId: hello.sessionId,
        nonce: hello.nonce,
        issuedAt: hello.issuedAt + 100,
        endpoint: { host: '203.0.113.30', port: 9999 },
        punch: { startAtMs: hello.issuedAt + 500, intervalMs: 300, durationMs: 30_000 },
      })),
    );

    const conn = await connectPromise;
    expect(conn.remote).toEqual({ host: '203.0.113.30', port: 9999 });
    expect(conn.targetNpub).toBe(targetNpub);
  });

  it('builds an issue-aligned answer and starts punching toward the offered address', () => {
    const clientPubkey = getPublicKey(generateSecretKey());
    const clientNpub = nip19.npubEncode(clientPubkey);
    const startedPunches: Array<{ nonceValue: string; remote: { host: string; port: number }; punch: { startAtMs: number; intervalMs: number; durationMs: number } }> = [];

    const node = createFipsNostrRendezvousNode({
      relays: ['wss://nip17.tomdwyer.uk'],
      udpPort: 0,
      publicHost: '45.77.228.152',
      advertise: false,
    });

    node.socket = {
      address() {
        return { port: 9999 };
      },
      on() {},
      off() {},
    };
    node._startPunch = (nonceValue: string, remote: { host: string; port: number }, punch: { startAtMs: number; intervalMs: number; durationMs: number }) => {
      startedPunches.push({ nonceValue, remote, punch });
    };

    const offer = {
      app: 'fips.nat.traversal.v1',
      eventKind: 21059,
      type: 'offer',
      sessionId: 'sess-1',
      issuedAt: 1_700_000_000_000,
      expiresAt: 1_700_000_060_000,
      nonce: 'offer-nonce-1',
      senderNpub: clientNpub,
      recipientNpub: node.getNpub(),
      reflexiveAddress: { protocol: 'udp', ip: '203.0.113.10', port: 40123 },
      localAddresses: [{ protocol: 'udp', ip: '192.168.1.10', port: 40123 }],
    };

    const reply = node._handleTraversalOffer(offer, 1_700_000_000_500);

    expect(reply.type).toBe('answer');
    expect(reply.app).toBe('fips.nat.traversal.v1');
    expect(reply.eventKind).toBe(21059);
    expect(reply.recipientNpub).toBe(clientNpub);
    expect(reply.reflexiveAddress).toEqual({
      protocol: 'udp',
      ip: '45.77.228.152',
      port: 9999,
    });

    expect(startedPunches).toHaveLength(1);
    expect(startedPunches[0]).toMatchObject({
      nonceValue: 'offer-nonce-1',
      remote: { host: '203.0.113.10', port: 40123 },
    });
    expect(startedPunches[0].punch.startAtMs).toBeGreaterThanOrEqual(1_700_000_000_500);
  });

  it('builds a traversal answer payload from an incoming offer', () => {
    const clientPubkey = getPublicKey(generateSecretKey());
    const clientNpub = nip19.npubEncode(clientPubkey);

    const node = createFipsNostrRendezvousNode({
      relays: ['wss://nip17.tomdwyer.uk'],
      udpPort: 0,
      publicHost: '45.77.228.152',
      advertise: false,
    });

    node.socket = {
      address() {
        return { port: 9999 };
      },
      on() {},
      off() {},
    };

    const reply = node._buildTraversalAnswer({
      offer: {
        app: 'fips.nat.traversal.v1',
        eventKind: 21059,
        type: 'offer',
        sessionId: 'sess-1',
        issuedAt: 1_700_000_000_000,
        expiresAt: 1_700_000_060_000,
        nonce: 'offer-nonce-1',
        senderNpub: clientNpub,
        recipientNpub: node.getNpub(),
        reflexiveAddress: { protocol: 'udp', ip: '203.0.113.10', port: 40123 },
        localAddresses: [{ protocol: 'udp', ip: '192.168.1.10', port: 40123 }],
      },
      now: 1_700_000_000_500,
    });

    expect(reply.type).toBe('answer');
    expect(reply.app).toBe('fips.nat.traversal.v1');
    expect(reply.eventKind).toBe(21059);
    expect(reply.recipientNpub).toBe(clientNpub);
    expect(reply.reflexiveAddress).toEqual({
      protocol: 'udp',
      ip: '45.77.228.152',
      port: 9999,
    });

  });
});

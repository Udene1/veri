import { loadConfig } from '../config.js';
import { createHelia } from 'helia';
import { unixfs } from '@helia/unixfs';
import pino from 'pino';
import { gossipsub } from '@chainsafe/libp2p-gossipsub';
import { kadDHT } from '@libp2p/kad-dht';

import { createStandaloneLibp2p } from './standalone-libp2p.js';
import { MeshMonitor } from './mesh-monitor.js';
import fs from 'fs';
import path from 'path';
import { createEd25519PeerId, createFromJSON } from '@libp2p/peer-id-factory';
import { FileBlockstore } from '../blockstore.js';
import { VerimutLog } from '../log.js';
import { VerimutSync } from '../sync.js';
import { createOrLoadIdentity } from '../identity.js';

export interface NodeBundle {
  libp2p: any | null;
  helia: any | null;
  fs: any | null;
  pubsub: any | null;
  // runtime controllers for background processes (heartbeat, redial)
  controllers?: { stopBackground?: () => Promise<void> } | null;
  // runtime verimut objects (blocks, vlog, vsync, repoPath)
  verimut?: any | null;
  // VNS (Verimut Name Service) store and protocol
  vns?: any | null;
  // mesh health monitor
  meshMonitor?: MeshMonitor | null;
}

/**
 * Load or generate a persistent PeerId for this node.
 */
async function getPersistentPeerId() {
  const keyFile = process.env.PEER_KEY_FILE || './peer-key.json';
  try {
    const dir = path.dirname(keyFile);
    if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    // ignore directory creation errors; will fail on write if fatal
  }

  if (fs.existsSync(keyFile)) {
    try {
      const raw = fs.readFileSync(keyFile, 'utf8');
      const parsed = JSON.parse(raw);
      return await createFromJSON(parsed);
    } catch (e) {
      console.warn('Failed to parse/create PeerId from JSON, deleting corrupted key and regenerating:', e);
      try { fs.unlinkSync(keyFile); } catch (er) { /* ignore */ }
    }
  }

  // Generate a fresh peer id and persist it as JSON so it can be reloaded
  const peerId = await createEd25519PeerId();
  try {
    // peerId.toJSON may be sync or async depending on implementation
    const json = typeof (peerId as any).toJSON === 'function' ? await (peerId as any).toJSON() : JSON.parse(JSON.stringify(peerId));
    fs.writeFileSync(keyFile, JSON.stringify(json, null, 2), 'utf8');
  } catch (e) {
    // ignore write errors
  }
  return peerId;
}

/**
 * Start a periodic heartbeat publisher and return a stop function.
 * Publishes JSON { peerId, ts, capacity } to topic 'heartbeats'. Uses attached
 * pubsub service if available, otherwise the local shim used for single-node demo.
 */
function startHeartbeat(libp2p: any, pubsub: any, cfg: any) {
  const interval = parseInt(process.env.HEARTBEAT_INTERVAL_MS || '15000', 10);
  let stopped = false;
  const peerIdStr = libp2p?.peerId?.toString?.() || 'unknown';

  const timer = setInterval(async () => {
    if (stopped) return;
    try {
      const payload = JSON.stringify({ peerId: peerIdStr, ts: Date.now(), capacity: cfg?.capacityScore ?? null });
      if (pubsub && typeof pubsub.publish === 'function') {
        await pubsub.publish('heartbeats', Buffer.from(payload));
      }
    } catch (e) {
      // don't let heartbeat errors crash the node
      console.warn('heartbeat publish failed:', e);
    }
  }, interval);

  return async () => {
    stopped = true;
    clearInterval(timer);
  };
}

/**
 * Aggressively ensure bootstrap peers stay connected. This manager:
 * 1. Dials bootstrap peers immediately on start
 * 2. Periodically checks connections and re-dials
 * 3. Uses exponential backoff for failed dials
 * 4. Notifies gossipsub when new connections form
 */
function startRedialManager(libp2p: any, bootstrapPeers: string[]) {
  const baseBackoff = parseInt(process.env.REDIAL_BACKOFF_BASE_MS || '300', 10); // Faster base
  const maxRetries = parseInt(process.env.MAX_REDIAL_RETRIES || '8', 10); // More retries
  const intervalMs = parseInt(process.env.REDIAL_INTERVAL_MS || '5000', 10); // Check every 5s (aggressive)

  let stopped = false;
  const retries = new Map<string, number>();
  const lastConnected = new Map<string, number>();

  async function tryDial(ma: string) {
    if (!libp2p || typeof libp2p.dial !== 'function') return;
    try {
      const conn = await libp2p.dial(ma);
      retries.delete(ma);
      lastConnected.set(ma, Date.now());
      console.log('[Redial] Successfully connected to bootstrap peer:', ma);
      
      // Notify gossipsub about the new connection (helps mesh formation)
      try {
        const pubsub = libp2p.pubsub ?? libp2p.services?.pubsub;
        if (pubsub && typeof pubsub.addExplicitPeer === 'function') {
          // Extract peerId from connection or multiaddr
          let peerId = conn?.remotePeer?.toString?.() || ma;
          if (ma.includes('/p2p/')) {
            peerId = ma.split('/p2p/')[1].split('/')[0];
          }
          await pubsub.addExplicitPeer(peerId);
          console.log('[Redial] Added bootstrap peer to gossipsub mesh:', peerId);
        }
      } catch (e) { /* ignore gossipsub notification errors */ }
      
    } catch (e) {
      const prev = retries.get(ma) || 0;
      const next = Math.min(prev + 1, maxRetries);
      retries.set(ma, next);
      const backoff = baseBackoff * Math.pow(2, next);
      console.warn(`[Redial] Failed to connect to ${ma} (retry ${next}/${maxRetries})`);
      // schedule a delayed retry (fire and forget)
      if (!stopped && next < maxRetries) {
        setTimeout(() => { if (!stopped) tryDial(ma); }, backoff);
      }
    }
  }

  // Initial aggressive dial on startup
  (async () => {
    for (const ma of bootstrapPeers) {
      tryDial(ma);
      await new Promise(r => setTimeout(r, 200)); // Stagger initial dials
    }
  })();

  const timer = setInterval(async () => {
    if (stopped) return;
    try {
      // Check existing connections
      const connections = (libp2p.getConnections ? libp2p.getConnections() : []);
      const connected = new Set(connections.map((c: any) => {
        const addr = c.remoteAddr?.toString?.() || c.remotePeer?.toString?.() || '';
        return addr;
      }));
      
      // Extract peerIds from connected multiaddrs
      const connectedPeerIds = new Set(connections.map((c: any) => {
        return c.remotePeer?.toString?.() || '';
      }).filter(Boolean));

      for (const ma of bootstrapPeers) {
        // Check if we're connected by multiaddr OR by peerId
        let isConnected = connected.has(ma);
        if (!isConnected && ma.includes('/p2p/')) {
          const peerId = ma.split('/p2p/')[1].split('/')[0];
          isConnected = connectedPeerIds.has(peerId);
        }
        
        if (!isConnected) {
          const lastSeen = lastConnected.get(ma) || 0;
          const timeSinceLastConnection = Date.now() - lastSeen;
          // Re-dial if we haven't seen this peer in 10s
          if (timeSinceLastConnection > 10000) {
            console.log('[Redial] Re-establishing connection to:', ma);
            tryDial(ma);
          }
        }
      }
    } catch (e) {
      // no-op
    }
  }, intervalMs);

  return async () => {
    stopped = true;
    clearInterval(timer);
  };
}

/**
 * Create a Helia + libp2p bundle. Prefer a custom libp2p instance (so we have
 * fixed listen ports and a real gossipsub). Fall back to default Helia when
 * custom creation fails.
 */
export async function createNode(bootstrapPeers: string[] = []): Promise<NodeBundle> {
  const cfg = loadConfig();
  const logger = pino({ level: 'warn' });
  let helia: any = null;
  let libp2p: any = null;
  let fs: any = null;
  let verimut: any = null;
  let vns: any = null;

  // componentLogger removed: avoid importing internal @libp2p/logger to keep compatibility

  const listenPort = process.env.LISTEN_PORT ? parseInt(process.env.LISTEN_PORT) : 4001;
  const peerId = await getPersistentPeerId();

  try {
    // Temporarily skip custom libp2p due to logger configuration compatibility issues
    // TODO: Fix standalone-libp2p.ts logger setup for libp2p 0.45.0
    // try {
    //   libp2p = await createStandaloneLibp2p(listenPort);
    //   helia = await createHelia({ libp2p, peerId } as any);
    //   fs = unixfs(helia);
    //   console.log('Created Helia with custom libp2p; libp2p available:', !!libp2p);
    // } catch (e) {
    //   console.warn('Failed to create custom libp2p + Helia, falling back to default Helia:', e);
    // }

    if (!helia) {
      // Use default Helia which creates its own libp2p with proper logger setup
      // Note: Default Helia doesn't expose libp2p publicly but uses it internally
      try {
        helia = await createHelia({ peerId } as any);
        fs = unixfs(helia);
        // Don't try to access helia.libp2p - it throws an error if not configured with external libp2p
        // For now, we'll work with just Helia for file storage
        libp2p = null;
        console.log('Helia started with internal libp2p (not exposed)');
      } catch (err) {
        console.warn('Failed to create Helia (embedded IPFS). Networking will be limited.', err);
      }
    }
  } catch (err) {
    console.warn('Error preparing libp2p components:', err);
  }

  // If libp2p exists, ensure it's started and attach subscriptions
  if (libp2p) {
    try {
      if (typeof libp2p.start === 'function') await libp2p.start();
    } catch (err) {
      console.warn('libp2p.start() failed or already started:', err);
    }

    // Log listening multiaddrs for external processes to dial
    try {
      if (typeof libp2p.getMultiaddrs === 'function') {
        try { console.log('PeerID:', libp2p.peerId?.toString?.()); } catch (e) { /* ignore */ }
        const addrs = libp2p.getMultiaddrs().map((m: any) => m.toString());
        for (const a of addrs) console.log('Libp2p multiaddr:', a);
        // Prefer 127.0.0.1 for local demo, else first TCP
        const firstTcp = addrs.find((a: string) => a.includes('/ip4/127.0.0.1/tcp/')) || addrs.find((a: string) => a.includes('/tcp/')) || null;
        if (firstTcp) console.log('Dialable TCP multiaddr:', firstTcp);
      }
    } catch (e) { /* ignore */ }

    // Subscribe to core topics
    try {
      const topics = ['tasks/open', 'updates/pending', 'heartbeats'];
      // choose the pubsub implementation if available
      // @ts-ignore
      const pubsub = libp2p.pubsub ?? libp2p.services?.pubsub;
      for (const t of topics) {
        try {
          if (pubsub && typeof pubsub.subscribe === 'function') {
            await pubsub.subscribe(t);
            console.log('Subscribed to topic via pubsub:', t);
          } else {
            console.log('Pubsub not available for topic (stub):', t);
          }
        } catch (e) { /* ignore */ }
      }
      // Publish node info to DHT if available (cast services to any for runtime compatibility)
      if ((libp2p as any).services && (libp2p as any).services.dht && typeof (libp2p as any).services.dht.put === 'function') {
        const key = `/network/nodes/${libp2p.peerId.toString()}`;
        try { await (libp2p as any).services.dht.put(key, JSON.stringify({ capacity: 100, ts: Date.now() })); } catch (e) { /* ignore */ }
        console.log('Published node info to DHT:', key);
      }
    } catch (err) {
      console.warn('Failed to subscribe/publish on libp2p:', err);
    }
  }

  // determine attached pubsub service (prefer services.pubsub)
  // @ts-ignore
  const rawPubsub = (libp2p && (libp2p.services?.pubsub ?? libp2p.pubsub)) || null;

  // If the attached pubsub is not an instance with publish/subscribe, provide a local in-process shim
  let attachedPubsub = rawPubsub;
  const needsShim = !attachedPubsub || (typeof attachedPubsub.publish !== 'function' && typeof attachedPubsub.subscribe !== 'function' && typeof attachedPubsub.addEventListener !== 'function');
  if (needsShim) {
    // Simple EventTarget-based shim that supports publish(topic, Uint8Array) and addEventListener('message', ...)
    class LocalPubsub extends EventTarget {
      async publish(topic: string, data: Uint8Array | Buffer) {
        try {
          const evt = new CustomEvent('message', { detail: { topic, data: data instanceof Buffer ? data : Buffer.from(data as any) } });
          // dispatch asynchronously
          setTimeout(() => this.dispatchEvent(evt), 0);
        } catch (e) { /* ignore */ }
      }
      async subscribe(_topic: string) { /* no-op for local shim */ }
    }
    attachedPubsub = new LocalPubsub() as any;
    // attach shim to libp2p for later use (only if libp2p exists)
    if (libp2p) {
      // @ts-ignore
      libp2p.services = libp2p.services || {};
      // @ts-ignore
      libp2p.services.pubsub = attachedPubsub;
      // @ts-ignore
      libp2p.pubsub = attachedPubsub;
    }
    console.log('Local in-process pubsub shim attached (single-node demo)');
  }

  const controllers: any = {};
  let meshMonitor: MeshMonitor | null = null;
  
  try {
    // Start mesh health monitor
    if (libp2p) {
      meshMonitor = new MeshMonitor(libp2p, '/verimut/verimut-tasks', 5000);
      meshMonitor.start((health) => {
        console.log('[MeshMonitor]', health.diagnosis);
      });
    }
    
    // start heartbeat
    controllers.stopHeartbeat = startHeartbeat(libp2p, attachedPubsub, cfg);
    // start redial manager to keep connections to bootstrap peers
    controllers.stopRedial = startRedialManager(libp2p, bootstrapPeers.length ? bootstrapPeers : (process.env.BOOTSTRAP_PEERS ? process.env.BOOTSTRAP_PEERS.split(',') : []));
  // start Verimut (blockstore, log, sync) - works with or without libp2p (uses pubsub shim if needed)
  const effectiveLibp2p = libp2p || { peerId, services: { pubsub: attachedPubsub }, pubsub: attachedPubsub };
  if (true) { // Always initialize Verimut components
      try {
  const base = process.env.VERIMUT_REPO_BASE || './verimut-repos';
        try { fs.mkdirSync(base, { recursive: true }); } catch (e) { /* ignore */ }
        const pid = (libp2p && libp2p.peerId?.toString?.()) || (peerId && peerId.toString && peerId.toString()) || 'local';
        const safePid = pid.replace(/[^a-zA-Z0-9._-]/g, '_');
        const repoPath = path.join(base, safePid);
        const identity = await createOrLoadIdentity(repoPath);
        // ensure network peerId alignment
        if (libp2p) {
          identity.peerId = libp2p.peerId;
        }
  const blocks = new FileBlockstore(repoPath);
  const vlog = new VerimutLog('verimut-tasks', blocks as any, identity as any);
  const vsync = new VerimutSync(effectiveLibp2p, blocks as any, vlog, 'verimut-tasks');
        await vsync.start();
  
  // Initialize VNS if enabled
  let vnsStore: any = null;
  let vnsProtocol: any = null;
  if (process.env.ENABLE_VNS === 'true' || process.env.ENABLE_VNS === '1') {
    try {
      const { VNSNamespaceStore } = await import('../vns/namespace-store.js');
      const { VNSSecurity } = await import('../vns/security.js');
      const { setupVNSProtocol } = await import('../protocols/vns-protocol.js');
      
      const security = new VNSSecurity();
      vnsStore = new VNSNamespaceStore(blocks as any, vlog, security);
      await vnsStore.initialize();
      
      // Register VNS store with sync for delta propagation
      vsync.registerVNSStore(vnsStore);
      await vsync.subscribeToVNS();
      
      // Setup VNS protocol handler (only if real libp2p is available)
      if (libp2p) {
        vnsProtocol = await setupVNSProtocol(libp2p, vnsStore);
        console.log('[VNS] VNS protocol handler registered');
      } else {
        console.log('[VNS] Skipping protocol handler (libp2p not available, using pubsub shim only)');
      }
      
      console.log('[VNS] Verimut Name Service enabled and initialized');
    } catch (e) {
      console.error('[VNS] Failed to initialize VNS:', e);
    }
  }
  
  verimut = { blocks, vlog, vsync, repoPath, vns: vnsStore ? { store: vnsStore, protocol: vnsProtocol } : null };
  // Store VNS reference for easy API access
  vns = vnsStore ? { store: vnsStore, protocol: vnsProtocol } : null;
  // Announce presence for the verimut-tasks topic in the DHT so other
  // peers can discover topic participants if gossipsub mesh lags.
        try {
          // prefer services.dht if available
          const dht: any = (libp2p && libp2p.services && libp2p.services.dht) ? libp2p.services.dht : null;
          if (dht && typeof dht.put === 'function') {
            const topicKey = `/topic/verimut-tasks`;
            try {
              await dht.put(topicKey, libp2p.peerId.toString());
              console.log('Published topic peer to DHT:', topicKey);
            } catch (e) { /* ignore */ }

            // Pull peers from DHT and add them explicitly to gossipsub mesh
            // This ensures reliable mesh formation even when gossipsub heartbeat is slow
            try {
              let maybe: any = null;
              try {
                maybe = await dht.get(topicKey);
              } catch (e) {
                console.warn('[Sync] DHT get failed for', topicKey, e);
                maybe = null;
              }
              if (maybe) {
                const s = (typeof maybe === 'string') ? maybe : (Buffer.isBuffer(maybe) ? maybe.toString() : String(maybe));
                const peers = s.split(',').map((p:any) => String(p).trim()).filter(Boolean);
                const pubsub: any = ((libp2p as any).pubsub ?? ((libp2p as any).services && (libp2p as any).services.pubsub)) || null;
                for (const p of peers.slice(0, 5)) { // Increased from 3 to 5
                  try {
                    // Dial peer first to establish libp2p connection
                    if (typeof (libp2p as any).dial === 'function') {
                      try {
                        await (libp2p as any).dial(p);
                        console.log('[Sync] Dialed DHT peer:', p);
                        // Wait for connection to stabilize before adding to mesh
                        await new Promise(r => setTimeout(r, 500));
                      } catch (dialErr) {
                        console.warn('[Sync] Dial to DHT peer failed:', p, (dialErr && (dialErr as any).message) || dialErr);
                        continue; // Skip this peer if dial fails
                      }
                    }

                    // Add to gossipsub mesh (try modern API first, then legacy)
                    if (pubsub && typeof (pubsub as any).addExplicitPeer === 'function') {
                      try {
                        // Modern libp2p-gossipsub: addExplicitPeer(peerId)
                        await (pubsub as any).addExplicitPeer(p);
                        console.log('[Sync] Added explicit peer to mesh:', p);
                      } catch (err) {
                        // Legacy API: addExplicitPeer(peerId, topic) or (topic, peerId)
                        try {
                          await (pubsub as any).addExplicitPeer(p, '/verimut/verimut-tasks');
                          console.log('[Sync] Added explicit peer (legacy API) to mesh:', p);
                        } catch (err2) {
                          try {
                            await (pubsub as any).addExplicitPeer('/verimut/verimut-tasks', p);
                            console.log('[Sync] Added explicit peer (reversed args) to mesh:', p);
                          } catch (err3) {
                            console.warn('[Sync] addExplicitPeer failed for', p, ':', (err3 && (err3 as any).message) || err3);
                          }
                        }
                      }
                    } else {
                      console.warn('[Sync] pubsub.addExplicitPeer not available; relying on gossipsub heartbeat');
                    }
                  } catch (err) {
                    console.warn('[Sync] Error adding peer to mesh:', p, (err && (err as any).message) || err);
                  }
                }
              }
            } catch (e) { console.warn('[Sync] DHT discovery error (ignored):', e); }
          }
        } catch (e) { /* ignore */ }
  controllers.verimut = { stop: async () => { try { await vsync.stop(); } catch (e) { } } };
      } catch (e) {
        console.warn('Failed to start Verimut sync:', e);
      }
    }
    controllers.stopBackground = async () => {
      try { if (meshMonitor) meshMonitor.stop(); } catch (e) { /* ignore */ }
      try { if (controllers.stopHeartbeat) await controllers.stopHeartbeat(); } catch (e) { /* ignore */ }
      try { if (controllers.stopRedial) await controllers.stopRedial(); } catch (e) { /* ignore */ }
  try { if (controllers.verimut && typeof controllers.verimut.stop === 'function') await controllers.verimut.stop(); } catch (e) { /* ignore */ }
    };
  } catch (e) {
    console.warn('Failed to start background controllers:', e);
  }

  return { libp2p, helia, fs, pubsub: attachedPubsub, controllers, verimut, vns, meshMonitor };
}

export async function stopNode(bundle: NodeBundle): Promise<void> {
  try {
    if (bundle.controllers && typeof bundle.controllers.stopBackground === 'function') await bundle.controllers.stopBackground();
  } catch (err) {
    console.warn('Error stopping background controllers:', err);
  }
  try {
    if (bundle.libp2p && typeof bundle.libp2p.stop === 'function') await bundle.libp2p.stop();
  } catch (err) {
    console.warn('Error stopping libp2p:', err);
  }
  try {
    if (bundle.helia && typeof bundle.helia.stop === 'function') await bundle.helia.stop();
  } catch (err) {
    console.warn('Error stopping Helia:', err);
  }
}

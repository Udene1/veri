import { pipe } from 'it-pipe';
import type { VerimutLogEntry } from './log.js';
import { createHTTPP2P, parseBootstrapPeers, type HTTPP2P } from './networking/http-p2p.js';

/**
 * VerimutSync: a minimal sync protocol that publishes local heads via gossipsub
 * and fetches missing blocks from peers via a direct libp2p block protocol.
 *
 * Protocols:
 * - pubsub topic: `/verimut/{dbName}` with message { heads: [cid], peerId }
 * - VNS topic: `/verimut/vns` with message { type, entry, merkleRoot, peerId, timestamp }
 * - direct block protocol: `/verimut/block/1.0.0` where requester sends JSON { cid }
 *   and responder replies with the raw block bytes.
 * - HTTP P2P: POST /api/vns/push-delta for VNS delta propagation when pubsub unavailable
 */
export class VerimutSync {
  libp2p: any;
  pubsub: any;
  blockstore: any;
  log: any;
  topic: string;
  vnsTopic: string;
  running: boolean;
  _republishInterval: any;
  _blockReqListener: any;
  // instrumentation
  directFetches: number;
  totalFetches: number;
  // VNS store reference (optional)
  vnsStore: any | null;
  // HTTP-based P2P module for VNS delta propagation
  httpP2P: HTTPP2P | null;

  constructor(libp2p: any, blockstore: any, log: any, dbName: string) {
    this.libp2p = libp2p;
    this.blockstore = blockstore;
    this.log = log;
    this.topic = `/verimut/${dbName}`;
    this.vnsTopic = '/verimut/vns';
    this.running = false;
    // determine pubsub implementation
    this.pubsub = libp2p?.pubsub ?? libp2p?.services?.pubsub ?? null;
    this._republishInterval = null;
    // simple fetch metrics for demo instrumentation
    this.directFetches = 0;
    this.totalFetches = 0;
    this.vnsStore = null;
    
    // HTTP P2P will be initialized after bootstrap discovery
    // This is now deferred to start() so we can use async bootstrap discovery
    this.httpP2P = null;
  }

  /**
   * Register VNS store for delta propagation
   */
  registerVNSStore(vnsStore: any): void {
    this.vnsStore = vnsStore;
    
    // Set up bidirectional sync: VNS store can publish deltas via this sync
    const peerId = this.libp2p?.peerId?.toString?.() || 'unknown';
    vnsStore.setSyncCallback(async (delta: any) => {
      await this.publishVNSDelta(delta);
    }, peerId);
    
    console.log('[VerimutSync] VNS store registered for delta propagation');
  }

  async start() {
    if (this.running) return;
    this.running = true;

    // Initialize HTTP P2P with bootstrap discovery
    try {
      const { expandBootstrapPeers, registerAsBootstrap } = await import('./networking/bootstrap-discovery.js');
      
      const envVar = process.env.HTTP_BOOTSTRAP_PEERS || '';
      const bootstrapPeers = await expandBootstrapPeers(envVar, {
        seedBootstraps: ['http://102.90.98.234:3001'], // Genesis bootstrap node
        verbose: process.env.VERBOSE === 'true'
      });
      
      if (bootstrapPeers.length > 0) {
        const { createHTTPP2P } = await import('./networking/http-p2p.js');
        this.httpP2P = createHTTPP2P({
          bootstrapPeers,
          peerId: this.libp2p?.peerId,
          verbose: process.env.VERBOSE === 'true'
        });
        console.log(`[VerimutSync] HTTP P2P initialized with ${bootstrapPeers.length} bootstrap peer(s)`);
      }
      
      // Self-register as bootstrap if BOOTSTRAP_PUBLIC_URL is set
      const publicUrl = process.env.BOOTSTRAP_PUBLIC_URL;
      if (publicUrl) {
        const port = process.env.API_PORT || '3001';
        const vnsApi = `http://localhost:${port}`;
        // Wait for VNS to initialize
        setTimeout(async () => {
          await registerAsBootstrap('bootstrap-node', publicUrl, vnsApi);
        }, 3000);
      }
    } catch (error) {
      console.warn('[VerimutSync] Bootstrap discovery failed, falling back to direct config:', error);
      // Fallback to direct parseBootstrapPeers if discovery fails
      const { parseBootstrapPeers } = await import('./networking/http-p2p.js');
      const { createHTTPP2P } = await import('./networking/http-p2p.js');
      const bootstrapPeers = parseBootstrapPeers(process.env.HTTP_BOOTSTRAP_PEERS || '');
      if (bootstrapPeers.length > 0) {
        this.httpP2P = createHTTPP2P({
          bootstrapPeers,
          peerId: this.libp2p?.peerId,
          verbose: process.env.VERBOSE === 'true'
        });
        console.log(`[VerimutSync] HTTP P2P initialized with ${bootstrapPeers.length} bootstrap peer(s) (fallback)`);
      }
    }

    // subscribe to log updates to publish heads
    if (this.log && this.log.events && typeof this.log.events.on === 'function') {
      this.log.events.on('update', async (entry: VerimutLogEntry) => {
        try {
          await this.publishHeads([entry.cid]);
        } catch (e) { /* ignore */ }
      });
    }

    // subscribe to pubsub topic for remote heads
    if (this.pubsub && typeof this.pubsub.subscribe === 'function') {
      try {
        await this.pubsub.subscribe(this.topic);
        this.pubsub.addEventListener('message', (evt: any) => this._onPubsubMessage(evt));
        // subscribe to block request topic so we can respond with raw blocks when asked
        try {
          const reqTopic = `${this.topic}/block-req`;
          await this.pubsub.subscribe(reqTopic);
          this._blockReqListener = (evt: any) => this._onPubsubBlockRequest(evt);
          this.pubsub.addEventListener('message', this._blockReqListener);
        } catch (e) { /* ignore */ }
        // periodically republish our heads to help late joiners (more frequent for short demos)
        try {
          this._republishInterval = setInterval(async () => {
            try {
              const all = (this.log && typeof this.log.all === 'function') ? await this.log.all() : [];
              const heads = all.map((e: any) => e.cid).slice(-5);
              if (heads && heads.length) await this.publishHeads(heads as string[]);
            } catch (e) { /* ignore */ }
          }, 1000); // faster republish to reduce race windows
        } catch (e) { /* ignore */ }
      } catch (e) {
        // ignore
      }
    }

    // register block request handler
    if (this.libp2p && typeof this.libp2p.handle === 'function') {
      try {
  await this.libp2p.handle('/verimut/block/1.0.0', async ({ stream, connection }: any) => {
          // read request
          const chunks: Uint8Array[] = [];
          for await (const c of stream.source) {
            chunks.push(Buffer.from(c));
          }
          const req = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const cid = req && req.cid;
          if (!cid) return;
          const block = await this.blockstore.get(cid);
          if (!block) return;
          // respond with block bytes
          await pipe([block], stream.sink);
        });
      } catch (e) {
        // ignore
      }
    }
  }

  async stop() {
    if (!this.running) return;
    this.running = false;
    try {
      if (this.pubsub && typeof this.pubsub.unsubscribe === 'function') {
        await this.pubsub.unsubscribe(this.topic);
        try {
          const reqTopic = `${this.topic}/block-req`;
          await this.pubsub.unsubscribe(reqTopic);
        } catch (e) { /* ignore */ }
      }
      if (this.libp2p && typeof this.libp2p.unhandle === 'function') {
        await this.libp2p.unhandle('/verimut/block/1.0.0');
      }
      if (this._republishInterval) {
        clearInterval(this._republishInterval as any);
        this._republishInterval = null;
      }
      try {
        if (this._blockReqListener && this.pubsub && typeof this.pubsub.removeEventListener === 'function') {
          this.pubsub.removeEventListener('message', this._blockReqListener);
          this._blockReqListener = null;
        }
      } catch (e) { /* ignore */ }
    } catch (e) { /* ignore */ }
  }

  async _onPubsubBlockRequest(evt: any) {
    try {
      const detail = evt.detail;
      if (!detail) return;
      const topic = detail.topic ?? detail.topicName ?? (detail.topics && detail.topics[0]) ?? null;
      const reqTopic = `${this.topic}/block-req`;
      if (topic !== reqTopic) return;

      // normalize data buffer similar to _onPubsubMessage
      let dataBuf: Uint8Array | null = null;
      try {
        if (detail.data instanceof Uint8Array) dataBuf = detail.data;
        else if (detail.data && detail.data.data instanceof Uint8Array) dataBuf = detail.data.data;
        else if (detail.message && detail.message.data instanceof Uint8Array) dataBuf = detail.message.data;
        else if (typeof detail.data === 'string') dataBuf = Buffer.from(detail.data, 'utf8');
        else if (typeof detail === 'string') dataBuf = Buffer.from(detail, 'utf8');
      } catch (e) { dataBuf = null; }
      if (!dataBuf) return;
      let obj: any;
      try { obj = JSON.parse(Buffer.from(dataBuf).toString('utf8')); } catch (e) { return; }
      const cid = obj && obj.cid;
      const target = obj && obj.target;
      const myId = this.libp2p?.peerId?.toString?.();
      if (!cid) return;
      if (target && target !== myId) return; // request is for someone else

      const block = await this.blockstore.get(cid);
      if (!block) return;

      // publish response with base64 block
      const resTopic = `${this.topic}/block-resp`;
      const payload = JSON.stringify({ cid, from: myId, block: Buffer.from(block).toString('base64') });
      try { await this.pubsub.publish(resTopic, Buffer.from(payload)); } catch (e) { /* ignore */ }
    } catch (e) { /* ignore */ }
  }

  async publishHeads(heads: string[]) {
    if (!this.pubsub || typeof this.pubsub.publish !== 'function') return;
    const addrs = (typeof this.libp2p?.getMultiaddrs === 'function') ? this.libp2p.getMultiaddrs().map((m:any) => m.toString()) : [];
    // demo-only: include raw blocks (base64) for the heads so peers can apply deterministically
    // gated by DEMO_INLINE_BLOCKS env var so production won't leak raw blocks accidentally.
    const blocks: Record<string,string> = {};
    const enableInline = (typeof process !== 'undefined') && (String(process.env.DEMO_INLINE_BLOCKS) === '1' || String(process.env.DEMO_INLINE_BLOCKS).toLowerCase() === 'true');
    if (enableInline) {
      try {
        for (const cid of heads) {
          try {
            const b = await this.blockstore.get(cid);
            if (b) blocks[cid] = Buffer.from(b).toString('base64');
          } catch (e) { /* missing block, ignore */ }
        }
      } catch (e) { /* ignore */ }
    }

    const payload = JSON.stringify({ heads, peerId: this.libp2p?.peerId?.toString?.(), addrs, blocks });
    console.log(`VerimutSync: publishing heads -> ${payload}`);
    try {
      await this.pubsub.publish(this.topic, Buffer.from(payload));
    } catch (e) { /* ignore */ }
  }

  async _onPubsubMessage(evt: any) {
    try {
      const detail = evt.detail;
      if (!detail) return;
      // If the pubsub implementation provides a topic name, ignore messages for other topics
      const incomingTopic = detail.topic ?? detail.topicName ?? (detail.topics && detail.topics[0]) ?? null;
      if (incomingTopic && incomingTopic !== this.topic) return;
      // normalize message payload across different pubsub implementations
      let dataBuf: Uint8Array | null = null;
      try {
        if (detail.data instanceof Uint8Array) dataBuf = detail.data;
        else if (detail.data && detail.data.data instanceof Uint8Array) dataBuf = detail.data.data;
        else if (detail.message && detail.message.data instanceof Uint8Array) dataBuf = detail.message.data;
        else if (typeof detail.data === 'string') dataBuf = Buffer.from(detail.data, 'utf8');
        else if (typeof detail === 'string') dataBuf = Buffer.from(detail, 'utf8');
      } catch (e) {
        dataBuf = null;
      }
      if (!dataBuf) {
        console.warn('VerimutSync: could not normalize pubsub message payload', detail);
        return;
      }
      let obj: any;
      try {
        obj = JSON.parse(Buffer.from(dataBuf).toString('utf8'));
      } catch (e) {
        console.warn('VerimutSync: pubsub message is not JSON, ignoring; raw=', Buffer.from(dataBuf).toString('hex'));
        return;
      }
  let remotePeer = obj.peerId;
      const heads: string[] = obj.heads || [];
      // If heads are missing/empty, emit a compact debug dump of the raw message
      if ((!obj.heads || !Array.isArray(obj.heads) || obj.heads.length === 0)) {
        try {
          const detailKeys = Object.keys(detail).slice(0, 10);
          const utf = Buffer.from(dataBuf).toString('utf8');
          const b64 = Buffer.from(dataBuf).toString('base64');
          console.debug('VerimutSync: pubsub message has empty heads; detailKeys=', detailKeys, 'utf8Preview=', utf.slice(0, 200), 'base64=', b64.slice(0, 200));
        } catch (e) { /* ignore */ }
      }
      if (!remotePeer) {
        // If the announcement didn't include a peerId, attempt to discover peers
        // for this topic via the DHT as a fallback and use the first discovered peer.
        try {
          const dht: any = (this.libp2p && (this.libp2p as any).services && (this.libp2p as any).services.dht) ? (this.libp2p as any).services.dht : null;
          if (dht && typeof dht.get === 'function') {
            const maybe = await (dht.get as any)(this.topic).catch(() => null);
            if (maybe) {
              const s = (typeof maybe === 'string') ? maybe : (Buffer.isBuffer(maybe) ? maybe.toString() : String(maybe));
              const fallbackPeers = s.split(',').map((p: any) => String(p).trim()).filter(Boolean);
              if (fallbackPeers.length) {
                    remotePeer = fallbackPeers[0];
                    console.log('[Sync] Fallback DHT peer chosen for anonymous heads:', remotePeer);
              } else {
                console.log('[Sync] DHT returned no peers for topic fallback');
              }
            }
          }
        } catch (e) {
          console.warn('[Sync] DHT fallback failed:', e);
        }
        if (!remotePeer) return;
      }
      if (remotePeer === this.libp2p?.peerId?.toString?.()) return; // ignore our own announcements

  console.log(`VerimutSync: heard heads from ${remotePeer}:`, heads);

      // prefer multiaddrs provided by announcer when dialing
      const preferredAddr = (obj.addrs && obj.addrs.length) ? obj.addrs[0] : null;
      for (const cid of heads) {
        try {
          const has = await this.blockstore.has(cid);
          if (has) continue;
          // demo-only optimization: if the announcer included the raw block bytes, use them
          if (obj.blocks && obj.blocks[cid]) {
            try {
              const buf = Buffer.from(obj.blocks[cid], 'base64');
              const storedCid = await this.blockstore.put(buf);
              if (storedCid !== cid) {
                console.warn(`VerimutSync: announced inline block CID mismatch: expected ${cid} got ${storedCid}`);
              } else {
                  const applied = await this.log.applyCid(cid);
                  if (applied) console.log(`VerimutSync: applied block ${cid} (inline) from ${remotePeer}`);
                  else console.warn(`VerimutSync: inline block ${cid} from ${remotePeer} failed verification`);
                continue;
              }
            } catch (e) {
              console.warn(`VerimutSync: failed to store inline block ${cid}:`, e);
            }
          }

          console.log(`VerimutSync: attempting fetch for ${cid} from ${remotePeer}`);
          const target = preferredAddr ?? remotePeer;
          const block = await this._fetchBlockWithRetries(target, cid, 3, 5000);
          if (!block) {
            console.warn(`VerimutSync: failed to fetch ${cid} from ${remotePeer}`);
            continue;
          }

          // store the block and verify/apply via the log
          const storedCid = await this.blockstore.put(block);
            if (storedCid !== cid) {
            console.warn(`VerimutSync: fetched block CID mismatch: expected ${cid} got ${storedCid}`);
            continue;
          }

          const applied = await this.log.applyCid(cid);
          if (applied) {
            console.log(`VerimutSync: applied block ${cid} from ${remotePeer}`);
          } else {
            console.warn(`VerimutSync: block ${cid} from ${remotePeer} failed verification`);
          }
        } catch (e) {
          console.error('VerimutSync: error handling head', e);
        }
      }
    } catch (e) {
      console.error('VerimutSync._onPubsubMessage error', e);
    }
  }

  // fetch a block via the direct protocol with retries and timeouts
  async _fetchBlockWithRetries(remotePeer: string, cid: string, attempts = 3, timeoutMs = 5000): Promise<Uint8Array | undefined> {
    let lastErr: any = null;
    for (let i = 0; i < attempts; i++) {
      try {
        const p = this._fetchBlock(remotePeer, cid);
        const block = await Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs))]);
        // record a successful direct fetch
        try { this.totalFetches++; this.directFetches++; } catch (e) { /* ignore */ }
        return block as Uint8Array;
      } catch (e) {
  lastErr = e;
  const backoff = 200 * Math.pow(2, i);
  const emsg = (e as any)?.message ?? String(e);
  console.warn(`VerimutSync: fetch attempt ${i + 1} for ${cid} failed: ${emsg}. retrying in ${backoff}ms`);
        await new Promise((res) => setTimeout(res, backoff));
      }
    }
    console.error(`VerimutSync: all fetch attempts failed for ${cid}:`, lastErr);
    // as a pragmatic fallback in environments where direct dial/streams are unreliable
    // try to retrieve the block via pubsub (request/response) once
    try {
      const via = await this._fetchBlockViaPubsub(remotePeer, cid, timeoutMs * 2);
      if (via) {
        try { this.totalFetches++; } catch (e) { /* ignore */ }
        return via;
      }
    } catch (e) {
      console.warn('VerimutSync: pubsub fallback failed', e);
    }
    return undefined;
  }

  // fallback block fetch via pubsub: requester publishes a request and waits for a response
  async _fetchBlockViaPubsub(remotePeer: string, cid: string, timeoutMs = 10000): Promise<Uint8Array | undefined> {
    if (!this.pubsub || typeof this.pubsub.publish !== 'function') return undefined;
    const reqTopic = `${this.topic}/block-req`;
    const resTopic = `${this.topic}/block-resp`;

    // ensure we're subscribed to responses
    try {
      if (typeof this.pubsub.subscribe === 'function') await this.pubsub.subscribe(resTopic);
    } catch (e) { /* ignore */ }

    const myId = this.libp2p?.peerId?.toString?.();

    return await new Promise<Uint8Array | undefined>((resolve) => {
      const onMsg = (evt: any) => {
        try {
          const data = evt?.detail?.data instanceof Uint8Array ? Buffer.from(evt.detail.data) : Buffer.from(evt.detail?.data ?? []);
          const obj = JSON.parse(data.toString('utf8'));
          if (!obj || obj.cid !== cid) return;
          // only accept responses from the target remotePeer
          if (obj.from !== remotePeer) return;
          if (!obj.block) return;
          const buf = Buffer.from(obj.block, 'base64');
          try { this.pubsub.removeEventListener('message', onMsg); } catch (e) { }
          try { clearTimeout(timeoutId); } catch (e) { }
          resolve(buf);
        } catch (e) { /* ignore */ }
      };

      // listen for responses
      try { this.pubsub.addEventListener('message', onMsg); } catch (e) { /* ignore */ }

      // publish a request
      const payload = JSON.stringify({ cid, from: myId, target: remotePeer });
      try { this.pubsub.publish(reqTopic, Buffer.from(payload)); } catch (e) { /* ignore */ }

      // timeout (kept in a variable so we can clear it when a response arrives)
      const timeoutId = setTimeout(() => {
        try { this.pubsub.removeEventListener('message', onMsg); } catch (e) { }
        resolve(undefined);
      }, timeoutMs);
    });
  }

  // single fetch attempt (no timeout/retry)
  async _fetchBlock(remotePeer: string, cid: string): Promise<Uint8Array> {
    // We'll attempt several dialing strategies in order, logging details so failures are actionable.
    const attempts: Array<{desc: string, target: string}> = [];
    attempts.push({ desc: 'as-provided', target: remotePeer });
    // if remotePeer looks like a multiaddr with /p2p/<peerId>, add an attempt using the peerId only
    const m = /\/p2p\/([^/]+)$/.exec(String(remotePeer));
    if (m && m[1]) attempts.push({ desc: 'peerId-from-multiaddr', target: m[1] });
    // also try dialing the multiaddr explicitly (some stacks accept multiaddrs directly)
    attempts.push({ desc: 'multiaddr-explicit', target: remotePeer });

    // Improved dial strategy: prefer dialing by peerId to avoid libp2p v0.47+ returning arrays
    let lastErr: any = null;
    let stream: any = null;
    const perAttemptTimeout = 8000;

    // If remotePeer is a multiaddr containing /p2p/<id>, prefer the peerId form
    let targetPeerId = String(remotePeer);
    try {
      if (String(remotePeer).includes('/p2p/')) {
        targetPeerId = String(remotePeer).split('/p2p/')[1].split('/')[0];
      }
    } catch (e) { /* ignore */ }

    for (const a of attempts) {
      try {
        console.debug(`VerimutSync: dial attempt (${a.desc}) -> ${a.target}`);

        const withTimeout = async (p: Promise<any>, ms: number) => {
          let timeoutId: any = null;
          try {
            return await Promise.race([
              p,
              new Promise((_, rej) => { timeoutId = setTimeout(() => rej(new Error('attempt-timeout')), ms); }),
            ]);
          } finally {
            try { if (timeoutId) clearTimeout(timeoutId); } catch (e) { }
          }
        };

        // Try dialing the requested target using dialProtocol first. In some
        // libp2p versions dialing by peerId or the internal dial() may return
        // unexpected shapes (arrays/PeerInfo objects) which can cause internal
        // errors. Dialing the protocol directly is often more reliable.
        if (typeof (this.libp2p as any).dialProtocol === 'function') {
          try {
            const dp = await withTimeout((this.libp2p as any).dialProtocol(a.target, '/verimut/block/1.0.0'), perAttemptTimeout);
            // dialProtocol may return a stream or an array-like shape
            if (Array.isArray(dp)) {
              const s0 = dp[0];
              stream = s0 && (s0.stream ?? s0);
            } else {
              stream = dp && (dp.stream ?? dp);
            }
          } catch (dpErr) {
            console.warn(`VerimutSync: dialProtocol failed for ${a.target}: ${(dpErr && (dpErr as any).message) ? (dpErr as any).message : dpErr}`);
          }
        }

        // If dial by peerId didn't produce a stream, try dialProtocol or multiaddr dial
        if (!stream && typeof (this.libp2p as any).dialProtocol === 'function') {
          try {
            const dp = await withTimeout((this.libp2p as any).dialProtocol(a.target, '/verimut/block/1.0.0'), perAttemptTimeout);
            stream = dp;
          } catch (dpErr) {
            console.warn(`VerimutSync: dialProtocol failed for ${a.target}: ${(dpErr && (dpErr as any).message) ? (dpErr as any).message : dpErr}`);
            // attempt generic dial using a.target (may be multiaddr)
            if (typeof (this.libp2p as any).dial === 'function') {
              try {
                const connResult2 = await withTimeout((this.libp2p as any).dial(a.target), perAttemptTimeout);
                const conn2 = Array.isArray(connResult2) ? connResult2[0] : connResult2;
                if (conn2 && typeof conn2.newStream === 'function') {
                  try {
                    const sr = await withTimeout(conn2.newStream('/verimut/block/1.0.0'), perAttemptTimeout);
                    if (Array.isArray(sr)) {
                      const s0 = sr[0];
                      stream = s0 && (s0.stream ?? s0);
                    } else {
                      stream = sr && (sr.stream ?? sr);
                    }
                  } catch (e) { /* ignore */ }
                }
              } catch (e) { /* ignore */ }
            }
          }
        }

        if (stream) break;
      } catch (e: any) {
        lastErr = e;
        const emsg = (e && e.message) ? String(e.message) : String(e);
        console.warn(`VerimutSync: dial attempt (${a.desc}) -> ${a.target} failed: ${emsg}`);
        // continue to next attempt
      }
    }

    if (!stream) {
      const emsg = (lastErr && lastErr.message) ? lastErr.message : String(lastErr);
      throw new Error(`VerimutSync: all dial attempts failed for ${remotePeer}: ${emsg}`);
    }

    // helper: write and read using normalized stream shapes
    const writeRequest = async (s: any, payload: Uint8Array) => {
      try {
        if (s && typeof s.sink === 'function') {
          await pipe([payload], s.sink);
          return;
        }
      } catch (e) { /* fallthrough */ }
      try {
        if (s && typeof s.write === 'function') {
          s.write(payload);
          if (typeof s.end === 'function') s.end();
          return;
        }
      } catch (e) { /* fallthrough */ }
      try {
        await pipe([payload], s);
        return;
      } catch (e) { /* ignore */ }
      throw new Error('VerimutSync: unable to write request to stream');
    };

    const readResponse = async (s: any) => {
      const chunks: Uint8Array[] = [];
      try {
        const src = s && s.source ? s.source : s;
        if (src && typeof src[Symbol.asyncIterator] === 'function') {
          for await (const c of src) chunks.push(Buffer.from(c));
          return Buffer.concat(chunks);
        }
      } catch (e) { /* fallthrough */ }
      try {
        if (s && typeof s[Symbol.asyncIterator] === 'function') {
          for await (const c of s) chunks.push(Buffer.from(c));
          return Buffer.concat(chunks);
        }
      } catch (e) { /* ignore */ }
      try {
        if (s && typeof s.read === 'function') {
          let chunk;
          while (null !== (chunk = s.read())) chunks.push(Buffer.from(chunk));
          return Buffer.concat(chunks);
        }
      } catch (e) { /* ignore */ }
      throw new Error('VerimutSync: unable to read response from stream');
    };

    try {
      const payload = Buffer.from(JSON.stringify({ cid }));
      await writeRequest(stream, payload);
      const res = await readResponse(stream);
      return res;
    } catch (e) {
      try { if (stream && typeof stream.close === 'function') stream.close(); } catch (er) { }
      try { if (stream && typeof stream.abort === 'function') stream.abort(); } catch (er) { }
      throw e;
    }
  }

  // Attempt to gracefully cleanup a stream connection
  _cleanupStream(stream: any, err: any) {
    try { if (stream && typeof stream.abort === 'function') stream.abort(err); } catch (e) { }
    try { if (stream && typeof stream.close === 'function') stream.close(); } catch (e) { }
  }

  /**
   * VNS: Publish a delta to the /verimut/vns topic (or HTTP P2P fallback)
   */
  async publishVNSDelta(delta: any): Promise<void> {
    // Try pubsub first if available AND not a local shim
    const isShim = this.pubsub && (this.pubsub as any).isShim === true;
    if (this.pubsub && typeof this.pubsub.publish === 'function' && !isShim) {
      try {
        const payload = JSON.stringify(delta);
        await this.pubsub.publish(this.vnsTopic, Buffer.from(payload, 'utf8'));
        console.log(`[VerimutSync] Published VNS delta via pubsub: ${delta.type} for ${delta.entry.name}`);
        return;
      } catch (e) {
        console.error('[VerimutSync] Failed to publish VNS delta via pubsub:', e);
      }
    }
    
    // Skip shim and go straight to HTTP P2P if shim is detected
    if (isShim) {
      console.log('[VerimutSync] Detected local pubsub shim, using HTTP P2P for multi-node sync');
    }

    // Fallback to HTTP P2P if pubsub not available
    if (this.httpP2P && this.httpP2P.isAvailable()) {
      await this.httpP2P.pushDelta(delta);
    } else {
      console.warn('[VerimutSync] Cannot publish VNS delta: no pubsub and no HTTP P2P configured');
    }
  }

  /**
   * VNS: Handle incoming delta from /verimut/vns topic
   */
  async _onVNSMessage(evt: any): Promise<void> {
    try {
      const detail = evt.detail;
      if (!detail) return;

      // Check topic
      const incomingTopic = detail.topic ?? detail.topicName ?? (detail.topics && detail.topics[0]) ?? null;
      if (incomingTopic && incomingTopic !== this.vnsTopic) return;

      // Normalize payload
      let dataBuf: Uint8Array | null = null;
      try {
        if (detail.data instanceof Uint8Array) dataBuf = detail.data;
        else if (detail.data && detail.data.data instanceof Uint8Array) dataBuf = detail.data.data;
        else if (detail.message && detail.message.data instanceof Uint8Array) dataBuf = detail.message.data;
        else if (typeof detail.data === 'string') dataBuf = Buffer.from(detail.data, 'utf8');
        else if (typeof detail === 'string') dataBuf = Buffer.from(detail, 'utf8');
      } catch (e) {
        dataBuf = null;
      }

      if (!dataBuf) {
        console.warn('[VerimutSync VNS] Could not normalize message payload');
        return;
      }

      // Parse delta
      let delta: any;
      try {
        delta = JSON.parse(Buffer.from(dataBuf).toString('utf8'));
      } catch (e) {
        console.warn('[VerimutSync VNS] Message is not valid JSON');
        return;
      }

      // Validate delta structure
      if (!delta || !delta.type || !delta.entry || !delta.peerId) {
        console.warn('[VerimutSync VNS] Invalid delta structure');
        return;
      }

      // Get source peer ID
      const sourcePeerId = delta.peerId;

      // Ignore our own deltas
      if (sourcePeerId === this.libp2p?.peerId?.toString?.()) {
        return;
      }

      console.log(`[VerimutSync VNS] Received ${delta.type} delta for ${delta.entry.name} from ${sourcePeerId.slice(0, 16)}...`);

      // Apply delta to VNS store
      if (this.vnsStore && typeof this.vnsStore.applyDelta === 'function') {
        const result = await this.vnsStore.applyDelta(delta, sourcePeerId);
        if (result.applied) {
          console.log(`[VerimutSync VNS] Successfully applied delta for ${delta.entry.name}`);
        } else {
          console.log(`[VerimutSync VNS] Delta not applied: ${result.error || 'unknown reason'}`);
        }
      } else {
        console.warn('[VerimutSync VNS] No VNS store registered to apply delta');
      }
    } catch (e) {
      console.error('[VerimutSync VNS] Error handling message:', e);
    }
  }

  /**
   * VNS: Subscribe to the /verimut/vns topic
   */
  async subscribeToVNS(): Promise<void> {
    if (!this.pubsub || typeof this.pubsub.subscribe !== 'function') {
      console.warn('[VerimutSync] Cannot subscribe to VNS: pubsub not available');
      return;
    }

    try {
      await this.pubsub.subscribe(this.vnsTopic);
      this.pubsub.addEventListener('message', (evt: any) => this._onVNSMessage(evt));
      console.log(`[VerimutSync] Subscribed to VNS topic: ${this.vnsTopic}`);
    } catch (e) {
      console.error('[VerimutSync] Failed to subscribe to VNS topic:', e);
    }
  }
}

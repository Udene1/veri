import { createNode, stopNode } from './peer.js';
import { loadConfig } from '../config.js';
import { shard, solve } from '../compute/demo.js';
import { generateKeyPair, verify } from '../utils/crypto.js';

/**
 * Bootstrap node: dial configured bootstrap peers and start heartbeat/pubsub handlers.
 */
export async function bootstrapNode(isDemo: boolean = false) {
  const cfg = loadConfig();
  let bundle: any;

  if (isDemo) {
    // Demo mode: use a tiny TCP-based pubsub shim to simulate gossip across
    // processes without fighting Helia/libp2p component logger issues.
    const listenPort = process.env.LISTEN_PORT ? parseInt(process.env.LISTEN_PORT) : 4001;
    // If bootstrap peers are configured, act as a client connecting to the first peer's shim.
    let pubsub: any = null;
    let libp2p: any = null;
    if ((cfg.bootstrapPeers || []).length > 0) {
      // parse first bootstrap peer addr like /ip4/127.0.0.1/tcp/4001/p2p/...
      const bp = cfg.bootstrapPeers[0];
      const m = bp.match(/ip4\/([^/]+)\/tcp\/(\d+)/);
      const host = m ? m[1] : '127.0.0.1';
      const port = m ? parseInt(m[2]) : listenPort;
  const shim = await import('./demo-pubsub-shim.js');
      pubsub = await shim.createDemoShimAsClient(host, port);
      // create Helia for storage only
      const storageBundle = await createNode(cfg.bootstrapPeers);
      libp2p = storageBundle.libp2p;
      bundle = { libp2p, helia: storageBundle.helia, fs: storageBundle.fs, pubsub };
    } else {
  const shim = await import('./demo-pubsub-shim.js');
      const serverShim = await shim.createDemoShimAsServer(listenPort);
      // Helia for storage (not used for pubsub here)
      const storageBundle = await createNode(cfg.bootstrapPeers);
      libp2p = storageBundle.libp2p;
      bundle = { libp2p, helia: storageBundle.helia, fs: storageBundle.fs, pubsub: serverShim };
    }
  } else {
    bundle = await createNode(cfg.bootstrapPeers);
  }

  const libp2p: any = bundle.libp2p;
  const pubsub: any = bundle.pubsub ?? libp2p?.services?.pubsub ?? libp2p?.pubsub ?? null;

  if (!libp2p) {
    throw new Error('libp2p not available — cannot bootstrap');
  }

  // Dial bootstrap peers
  let success = 0;
  for (const p of cfg.bootstrapPeers || []) {
    try {
      if (typeof libp2p.dial === 'function') await libp2p.dial(p);
      success++;
      console.log('Dialed bootstrap peer:', p);
    } catch (err) {
      console.warn('Failed to dial bootstrap peer', p, err);
    }
  }
  console.log(`Bootstrapped to ${success}/${(cfg.bootstrapPeers||[]).length} peers`);

  // Heartbeat publisher
  setInterval(async () => {
    try {
      const hb = { peerId: libp2p.peerId.toString(), ts: Date.now(), capacity: 100 }; // Default capacity
      if (pubsub && typeof pubsub.publish === 'function') {
        await pubsub.publish('heartbeats', Buffer.from(JSON.stringify(hb)));
      }
      console.log('Heartbeat sent');
    } catch (err) {
      console.warn('Heartbeat error', err);
    }
  }, 30 * 1000);

  // Message handler — react to tasks/open and results/<taskId>
  const ledger = new Map<string, Record<string, number>>(); // taskId -> { peerId: credits }
  const seenTasks = new Set<string>();

  try {
    if (pubsub && typeof pubsub.addEventListener === 'function') {
      pubsub.addEventListener('message', async (evt: any) => {
        try {
          const topic = evt?.detail?.topic as string;
          const data = evt?.detail?.data as Uint8Array;
          if (!topic || !data) return;

          // Handle incoming tasks
          if (topic === 'tasks/open') {
            const txt = Buffer.from(data).toString();
            let task: any;
            try { task = JSON.parse(txt); } catch (e) { task = { taskId: `task-${Date.now()}`, text: txt }; }
            console.log('Received task:', task);

            // If we've already processed this task, ignore
            if (seenTasks.has(task.taskId)) return;
            seenTasks.add(task.taskId);

            // Determine shards
            const shards = task.shards && Array.isArray(task.shards) && task.shards.length ? task.shards : shard(task.text || String(task));

            // Pick a shard to solve (simple strategy: random)
            const shardIndex = Math.floor(Math.random() * Math.max(1, shards.length));
            const shardToSolve = shards[shardIndex] || shards[0];

            // Solve it
            try {
              const solved = await solve(shardToSolve);
              const resultTopic = `results/${task.taskId}`;
              const payload = JSON.stringify({ peerId: libp2p.peerId.toString(), result: solved.result, sig: solved.sig, ts: solved.ts });
              if (pubsub && typeof pubsub.publish === 'function') {
                await pubsub.publish(resultTopic, Buffer.from(payload));
                console.log('Published result to', resultTopic, payload);
              } else {
                console.log('Pubsub unavailable — cannot publish result, payload:', payload);
              }
            } catch (err) {
              console.warn('Error solving shard', err);
            }
          }

          // Handle results for tasks
          if (topic?.startsWith('results/')) {
            const taskId = topic.split('/')[1];
            const txt = Buffer.from(data).toString();
            let res: any = null;
            try { res = JSON.parse(txt); } catch (e) { return; }
            console.log('Received result for', taskId, res);

            // Verify signature (stubbed verify will pass in demo)
            const ok = await verify(JSON.stringify({ result: res.result, ts: res.ts, shard: res.shard }), res.sig, new Uint8Array());
            if (!ok) {
              console.warn('Result signature invalid for', res.peerId);
              return;
            }

            // Credit the peer (first valid result wins for simplicity)
            if (!ledger.has(taskId)) {
              ledger.set(taskId, { [res.peerId]: 1 });
              console.log(`Accredited peer ${res.peerId} for task ${taskId}`);
            } else {
              const entry = ledger.get(taskId) as Record<string, number>;
              entry[res.peerId] = (entry[res.peerId] || 0) + 1;
              ledger.set(taskId, entry);
              console.log(`Updated ledger for ${taskId}:`, entry);
            }
          }
        } catch (err) { /* ignore per-message errors */ }
      });
    } else {
      if (!pubsub) console.log('Pubsub not attached — listeners inactive');
    }
  } catch (err) {
    // ignore
  }

  // Return the full bundle (libp2p, helia, fs, pubsub) for CLI and demo use
  return bundle;
}

export async function shutdownNode(libp2pOrBundle: any) {
  try {
    if (libp2pOrBundle && typeof libp2pOrBundle.libp2p !== 'undefined') {
      // If this bundle used the standalone libp2p helper, stop it explicitly
      try { if (libp2pOrBundle.libp2p && typeof libp2pOrBundle.libp2p.stop === 'function') await libp2pOrBundle.libp2p.stop(); } catch (e) { /* ignore */ }
      await stopNode(libp2pOrBundle);
    } else if (libp2pOrBundle && typeof libp2pOrBundle.stop === 'function') {
      await libp2pOrBundle.stop();
    }
  } catch (err) {
    console.warn('Error shutting down node', err);
  }
}

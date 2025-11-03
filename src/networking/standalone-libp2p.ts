import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { yamux } from '@libp2p/yamux';
import { mplex } from '@libp2p/mplex';
import { gossipsub } from '@chainsafe/libp2p-gossipsub';
import { kadDHT } from '@libp2p/kad-dht';
import { noise } from '@libp2p/noise';

export async function createStandaloneLibp2p(listenPort: number) {

  try {
    const config = {
      addresses: { listen: [`/ip4/0.0.0.0/tcp/${listenPort}`] },
      transports: [tcp()],
      connectionEncryption: [noise()],
      streamMuxers: [yamux(), mplex()],
      // connection manager and relay options to improve dialing success in NATed/demo
      connectionManager: {
        minConnections: 2,
        maxConnections: 64,
      },
      relay: {
        enabled: true,
        // Keep default reservations empty for now; enables relay support
        reservations: [],
      },
      services: {
        // @ts-ignore
        dht: kadDHT(),
        // @ts-ignore
        // Gossipsub config for small demo swarms with peer exchange
        pubsub: gossipsub({
          allowPublishToZeroPeers: true,
          fallbackToFloodsub: true,
          D: 3,  // 3 for small swarms (2 min, 4 max)
          Dlo: 2,
          Dhi: 4,
          doPX: true,  // Peer exchange for bootstrap
          heartbeatInterval: 2000,
          // note: no-op validation intentionally omitted for demo compatibility with multiple libp2p versions
        }),
      },
    };

    // @ts-ignore
    const libp2p = await createLibp2p(config as any);
    return libp2p;
  } catch (e) {
    console.warn('createStandaloneLibp2p failed:', e);
    throw e;
  }
}


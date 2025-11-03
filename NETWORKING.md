# VerimutFS Networking Layer

## Overview

The networking layer handles all P2P connectivity, IPFS storage, and distributed communication for VerimutFS nodes.

## File Structure

```
src/networking/
├── peer.ts                    # Main node creation & lifecycle
├── standalone-libp2p.ts       # libp2p configuration
├── bootstrap.ts               # Bootstrap peer discovery
├── mesh-monitor.ts            # Network health monitoring
└── demo-pubsub-shim.ts       # Pub/sub utilities
```

## Core Components

### 1. `peer.ts` - Node Bundle Creation

**Main Export:** `createNode(bootstrapPeers: string[]): Promise<NodeBundle>`

The NodeBundle contains:
- **libp2p**: P2P networking stack
- **helia**: IPFS implementation
- **fs**: UnixFS file system interface
- **pubsub**: GossipSub messaging
- **verimut**: Core Verimut services (log, sync, blocks)
- **controllers**: Background process controllers
- **meshMonitor**: Network health monitoring

**Usage:**
```typescript
import { createNode, stopNode } from './networking/peer.js';

const bundle = await createNode([
  '/ip4/1.2.3.4/tcp/4001/p2p/QmBootstrapPeer...'
]);

// Access components
bundle.libp2p.getPeers();
bundle.helia.blockstore.get(cid);
bundle.verimut.log.append(entry);

await stopNode(bundle);
```

### 2. `standalone-libp2p.ts` - libp2p Configuration

Creates a fully configured libp2p node with:
- **Transport**: TCP
- **Stream Muxers**: Yamux, Mplex
- **Encryption**: Noise protocol
- **DHT**: Kademlia DHT for peer discovery
- **PubSub**: GossipSub for messaging
- **Peer Discovery**: Bootstrap, mDNS (optional)

### 3. `bootstrap.ts` - Bootstrap Management

Handles connection to bootstrap peers that help new nodes discover the network.

### 4. `mesh-monitor.ts` - Network Health

Monitors:
- Connected peer count
- Connection stability
- Network partitions
- DHT health

## Integration with Node Manager

The `node-manager.ts` wraps the networking layer:

```typescript
import { createNode, stopNode, NodeBundle } from './networking/peer.js';

export class VerimutNode {
  private nodeBundle: NodeBundle | null = null;

  async start() {
    // Create the entire node bundle
    this.nodeBundle = await createNode(this.config.bootstrapPeers);
  }

  async stop() {
    if (this.nodeBundle) {
      await stopNode(this.nodeBundle);
    }
  }

  // Access components
  get libp2p() { return this.nodeBundle?.libp2p; }
  get helia() { return this.nodeBundle?.helia; }
  get verimut() { return this.nodeBundle?.verimut; }
}
```

## Dependencies

All networking dependencies are in `package.json`:

```json
{
  "libp2p": "^0.47.0",
  "helia": "^4.0.0",
  "@helia/unixfs": "^3.0.0",
  "@libp2p/tcp": "^9.0.0",
  "@libp2p/noise": "^14.0.0",
  "@libp2p/yamux": "^6.0.0",
  "@libp2p/mplex": "^10.0.0",
  "@libp2p/kad-dht": "^12.0.0",
  "@chainsafe/libp2p-gossipsub": "^13.0.0",
  "@libp2p/peer-id-factory": "^4.0.0",
  "pino": "^8.17.2"
}
```

## Bootstrap Peers

Bootstrap peers are configured in `config.ts`:

```typescript
export const DEFAULT_BOOTSTRAP_PEERS: string[] = [
  // Add your bootstrap node addresses here
  // Format: /ip4/1.2.3.4/tcp/4001/p2p/QmPeerID...
];
```

**To get your bootstrap peer address:**
1. Run a node: `npm start`
2. Check console output for multiaddrs
3. Share the public addresses with other node operators

## Protocol Stack

```
┌─────────────────────────────────────┐
│       CLI / HTTP API                │
├─────────────────────────────────────┤
│       Node Manager                  │
├─────────────────────────────────────┤
│  ┌──────────┬──────────┬──────────┐ │
│  │ libp2p   │  Helia   │ Verimut  │ │
│  │          │  (IPFS)  │ Services │ │
│  └──────────┴──────────┴──────────┘ │
├─────────────────────────────────────┤
│       Networking Layer              │
│  ┌──────────────────────────────┐   │
│  │  peer.ts (Node Bundle)       │   │
│  │  standalone-libp2p.ts        │   │
│  │  bootstrap.ts                │   │
│  │  mesh-monitor.ts             │   │
│  └──────────────────────────────┘   │
└─────────────────────────────────────┘
```

## Key Concepts

### NodeBundle
A complete package containing all services needed to run a VerimutFS node. Created once, used everywhere.

### Peer Identity
Each node has a persistent PeerId stored in `<dataDir>/peer-id.json`. This identity is used for:
- Cryptographic signing
- DHT operations
- Peer connections

### Gossipsub Topics
- `verimut:profiles` - Profile announcements
- `verimut:bookings` - Booking updates
- `verimut:chat` - Direct messages

### DHT Keys
- `/verimut/profile/<hash>` - Profile lookups
- `/verimut/skill/<skill>` - Skill-based search
- `/verimut/location/<geohash>` - Location-based search

## Troubleshooting

### No Peers Connecting
- Check bootstrap peers are correct
- Verify firewall allows TCP on listen port
- Ensure bootstrap nodes are online

### DHT Not Working
- Need at least 20 connected peers for DHT
- Wait 2-3 minutes for DHT bootstrap
- Check console for DHT errors

### Profile Not Publishing
- Verify profile JSON format
- Check IPFS blockstore permissions
- Look for errors in verimut.log

# VerimutFS Node# VerimutFS P2P Node



🌐 **Join the Verimut decentralized skill-sharing network!**Core peer-to-peer node implementing encrypted profile storage, DHT-based indexing, and proximity search for the Verimut skill-sharing platform.



VerimutFS is a peer-to-peer node that connects you to the Verimut platform - a privacy-first, decentralized network for connecting skill providers with those who need them.## 🏗️ Architecture



## 🚀 Quick Start```

backend/node/

### Installation├── src/

│   ├── core/                 # Core modules

```bash│   │   ├── identity.ts       # Peer identity management

# Clone the repository│   │   ├── blockstore.ts     # Block storage

git clone https://github.com/udene01/verimutfs-node.git│   │   └── sync.ts           # Synchronization

cd verimutfs-node│   ├── crypto/               # Cryptography

│   │   └── crypto-utils.ts   # Encryption, signing, geohashing

# Install dependencies│   ├── storage/              # Storage layer

npm install│   │   └── encrypted-blockstore.ts

│   ├── indexing/             # DHT indexing

# Build the project│   │   └── dht-index.ts      # Multi-dimensional indexes

npm run build│   ├── query/                # Search engine

│   │   └── query-engine.ts   # Proximity search

# Start your node│   ├── access/               # Access control

npm start│   │   └── access-control.ts # Permissions & connections

```│   ├── protocols/            # libp2p protocols

│   │   └── profile-protocol.ts

Your node will automatically connect to the Verimut network and start participating!│   ├── types/                # TypeScript types

│   │   ├── profile-schema.ts

## 📦 What This Node Does│   │   └── types.ts

│   ├── examples/             # Usage examples

- **🔍 Proximity Search**: Find service providers near your location
- **🔐 Encrypted Storage**: Store and retrieve encrypted profile data
- **📡 DHT Indexing**: Participate in the distributed hash table for fast searches
- **🤝 Peer Discovery**: Connect with other nodes in the network
- **🛡️ Privacy-First**: All sensitive data is encrypted, location privacy via geohashing
- **🌐 VNS (Verimut Name Service)**: Decentralized DNS for `.vfs` names (NEW!)

## 🆕 Verimut Name Service (VNS)

**Decentralized DNS for the Verimut network** - Register and resolve human-readable `.vfs` names!

### Quick VNS Start

```bash
# Start node with VNS enabled
npm start -- --enable-vns

# Register a name (CLI)
verimutfs vns register myproject.vfs --cid QmYwAPJzv5CZsnA... --txt "My project"

# Resolve a name (CLI)
verimutfs vns resolve myproject.vfs

# Via HTTP API
curl http://localhost:3001/api/vns/resolve/myproject.vfs
```

### VNS Features
- ✅ First-come-first-served registration
- ✅ Proof-of-Work anti-spam (3 leading zeros, ~4k attempts)
- ✅ Ed25519 signatures for all registrations
- ✅ Automatic P2P sync via gossipsub
- ✅ Last-Write-Wins conflict resolution
- ✅ 1-year name expiration with renewal
- ✅ Record types: A, AAAA, TXT, FS (IPFS CID), SYNC
- ✅ HTTP API + CLI commands

**📖 Full Documentation**: See [VNS_PHASE2.md](./VNS_PHASE2.md) for complete guide

### VNS CLI Commands

```bash
verimutfs vns register <name>     # Register a .vfs name
verimutfs vns resolve <name>      # Resolve name to records  
verimutfs vns transfer <name>     # Transfer ownership
verimutfs vns query <owner>       # Query names by owner
```

### VNS API Endpoints

```
POST   /api/vns/register          # Register new name
GET    /api/vns/resolve/:name     # Resolve name
POST   /api/vns/transfer/:name    # Transfer ownership
GET    /api/vns/query?owner=...   # Query by owner
GET    /api/vns/status            # VNS system status
```

```

## 🛠️ Usage

## 🚀 Quick Start

### Basic Usage

```bash

```bash# Install dependencies

# Start with default settingsnpm install

npm start

# Build TypeScript

# Specify custom portnpm run build

npm start -- --port 4001

# Run node

# Connect to specific bootstrap peersnpm start

npm start -- --bootstrap /ip4/104.131.131.82/tcp/4001/p2p/QmBootstrapPeer

# Development mode

# Run with API servernpm run dev

npm start -- --api-port 3001```



# Run without API server## 🔑 Core Features

npm start -- --no-api

### 1. Encrypted Storage

# Publish a profile on startup- AES-256-GCM encryption for all private data

npm start -- --profile ./my-profile.json- Transparent encryption at blockstore level

- Ed25519 signatures for data integrity

# Enable verbose logging

npm start -- --verbose### 2. DHT-Based Indexing

```Multi-dimensional indexes for fast discovery:

- `/index/skill/{hash}` - Skill-based lookup

### Command Line Options- `/index/geo/{geohash}` - Location-based search

- `/index/age/{range}` - Age range filtering

| Option | Description | Default |- `/index/availability/{status}` - Availability status

|--------|-------------|---------|

| `-p, --port <port>` | Listen port (0 for random) | `0` |### 3. Proximity Search

| `-b, --bootstrap <peers...>` | Bootstrap peer multiaddrs | (default peers) |- Geohash-based location encoding

| `--api-port <port>` | HTTP API server port | `3001` |- Radius expansion (query center + 8 neighbors)

| `--no-api` | Disable HTTP API server | false |- Haversine distance calculation

| `--data-dir <path>` | Data storage directory | `./verimut-data` |- Relevance scoring (0-1 scale)

| `--profile <file>` | Profile JSON to publish | none |

| `--verbose` | Enable verbose logging | false |### 4. Access Control

Three-tier security model:

### Environment Variables- **PUBLIC**: DHT-indexed, hashed data

- **PRIVATE**: IPFS-stored, encrypted data

Create a `.env` file in the project root:- **CONVERSATION**: E2E encrypted messages



```envConnection-based permissions:

# Listen port (0 for random)- Profile visibility

LISTEN_PORT=0- Contact information access

- Exact location sharing

# API server port- Messaging permissions

API_PORT=3001

### 5. Profile Protocol

# Bootstrap peers (comma-separated)libp2p stream handler for profile exchange:

BOOTSTRAP_PEERS=/ip4/104.131.131.82/tcp/4001/p2p/QmBootstrap1,/ip4/...- Signature verification

- Permission checking

# Data directory- Selective data filtering

DATA_DIR=./verimut-data- ECDH encryption for private data



# Enable verbose logging## 📚 Usage Examples

VERBOSE=true

```### Initialize Node



## 📝 Creating a Profile```typescript

import { createVerimutNode } from '@vermut/node';

Create a `profile.json` file:

const node = await createVerimutNode({

```json  listenPort: 0,

{  bootstrapPeers: [...]

  "publicProfile": {});

    "peerId": "your-peer-id",```

    "skillHashes": ["hash1", "hash2"],

    "geolocation": {### Create Profile

      "geohash": "u4pruydqqvj",

      "precision": 5```typescript

    },import { DHTIndexer } from '@vermut/node/indexing';

    "ageRange": "30-40",import { CryptoUtils } from '@vermut/node/crypto';

    "availability": "available",

    "rating": 4.8const { publicKey, privateKey } = await CryptoUtils.generateKeyPair();

  },

  "privateProfile": {const profile = {

    "fullName": "John Doe",  publicProfile: {

    "email": "john@example.com",    peerId: node.libp2p.peerId.toString(),

    "phone": "+1234567890",    skillHashes: ['hash1', 'hash2'],

    "skills": [    geolocation: { geohash: 'u4pruydqqvj', precision: 5 },

      {    ageRange: '30-40',

        "name": "Web Development",    availability: 'available'

        "category": "Technology",  },

        "level": "expert",  privateProfile: {

        "yearsExperience": 10    fullName: 'John Doe',

      }    email: 'john@example.com',

    ],    skills: [{ name: 'Web Development', level: 'expert' }],

    "bio": "Experienced web developer",    exactLocation: { lat: 40.7128, lng: -74.0060 }

    "hourlyRate": 100,  }

    "exactLocation": {};

      "lat": 40.7128,

      "lng": -74.0060const indexer = new DHTIndexer(node.libp2p, encryptedBlockstore);

    }await indexer.publishProfile(profile.publicProfile, peerId);

  }```

}

```### Search Nearby



Then start your node with:```typescript

import { QueryEngine } from '@vermut/node/query';

```bash

npm start -- --profile ./profile.jsonconst queryEngine = new QueryEngine(indexer);

```

const results = await queryEngine.searchNearby(

## 🌐 API Endpoints  40.7128,  // latitude

  -74.0060, // longitude

When running with API server enabled (default), you can interact via HTTP:  10,       // radius in km

  ['web development', 'react']

### Health Check);

```bash

GET http://localhost:3001/healthconsole.log('Found:', results.length, 'providers');

``````



### Search Nearby Providers### Send Connection Request

```bash

POST http://localhost:3001/api/search```typescript

Content-Type: application/jsonimport { AccessControlManager } from '@vermut/node/access';



{const accessControl = new AccessControlManager(

  "latitude": 40.7128,  node.libp2p.peerId.toString(),

  "longitude": -74.0060,  privateKey

  "radiusKm": 10,);

  "skills": ["web development"]

}const request = await accessControl.createConnectionRequest(

```  targetPeerId,

  'Hi, I need help with React development'

### Get Your Profile);

```bash

GET http://localhost:3001/api/profile/me// Target peer approves

```await accessControl.approveConnection(request.requestId);

```

### Create/Update Profile

```bash## 🔐 Security Features

POST http://localhost:3001/api/profile/me

Content-Type: application/json### Geohashing

- Precision levels: 3 (city), 5 (neighborhood), 7 (street)

{- Privacy-preserving location encoding

  "publicProfile": { ... },- No exact coordinates leaked to network

  "privateProfile": { ... }

}### Encryption

```- AES-256-GCM for symmetric encryption

- Ed25519 for digital signatures

## 🔐 Security & Privacy- ECDH for key exchange

- SHA-256 for hashing

### Three-Tier Security Model

### DHT Protection

1. **PUBLIC** (DHT-indexed, hashed)- Hashed index keys prevent enumeration

   - Skill hashes (SHA-256)- Periodic republishing (1-hour TTL)

   - Geohash (city/neighborhood level)- Client-side filtering for sensitive queries

   - Age range, availability

## 🧪 Testing

2. **PRIVATE** (IPFS encrypted)

   - Full name, email, phone```bash

   - Detailed skills, portfolio# Run all tests

   - Hourly rate, reviewsnpm test



3. **CONVERSATION** (E2E encrypted)# Watch mode

   - Direct messagesnpm run test:watch

   - Exact location (after connection approval)

# Run example demo

### Privacy Featuresnpm run dev -- examples/query-system-demo.ts

- **Geohashing**: Your exact location is never shared - only approximate grid cells```

- **AES-256-GCM Encryption**: All private data encrypted at rest

- **Hashed DHT Keys**: Prevents skill/user enumeration## 📦 Module Exports

- **Connection-Based Access**: Explicit approval required for sensitive data

```typescript

## 🏗️ Architecture// Crypto utilities

export { CryptoUtils } from './crypto/crypto-utils';

```

VerimutFS Node// Storage

├── CLI Interface (cli.ts)export { EncryptedBlockstore } from './storage/encrypted-blockstore';

├── Node Manager (node-manager.ts)

├── Configuration (config.ts)// Indexing

└── Core Modulesexport { DHTIndexer } from './indexing/dht-index';

    ├── Crypto Utils (crypto/)

    ├── DHT Indexer (indexing/)// Query

    ├── Query Engine (query/)export { QueryEngine } from './query/query-engine';

    ├── Access Control (access/)

    ├── Profile Protocol (protocols/)// Access control

    └── Encrypted Storage (storage/)export { AccessControlManager } from './access/access-control';

```

// Protocols

## 🔧 Developmentexport { ProfileProtocolHandler } from './protocols/profile-protocol';



### Prerequisites// Types

- Node.js 18+export * from './types/profile-schema';

- npm 8+```



### Build from Source## 🔧 Configuration



```bashTypeScript compiler options in `tsconfig.json`:

# Install dependencies- Target: ES2022

npm install- Module: ESNext

- Strict mode enabled

# Build TypeScript- Declaration files generated

npm run build

## 📖 Further Reading

# Run in development mode

npm run dev- [Query System Documentation](../docs/QUERY_SYSTEM.md)

- [Integration Guide](../docs/INTEGRATION_GUIDE.md)

# Run tests- [Build Summary](../docs/BUILD_SUMMARY.md)

npm test

# Lint code
npm run lint
```

### Project Structure

```
verimutfs-node/
├── src/
│   ├── cli.ts              # CLI entry point
│   ├── config.ts           # Configuration management
│   ├── node-manager.ts     # Node lifecycle manager
│   ├── crypto/             # Cryptography utilities
│   ├── storage/            # Encrypted blockstore
│   ├── indexing/           # DHT indexing
│   ├── query/              # Search engine
│   ├── access/             # Access control
│   ├── protocols/          # libp2p protocols
│   └── types/              # TypeScript types
├── examples/               # Usage examples
├── tests/                  # Unit tests
├── package.json
├── tsconfig.json
└── README.md
```

## 📊 Monitoring Your Node

Once running, your node will display:

```
✅ Node started successfully!

📊 Node Information:
   Peer ID: 12D3KooWABC123...
   Listen Addresses: /ip4/192.168.1.100/tcp/4001/p2p/12D3KooW...
   API Server: http://localhost:3001
   Data Directory: ./verimut-data
   Bootstrap Peers: 3 configured

🌐 VerimutFS Node is running!
📡 Connected to 5 peers
```

## 🤝 Contributing

We welcome contributions! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details

## 🙏 Acknowledgments

- **libp2p** - Modular P2P networking
- **Helia/IPFS** - Distributed file system
- **OrbitDB** - Decentralized database

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/udene01/verimutfs-node/issues)
- **Discussions**: [GitHub Discussions](https://github.com/udene01/verimutfs-node/discussions)
- **Email**: support@verimut.com

## 🗺️ Roadmap

- [x] Core P2P networking
- [x] Encrypted profile storage
- [x] Proximity-based search
- [x] DHT indexing
- [x] Access control system
- [ ] Mobile node support
- [ ] Enhanced privacy (PIR queries)
- [ ] Sharding for scalability
- [ ] Web interface dashboard
- [ ] Blockchain integration

---

**Built with ❤️ by the Verimut Community**

**Join the network and help build a decentralized future!** 🚀

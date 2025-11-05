# Testing Guide for Friends 🚀

Welcome! You've been invited to test VerimutFS before we go public. This guide will get you up and running.

## What is VerimutFS?

A decentralized skill-sharing network with a built-in **Verimut Name Service (VNS)** - think DNS for the distributed web, but cryptographically secured with Ed25519 signatures and proof-of-work.

## Quick Test (Recommended)

The fastest way to verify everything works is to run our Docker E2E tests:

### Requirements
- **Docker Desktop** installed ([download here](https://www.docker.com/))
- **10 minutes** of your time

### Steps

1. **Clone the repo:**
   ```bash
   git clone https://github.com/Udene1/Verimutfs.git
   cd Verimutfs
   ```

2. **Run the tests:**
   
   **Windows (PowerShell):**
   ```powershell
   .\run-tests.ps1
   ```
   
   **Mac/Linux:**
   ```bash
   docker compose down -v
   docker compose up --build --abort-on-container-exit
   ```

3. **Wait for the magic:**
   - Docker will build 3 nodes
   - Tests will run automatically
   - You should see: `Success Rate: 100.0%` (8/8 tests passing)

### What's Being Tested?

The test suite verifies:
- ✅ **Name Registration**: Register `e2etest.vfs` on Node1
- ✅ **Multi-Node Sync**: Name propagates to Node2 and Node3 via HTTP-based P2P
- ✅ **Signature Validation**: Ed25519 cryptographic signatures work correctly
- ✅ **Proof-of-Work**: PoW validation (SHA256, 3 leading zeros)
- ✅ **Conflict Resolution**: Last-Write-Wins (LWW) for concurrent updates
- ✅ **Consistency**: Merkle roots match across all nodes
- ✅ **Persistence**: Entries survive node restarts

## Single Node Test (Manual)

Want to run a single node manually? Here's how:

### 1. Install Dependencies
```bash
npm install
npm run build
```

### 2. Start Node with VNS
```bash
# Set environment variable to enable VNS
export ENABLE_VNS=true    # Mac/Linux
$env:ENABLE_VNS="true"    # Windows PowerShell

npm start
```

### 3. Verify VNS is Running
Open a browser and visit:
```
http://localhost:3001/api/vns/status
```

You should see:
```json
{
  "enabled": true,
  "entries": 4,
  "merkleRoot": "eb843f04ad2455ca859bf0fd7974ee1a48d7fc0f98eae0ed7299bf45811cd4ef"
}
```

### 4. Register a Name

Create a file `register-test.json`:
```json
{
  "name": "myname.vfs",
  "owner": "your-peer-id-here",
  "records": [
    { "type": "A", "value": "192.168.1.100", "ttl": 3600 },
    { "type": "TXT", "value": "My First VNS Entry", "ttl": 3600 }
  ],
  "timestamp": 1699564800000,
  "expires": 1731187200000,
  "nonce": "00000abc",
  "signature": "base64-signature-here",
  "publicKey": "base64-ed25519-public-key-here"
}
```

**Important:** You need to:
1. Compute valid proof-of-work (nonce with 3 leading zeros)
2. Sign with Ed25519 private key
3. Use canonical JSON format

**Easier way:** Use the E2E test code as a reference (`tests/e2e/vns-multinode.test.js`)

Register via API:
```bash
curl -X POST http://localhost:3001/api/vns/register \
  -H "Content-Type: application/json" \
  -d @register-test.json
```

### 5. Resolve a Name
```bash
curl http://localhost:3001/api/vns/resolve/myname.vfs
```

## What to Look For

### ✅ Success Indicators
- Tests pass with `Success Rate: 100.0%`
- Logs show `[HTTP-P2P] Successfully pushed delta to ...`
- Merkle roots match across all 3 nodes
- Names registered on Node1 appear on Node2 and Node3 within 10 seconds

### ❌ Potential Issues

**Docker not starting:**
- Make sure Docker Desktop is running
- Check for port conflicts (3001, 3002, 3003)

**Tests failing:**
- Check Docker logs: `docker compose logs vns-node1`
- Verify network connectivity: `docker network inspect verimutfs_vns-network`

**HTTP-P2P not syncing:**
- Check `HTTP_BOOTSTRAP_PEERS` in `docker-compose.yml`
- Verify nodes can reach each other's API endpoints

## Known Limitations

1. **libp2p 0.45.0 Limitation**: 
   - Cannot create custom libp2p components due to logger architecture
   - Workaround: HTTP-based P2P for VNS delta propagation
   - Future: Refactor to HTTP transport factory with proper logger injection

2. **Single-Node Pubsub**:
   - LocalPubsub shim used for single-node operation
   - Multi-node sync relies on HTTP POST to bootstrap peers
   - Real gossipsub will be enabled once libp2p issue is resolved

3. **Bootstrap Peers**:
   - Currently configured via environment variable `HTTP_BOOTSTRAP_PEERS`
   - Must be comma-separated URLs (e.g., `http://node1:3001,http://node2:3001`)

## Providing Feedback

After testing, please share:

1. **Did the tests pass?** (100% success rate expected)
2. **Any errors or warnings?** (check Docker logs)
3. **Performance observations** (registration time, sync latency)
4. **Feature requests or bugs** (open GitHub issues)

### How to Share Logs

**Get test output:**
```bash
docker compose logs > test-logs.txt
```

**Get specific node logs:**
```bash
docker compose logs vns-node1 > node1.log
docker compose logs vns-node2 > node2.log
docker compose logs vns-node3 > node3.log
```

Send logs via:
- **GitHub Issues**: [github.com/Udene1/Verimutfs/issues](https://github.com/Udene1/Verimutfs/issues)
- **Discord**: [Join our Discord](#) (link TBD)
- **Email**: your-email@example.com (update this!)

## Architecture Overview (For the Curious)

### VNS Components

1. **NamespaceStore** (`src/vns/namespace-store.ts`)
   - Stores VNS entries in-memory + blockstore persistence
   - Validates signatures (Ed25519), PoW (SHA256), rate limits
   - Handles LWW conflict resolution
   - Expiry sweep every hour

2. **Security** (`src/vns/security.ts`)
   - Ed25519 signature validation
   - Proof-of-work verification (3 leading zeros)
   - Rate limiting (5 registrations/hour per owner)

3. **VerimutSync** (`src/sync.ts`)
   - Publishes VNS deltas to other nodes
   - Detects pubsub shim → falls back to HTTP POST
   - Uses `HTTP_BOOTSTRAP_PEERS` for multi-node sync

4. **HTTP API** (`src/api/http-server.ts`)
   - `/api/vns/register`: Register new name
   - `/api/vns/resolve/:name`: Resolve name to records
   - `/api/vns/status`: Get VNS status
   - `/api/vns/push-delta`: Receive deltas from other nodes (HTTP-P2P)

### Data Flow

```
Node1: Register "test.vfs"
  ↓
NamespaceStore validates & stores
  ↓
VerimutSync.publishVNSDelta()
  ↓
Detect LocalPubsub shim → HTTP fallback
  ↓
HTTP POST to HTTP_BOOTSTRAP_PEERS
  ↓
Node2 & Node3: Receive at /api/vns/push-delta
  ↓
NamespaceStore.applyDelta() validates & applies
  ↓
"test.vfs" now available on all 3 nodes ✅
```

## Next Steps After Testing

If tests pass and you're happy:

1. **Star the repo** ⭐ (optional but appreciated!)
2. **Share with friends** who might want to test
3. **Open issues** for any bugs or feature ideas
4. **Stay tuned** for public launch announcement

## Questions?

- **GitHub Issues**: [github.com/Udene1/Verimutfs/issues](https://github.com/Udene1/Verimutfs/issues)
- **Documentation**: See `QUICKSTART.md`, `VNS_PHASE3.md`, `tests/e2e/README.md`
- **Code walkthrough**: `tests/e2e/IMPLEMENTATION_SUMMARY.md`

---

**Thanks for testing! Your feedback helps make VerimutFS better for everyone! 🙏**

---

Built with ❤️ by the VerimutFS team

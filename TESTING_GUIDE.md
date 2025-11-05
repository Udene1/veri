# Testing Guide for Friends 🚀

Welcome! You've been invited to help test VerimutFS before public launch. Your role is simple: **join the network and help us see how resilient it is**.

## What is VerimutFS?

A decentralized skill-sharing network with a built-in **Verimut Name Service (VNS)** - think DNS for the distributed web, but cryptographically secured with Ed25519 signatures and proof-of-work.

## What We Need From You

**Simple:** Just run a node and keep it online for a while! We want to test:
- Network resilience with real peers
- How the skill/service provider website works with multiple nodes
- P2P connectivity across different network conditions
- VNS synchronization in a real-world scenario

## How to Join the Network

### Requirements
- **Node.js 18+** installed ([download here](https://nodejs.org/))
- **20 minutes** for setup
- **Keep your node running** for as long as comfortable (hours or days appreciated!)

### Steps to Join

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Udene1/Verimutfs.git
   cd Verimutfs
   ```

2. **Install dependencies:**
   ```bash
   npm install
   npm run build
   ```
   *(This takes 2-3 minutes)*

3. **Get the bootstrap peer list:**
   I'll provide you with a list of HTTP bootstrap peers. Set this environment variable:
   
   **Windows (PowerShell):**
   ```powershell
   $env:ENABLE_VNS="true"
   $env:HTTP_BOOTSTRAP_PEERS="http://peer1.example.com:3001,http://peer2.example.com:3001"
   npm start
   ```
   
   **Mac/Linux:**
   ```bash
   export ENABLE_VNS=true
   export HTTP_BOOTSTRAP_PEERS="http://peer1.example.com:3001,http://peer2.example.com:3001"
   npm start
   ```
   
   *Replace the URLs with the actual bootstrap peers I provide*

4. **Verify your node is running:**
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

5. **Keep it running!**
   - Leave your node running as long as comfortable (hours/days appreciated)
   - Watch the terminal - you'll see sync activity and delta propagation
   - Your node will automatically sync VNS entries from other nodes

## Advanced: Docker Multi-Node Testing (Optional)

If you want to see the full system in action locally, you can run our Docker E2E tests:

**Windows (PowerShell):**
```powershell
.\run-tests.ps1
```

**Mac/Linux:**
```bash
docker compose down -v
docker compose up --build --abort-on-container-exit
```

Expected result: `Success Rate: 100.0%` (8/8 tests passing)

This spins up 3 nodes locally and tests all VNS features. See the Docker test logs in the repo for transparency on how the system works

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

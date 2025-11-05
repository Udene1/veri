# VNS Multi-Node E2E Integration Tests

End-to-end integration tests for VNS (Verimut Name Service) in a multi-node environment.

## Setup

These tests use Docker Compose to create a 3-node VNS network:
- **Node1**: Bootstrap peer at `172.25.0.10:4001` (API on port 3001)
- **Node2**: Peer at `172.25.0.11:4001` (API on port 3002)
- **Node3**: Peer at `172.25.0.12:4001` (API on port 3003)
- **Test Runner**: Executes tests via HTTP API calls

## Prerequisites

- Docker Desktop or Docker Engine
- Docker Compose
- VS Code Docker extension (optional, but recommended)

## Running Tests

### Option 1: Using Docker Compose (Command Line)

```bash
# Build and run all services
docker-compose up --build

# Run in detached mode
docker-compose up -d --build

# View test logs
docker-compose logs e2e-tests

# Stop and cleanup
docker-compose down -v
```

### Option 2: Using VS Code Docker Extension

1. Open VS Code
2. Open the Docker extension (sidebar)
3. Right-click on `docker-compose.yml`
4. Select **"Compose Up"**
5. View logs in the integrated terminal
6. Right-click to **"Compose Down"** when finished

### Option 3: Run Tests Only (After Nodes Are Running)

```bash
# Start nodes in background
docker-compose up -d vns-node1 vns-node2 vns-node3

# Run tests
docker-compose run --rm e2e-tests

# Cleanup
docker-compose down -v
```

## Test Coverage

The E2E test suite (`vns-multinode.test.js`) validates:

### ✅ Test 1: Node Initialization
- Verifies all 3 nodes start successfully
- Checks VNS is enabled on each node
- Displays initial entry counts

### ✅ Test 2: Name Registration
- Registers a test name on Node1
- Validates PoW computation (3 leading zeros)
- Verifies registration success via API

### ✅ Test 3: Sync Propagation Wait
- Waits 10 seconds for gossipsub propagation
- Allows delta broadcast to reach all peers

### ✅ Test 4-5: Name Resolution Across Nodes
- Resolves the registered name on Node2
- Resolves the registered name on Node3
- Confirms sync worked within 10 seconds

### ✅ Test 6: Merkle Root Consistency
- Fetches merkle roots from all 3 nodes
- Verifies they match exactly
- Confirms namespace integrity

### ✅ Test 7: LWW Conflict Resolution
- Registers same name on Node1 with timestamp T
- Registers same name on Node2 with timestamp T+1000
- Verifies later registration wins (Last-Write-Wins)
- Confirms conflict resolution propagates

### ✅ Test 8: Entry Count Consistency
- Compares entry counts across all nodes
- Flags discrepancies (with leniency for timing)

## Expected Output

```
🧪 Starting VNS Multi-Node E2E Tests...

⏳ Waiting for nodes to initialize...

📋 Test 1: Verify all nodes are running
✅ All nodes running with VNS enabled
   Node1: 0 entries
   Node2: 0 entries
   Node3: 0 entries

📋 Test 2: Register name on Node1
✅ Registered e2etest.vfs on Node1
   CID: bafybeiabc123...

📋 Test 3: Wait for sync propagation (10 seconds)
✅ Wait completed

📋 Test 4: Verify name synced to Node2
✅ Name found on Node2
   Owner: test-peer-12345
   Records: 2

📋 Test 5: Verify name synced to Node3
✅ Name found on Node3
   Owner: test-peer-12345
   Records: 2

📋 Test 6: Verify merkle root consistency across nodes
   Node1 merkleRoot: abc123...
   Node2 merkleRoot: abc123...
   Node3 merkleRoot: abc123...
✅ Merkle roots consistent across all nodes

📋 Test 7: Test LWW conflict resolution
   ✓ First registration on Node1
   ✓ Second registration on Node2 (later timestamp)
✅ LWW worked: Later registration won
   Winner: owner-2

📋 Test 8: Verify entry counts across nodes
   Node1: 2 entries
   Node2: 2 entries
   Node3: 2 entries
✅ Entry counts match across all nodes

============================================================
📊 Test Results Summary
============================================================
✅ Passed: 8
❌ Failed: 0
📈 Success Rate: 100.0%
============================================================
```

## Troubleshooting

### Nodes won't connect to bootstrap peer
- Check `docker-compose.yml` has correct `BOOTSTRAP_PEERS` env var
- Verify network subnet `172.25.0.0/16` doesn't conflict
- Check firewall allows Docker internal networking

### Tests timeout waiting for sync
- Increase wait time in Test 3 (currently 10s)
- Check gossipsub configuration in `src/networking/peer.ts`
- Verify all nodes are subscribed to VNS topic

### Merkle roots don't match
- May indicate delta propagation failure
- Check logs for dropped messages
- Verify signature validation isn't rejecting deltas

### Rate limiting errors
- VNS rate limits: 5 registrations per hour per peer
- Wait 1 hour or restart nodes to reset counters
- Reduce test registrations if hitting limit

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   vns-node1     │     │   vns-node2     │     │   vns-node3     │
│  172.25.0.10    │────▶│  172.25.0.11    │────▶│  172.25.0.12    │
│  API: 3001      │     │  API: 3001      │     │  API: 3001      │
│  (bootstrap)    │◀────│  (peer)         │◀────│  (peer)         │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                       │                       │
         └───────────────────────┴───────────────────────┘
                                 │
                      ┌──────────▼──────────┐
                      │    e2e-tests        │
                      │  (test runner)      │
                      │  HTTP API calls     │
                      └─────────────────────┘
```

## Cleanup

Remove all containers, networks, and volumes:

```bash
docker-compose down -v
```

Remove built images:

```bash
docker rmi verimutfs-vns-node1 verimutfs-vns-node2 verimutfs-vns-node3 verimutfs-e2e-tests
```

## Integration with CI/CD

To run these tests in CI pipelines:

```yaml
# .github/workflows/e2e-tests.yml
name: E2E Tests

on: [push, pull_request]

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run E2E tests
        run: docker-compose up --build --abort-on-container-exit
      - name: Cleanup
        run: docker-compose down -v
```

## Next Steps

- Add tests for transfer operations (requires multisig in future)
- Test expiry propagation (register with short TTL)
- Test offline node catch-up (stop node, register, restart, verify sync)
- Test delta queue replay (simulate network partition)
- Performance benchmarks (100+ names, measure propagation time)

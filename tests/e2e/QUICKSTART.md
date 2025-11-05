# Running VNS Multi-Node E2E Tests

Quick guide for running the VNS integration tests using VSCode Docker extension.

## Quick Start (VSCode Docker Extension)

Since you have the Docker extension installed in VSCode, follow these steps:

### 1. Open Docker Extension
- Click the Docker icon in VSCode sidebar (whale logo)
- You should see the Docker extension panel

### 2. Start the Test Environment

**Option A: Using Docker Compose View**
1. In Docker extension, look for **"Compose"** section
2. Find `docker-compose.yml` in the list
3. Right-click on it
4. Select **"Compose Up"**
5. Watch the logs in the integrated terminal

**Option B: Using Context Menu**
1. In VSCode Explorer, find `docker-compose.yml`
2. Right-click on the file
3. Select **"Docker: Compose Up"**

### 3. Monitor Test Execution

The test output will appear in the VSCode terminal. You should see:

```
🧪 Starting VNS Multi-Node E2E Tests...

⏳ Waiting for nodes to initialize...

📋 Test 1: Verify all nodes are running
✅ All nodes running with VNS enabled

... (more tests)

============================================================
📊 Test Results Summary
============================================================
✅ Passed: 8
❌ Failed: 0
📈 Success Rate: 100.0%
============================================================
```

### 4. Cleanup

After tests complete:
1. Right-click on `docker-compose.yml` in Docker extension
2. Select **"Compose Down"**
3. This stops and removes all containers

## Alternative: Using VSCode Terminal

If you prefer using the integrated terminal:

```powershell
# Build and run (PowerShell)
docker-compose up --build

# Or run in background
docker-compose up -d --build

# View test logs
docker-compose logs -f e2e-tests

# Stop everything
docker-compose down -v
```

## What Gets Tested?

1. ✅ **Node Initialization** - All 3 nodes start with VNS enabled
2. ✅ **Name Registration** - Register on Node1
3. ✅ **Sync Propagation** - Wait 10s for gossipsub
4. ✅ **Cross-Node Resolution** - Verify on Node2 and Node3
5. ✅ **Merkle Consistency** - Check merkle roots match
6. ✅ **Conflict Resolution** - Test Last-Write-Wins (LWW)
7. ✅ **Entry Counts** - Verify all nodes have same count

## Expected Timeline

- **Startup**: ~5 seconds (nodes initialize)
- **Registration**: ~1 second (PoW + validation)
- **Sync wait**: 10 seconds (gossipsub propagation)
- **Resolution tests**: ~2 seconds
- **Conflict test**: ~7 seconds
- **Total**: ~25-30 seconds

## Troubleshooting

### "Docker daemon not running"
- Open Docker Desktop
- Wait for it to fully start
- Try again

### Tests timeout
- First run may be slow (building images)
- Subsequent runs are faster (cached layers)
- Check Docker Desktop has enough resources:
  - Memory: At least 4GB
  - CPU: At least 2 cores

### Ports already in use
If ports 3001-3003 are taken:
1. Edit `docker-compose.yml`
2. Change port mappings:
   ```yaml
   ports:
     - "3001:3001"  # Change to "4001:3001" etc
   ```

### Tests fail with "Name not found"
- Network propagation may need more time
- Edit `tests/e2e/vns-multinode.test.js`
- Increase wait time in Test 3 from 10000 to 15000ms

## Viewing Individual Node Logs

In VSCode Docker extension:
1. Expand **"Containers"** section
2. Find containers starting with `verimutfs-`
3. Right-click on a container
4. Select **"View Logs"**

You'll see:
- libp2p peer connections
- VNS delta propagations
- HTTP API requests
- Namespace updates

## Manual Testing via HTTP

If you want to test manually while nodes are running:

```powershell
# Register a name (PowerShell)
Invoke-WebRequest -Uri "http://localhost:3001/api/vns/register" `
  -Method POST `
  -ContentType "application/json" `
  -Body '{"name":"test.vfs","owner":"me","records":[],"timestamp":1234567890,"expires":9999999999999,"nonce":12345,"signature":"sig","publicKey":"key"}'

# Resolve a name
Invoke-WebRequest -Uri "http://localhost:3001/api/vns/resolve/test.vfs"

# Check status
Invoke-WebRequest -Uri "http://localhost:3001/api/vns/status"
```

## Files Created

- `Dockerfile` - VNS node image
- `docker-compose.yml` - 3-node network + test runner
- `Dockerfile.test` - Test runner image
- `tests/e2e/vns-multinode.test.js` - Test suite
- `tests/e2e/README.md` - Full documentation
- `tests/e2e/QUICKSTART.md` - This file

## Next Steps After Tests Pass

1. Commit the Docker setup:
   ```bash
   git add Dockerfile docker-compose.yml Dockerfile.test tests/e2e/
   git commit -m "feat(vns): Add multi-node E2E integration tests with Docker"
   ```

2. Push to Phase 3 branch:
   ```bash
   git push origin feature/vns-phase3
   ```

3. Ready for Phase 3 merge to main!

## Support

For issues, check:
- `tests/e2e/README.md` - Full documentation
- `VNS_PHASE3.md` - Architecture details
- Docker extension logs in VSCode
- Container logs: `docker-compose logs <service-name>`

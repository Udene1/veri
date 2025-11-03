# Quick Test Guide for VerimutFS

## Test 1: Start the Node

Open PowerShell and run:

```powershell
cd C:\Users\HP\vermut\verimutfs
npm start
```

**Expected Output:**
- ASCII banner
- "🚀 Starting VerimutFS Node..."
- "✅ Node started!"
- "Peer ID: QmXXXXXXX..."
- "Listening on: [list of multiaddrs]"
- "HTTP API running on: http://localhost:3001"

**If you see errors:**
1. Check that `node_modules` exists (`Test-Path node_modules`)
2. If not: `npm install`
3. Rebuild: `npm run build`
4. Try again: `npm start`

## Test 2: Check API Endpoints

While node is running, open another PowerShell:

```powershell
# Check node status
curl http://localhost:3001/api/status

# Should return:
# {"status":"running","peerId":"QmXXX...","peers":0}
```

## Test 3: Start the Frontend

In another PowerShell:

```powershell
cd C:\users\hp\verimut
npm install
npm start
```

Frontend should open at http://localhost:3000

## Test 4: Connect Frontend to Node

1. Frontend starts at `http://localhost:3000`
2. It should automatically connect to node at `http://localhost:3001`
3. Check browser console for connection messages

## Test 5: Start Multiple Nodes (Test P2P)

### Node 1 (Bootstrap):
```powershell
cd C:\Users\HP\vermut\verimutfs
npm start -- --port 4001
```

Copy the peer ID and multiaddr from the output (looks like `/ip4/127.0.0.1/tcp/4001/p2p/QmXXX...`)

### Node 2:
```powershell
cd C:\Users\HP\verimutfs  # Note: external copy
npm start -- --port 4002 --bootstrap /ip4/127.0.0.1/tcp/4001/p2p/QmXXX...
```

Replace `QmXXX...` with the actual peer ID from Node 1.

**Expected:**
- Node 2 should connect to Node 1
- Both nodes show "Connected peers: 1"

## Troubleshooting

### "Cannot find module"
```powershell
cd C:\Users\HP\vermut\verimutfs
npm install
npm run build
```

### "Port already in use"
```powershell
# Use a different port
npm start -- --port 4002
```

### "Failed to start node"
Check the error message. Common issues:
- Missing dependencies: `npm install`
- Not built: `npm run build`
- Wrong directory: Make sure you're in `verimutfs` folder

## Success Criteria

✅ Node starts without errors  
✅ Shows peer ID and listening addresses  
✅ API responds at http://localhost:3001/api/status  
✅ Frontend can connect to node  
✅ Multiple nodes can connect to each other  

## Next Steps After Testing

1. If all tests pass, ready to push to GitHub
2. Update README with actual bootstrap peer addresses
3. Create GitHub release
4. Share with early testers

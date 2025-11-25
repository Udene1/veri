#!/bin/bash
# Simple .env configuration for VerimutFS nodes
# Run this on each deployed node to easily configure .env

cat > .env <<'EOF'
# =================================================================
# VerimutFS Node Configuration  
# Edit with: nano .env
# =================================================================

# ---------------------------------------------------------------
# BOOTSTRAP NODE MODE
# ---------------------------------------------------------------
BOOTSTRAP_MODE=true
BOOTSTRAP_PUBLIC_URL=http://34.136.60.140:3001
IS_GENESIS_BOOTSTRAP=true

# ---------------------------------------------------------------
# API & VNS
# ---------------------------------------------------------------
API_PORT=3001
ENABLE_VNS=true

# ---------------------------------------------------------------  
# P2P NETWORKING
# Leave empty for genesis node, add other bootstrap IPs for relays
# ---------------------------------------------------------------
HTTP_BOOTSTRAP_PEERS=

# ---------------------------------------------------------------
# GAS RELAYER (Add your private key!)
# ---------------------------------------------------------------
RELAYER_PRIVATE_KEY=

# ---------------------------------------------------------------
# BLOCKCHAIN
# ---------------------------------------------------------------
DEFAULT_NETWORK=polygonAmoy
POLYGON_AMOY_RPC_URL=https://rpc-amoy.polygon.technology
POLYGON_AMOY_GASLESS_CONTRACT=0x4960ed90f6c2821305128485fDa366DD486813e

# ---------------------------------------------------------------
# STORAGE
#---------------------------------------------------------------
DATA_DIR=./verimut-data
VERBOSE=true
EOF

echo "✅ .env file created!"
echo ""
echo "⚠️  IMPORTANT: Edit the .env file and add your RELAYER_PRIVATE_KEY"
echo ""
echo "Edit with: nano .env"

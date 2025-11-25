# Manual Deployment Commands for 5 VerimutFS Nodes
# Copy and paste these commands one by one

# ============================================================================
# STEP 1: Create Firewall Rule (Run Once)
# ============================================================================

gcloud compute firewall-rules create verimut-allow-api \
  --allow=tcp:3001 \
  --description="Allow VerimutFS API traffic" \
  --direction=INGRESS \
  --target-tags=verimut-node

# ============================================================================
# STEP 2: Create Node 1 - US (Iowa)
# ============================================================================

gcloud compute instances create verimut-us \
  --zone=us-central1-a \
  --machine-type=e2-medium \
  --boot-disk-size=20GB \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --tags=verimut-node \
  --metadata=enable-oslogin=TRUE

# SSH into US node
gcloud compute ssh verimut-us --zone=us-central1-a

# Run these commands INSIDE the US node:
sudo apt-get update
sudo apt-get install -y curl git
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo bash -
sudo apt-get install -y nodejs

# Create verimut user and setup
sudo useradd -m -s /bin/bash verimut
cd /home/verimut
sudo -u verimut git clone https://github.com/Udene1/veri.git verimutfs
cd verimutfs
sudo -u verimut npm install
sudo -u verimut npm run build

# Create .env file
sudo tee /home/verimut/verimutfs/.env > /dev/null <<EOF
NODE_ENV=production
API_PORT=3001
BOOTSTRAP_MODE=true
BOOTSTRAP_PEERS=
RELAYER_PRIVATE_KEY=YOUR_PRIVATE_KEY_HERE
MIN_RELAYER_BALANCE=0.1
DEFAULT_NETWORK=polygon-amoy
POLYGON_RPC_URL=https://rpc-amoy.polygon.technology
POLYGON_GASLESS_CONTRACT=0x4960ed90f6c2821305128485fDa366DD486813e
EOF

sudo chown verimut:verimut /home/verimut/verimutfs/.env

# Create systemd service
sudo tee /etc/systemd/system/verimutfs.service > /dev/null <<EOF
[Unit]
Description=VerimutFS Relay Node
After=network.target

[Service]
Type=simple
User=verimut
WorkingDirectory=/home/verimut/verimutfs
ExecStart=/usr/bin/node dist/cli.js start --bootstrap
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# Enable and start service
sudo systemctl daemon-reload
sudo systemctl enable verimutfs
sudo systemctl start verimutfs
sudo systemctl status verimutfs

# Exit the VM
exit

# ============================================================================
# STEP 3: Create Node 2 - Asia (Singapore)
# ============================================================================

gcloud compute instances create verimut-asia \
  --zone=asia-southeast1-a \
  --machine-type=e2-medium \
  --boot-disk-size=20GB \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --tags=verimut-node \
  --metadata=enable-oslogin=TRUE

# SSH into Asia node
gcloud compute ssh verimut-asia --zone=asia-southeast1-a

# Run these commands INSIDE the Asia node:
sudo apt-get update
sudo apt-get install -y curl git
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo bash -
sudo apt-get install -y nodejs

sudo useradd -m -s /bin/bash verimut
cd /home/verimut
sudo -u verimut git clone https://github.com/Udene1/veri.git verimutfs
cd verimutfs
sudo -u verimut npm install
sudo -u verimut npm run build

sudo tee /home/verimut/verimutfs/.env > /dev/null <<EOF
NODE_ENV=production
API_PORT=3001
BOOTSTRAP_MODE=true
BOOTSTRAP_PEERS=
RELAYER_PRIVATE_KEY=YOUR_PRIVATE_KEY_HERE
MIN_RELAYER_BALANCE=0.1
DEFAULT_NETWORK=polygon-amoy
POLYGON_RPC_URL=https://rpc-amoy.polygon.technology
POLYGON_GASLESS_CONTRACT=0x4960ed90f6c2821305128485fDa366DD486813e
EOF

sudo chown verimut:verimut /home/verimut/verimutfs/.env

sudo tee /etc/systemd/system/verimutfs.service > /dev/null <<EOF
[Unit]
Description=VerimutFS Relay Node
After=network.target

[Service]
Type=simple
User=verimut
WorkingDirectory=/home/verimut/verimutfs
ExecStart=/usr/bin/node dist/cli.js start --bootstrap
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable verimutfs
sudo systemctl start verimutfs
sudo systemctl status verimutfs

exit

# ============================================================================
# STEP 4: Create Node 3 - Europe (Belgium)
# ============================================================================

gcloud compute instances create verimut-europe \
  --zone=europe-west1-b \
  --machine-type=e2-medium \
  --boot-disk-size=20GB \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --tags=verimut-node \
  --metadata=enable-oslogin=TRUE

# SSH into Europe node
gcloud compute ssh verimut-europe --zone=europe-west1-b

# Run these commands INSIDE the Europe node:
sudo apt-get update
sudo apt-get install -y curl git
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo bash -
sudo apt-get install -y nodejs

sudo useradd -m -s /bin/bash verimut
cd /home/verimut
sudo -u verimut git clone https://github.com/Udene1/veri.git verimutfs
cd verimutfs
sudo -u verimut npm install
sudo -u verimut npm run build

sudo tee /home/verimut/verimutfs/.env > /dev/null <<EOF
NODE_ENV=production
API_PORT=3001
BOOTSTRAP_MODE=true
BOOTSTRAP_PEERS=
RELAYER_PRIVATE_KEY=YOUR_PRIVATE_KEY_HERE
MIN_RELAYER_BALANCE=0.1
DEFAULT_NETWORK=polygon-amoy
POLYGON_RPC_URL=https://rpc-amoy.polygon.technology
POLYGON_GASLESS_CONTRACT=0x4960ed90f6c2821305128485fDa366DD486813e
EOF

sudo chown verimut:verimut /home/verimut/verimutfs/.env

sudo tee /etc/systemd/system/verimutfs.service > /dev/null <<EOF
[Unit]
Description=VerimutFS Relay Node
After=network.target

[Service]
Type=simple
User=verimut
WorkingDirectory=/home/verimut/verimutfs
ExecStart=/usr/bin/node dist/cli.js start --bootstrap
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable verimutfs
sudo systemctl start verimutfs
sudo systemctl status verimutfs

exit

# ============================================================================
# STEP 5: Create Node 4 - Africa 1 (Tel Aviv)
# ============================================================================

gcloud compute instances create verimut-africa1 \
  --zone=me-west1-a \
  --machine-type=e2-medium \
  --boot-disk-size=20GB \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --tags=verimut-node \
  --metadata=enable-oslogin=TRUE

# SSH into Africa1 node
gcloud compute ssh verimut-africa1 --zone=me-west1-a

# Run these commands INSIDE the Africa1 node:
sudo apt-get update
sudo apt-get install -y curl git
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo bash -
sudo apt-get install -y nodejs

sudo useradd -m -s /bin/bash verimut
cd /home/verimut
sudo -u verimut git clone https://github.com/Udene1/veri.git verimutfs
cd verimutfs
sudo -u verimut npm install
sudo -u verimut npm run build

sudo tee /home/verimut/verimutfs/.env > /dev/null <<EOF
NODE_ENV=production
API_PORT=3001
BOOTSTRAP_MODE=true
BOOTSTRAP_PEERS=
RELAYER_PRIVATE_KEY=YOUR_PRIVATE_KEY_HERE
MIN_RELAYER_BALANCE=0.1
DEFAULT_NETWORK=polygon-amoy
POLYGON_RPC_URL=https://rpc-amoy.polygon.technology
POLYGON_GASLESS_CONTRACT=0x4960ed90f6c2821305128485fDa366DD486813e
EOF

sudo chown verimut:verimut /home/verimut/verimutfs/.env

sudo tee /etc/systemd/system/verimutfs.service > /dev/null <<EOF
[Unit]
Description=VerimutFS Relay Node
After=network.target

[Service]
Type=simple
User=verimut
WorkingDirectory=/home/verimut/verimutfs
ExecStart=/usr/bin/node dist/cli.js start --bootstrap
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable verimutfs
sudo systemctl start verimutfs
sudo systemctl status verimutfs

exit

# ============================================================================
# STEP 6: Create Node 5 - Africa 2 (Tel Aviv)
# ============================================================================

gcloud compute instances create verimut-africa2 \
  --zone=me-west1-b \
  --machine-type=e2-medium \
  --boot-disk-size=20GB \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --tags=verimut-node \
  --metadata=enable-oslogin=TRUE

# SSH into Africa2 node
gcloud compute ssh verimut-africa2 --zone=me-west1-b

# Run these commands INSIDE the Africa2 node:
sudo apt-get update
sudo apt-get install -y curl git
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo bash -
sudo apt-get install -y nodejs

sudo useradd -m -s /bin/bash verimut
cd /home/verimut
sudo -u verimut git clone https://github.com/Udene1/veri.git verimutfs
cd verimutfs
sudo -u verimut npm install
sudo -u verimut npm run build

sudo tee /home/verimut/verimutfs/.env > /dev/null <<EOF
NODE_ENV=production
API_PORT=3001
BOOTSTRAP_MODE=true
BOOTSTRAP_PEERS=
RELAYER_PRIVATE_KEY=YOUR_PRIVATE_KEY_HERE
MIN_RELAYER_BALANCE=0.1
DEFAULT_NETWORK=polygon-amoy
POLYGON_RPC_URL=https://rpc-amoy.polygon.technology
POLYGON_GASLESS_CONTRACT=0x4960ed90f6c2821305128485fDa366DD486813e
EOF

sudo chown verimut:verimut /home/verimut/verimutfs/.env

sudo tee /etc/systemd/system/verimutfs.service > /dev/null <<EOF
[Unit]
Description=VerimutFS Relay Node
After=network.target

[Service]
Type=simple
User=verimut
WorkingDirectory=/home/verimut/verimutfs
ExecStart=/usr/bin/node dist/cli.js start --bootstrap
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable verimutfs
sudo systemctl start verimutfs
sudo systemctl status verimutfs

exit

# ============================================================================
# STEP 7: Get All Node IPs (Run from your local machine)
# ============================================================================

gcloud compute instances list --filter="name~'verimut-'" \
  --format="table(name,zone,networkInterfaces[0].accessConfigs[0].natIP)"

# ============================================================================
# STEP 8: Update BOOTSTRAP_PEERS on Each Node
# ============================================================================

# SSH into each node and update the BOOTSTRAP_PEERS with all other node IPs
# Example for US node:
gcloud compute ssh verimut-us --zone=us-central1-a
sudo nano /home/verimut/verimutfs/.env
# Add: BOOTSTRAP_PEERS=http://ASIA_IP:3001,http://EUROPE_IP:3001,http://AFRICA1_IP:3001,http://AFRICA2_IP:3001
sudo systemctl restart verimutfs
exit

# Repeat for all other nodes

# ============================================================================
# STEP 9: Verify All Nodes are Running
# ============================================================================

# Check each node
for node in verimut-us verimut-asia verimut-europe verimut-africa1 verimut-africa2; do
  echo "=== $node ==="
  gcloud compute ssh $node --command="sudo systemctl status verimutfs --no-pager -l"
done

# ============================================================================
# QUICK ACCESS COMMANDS
# ============================================================================

# SSH to US node
gcloud compute ssh verimut-us --zone=us-central1-a

# SSH to Asia node
gcloud compute ssh verimut-asia --zone=asia-southeast1-a

# SSH to Europe node
gcloud compute ssh verimut-europe --zone=europe-west1-b

# SSH to Africa1 node
gcloud compute ssh verimut-africa1 --zone=me-west1-a

# SSH to Africa2 node
gcloud compute ssh verimut-africa2 --zone=me-west1-b

# ============================================================================
# CLEANUP (if needed)
# ============================================================================

# Delete all nodes
gcloud compute instances delete verimut-us --zone=us-central1-a --quiet
gcloud compute instances delete verimut-asia --zone=asia-southeast1-a --quiet
gcloud compute instances delete verimut-europe --zone=europe-west1-b --quiet
gcloud compute instances delete verimut-africa1 --zone=me-west1-a --quiet
gcloud compute instances delete verimut-africa2 --zone=me-west1-b --quiet

# Delete firewall rule
gcloud compute firewall-rules delete verimut-allow-api --quiet

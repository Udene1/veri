# Quick Start Guide - VerimutFS Node

Get your Verimut node running in 5 minutes! ⚡

## For Complete Beginners

### Step 1: Install Node.js (if you don't have it)

**Windows:**
1. Visit [nodejs.org](https://nodejs.org/)
2. Download "LTS" version
3. Run installer → Click "Next" until installed
4. Restart your computer

**Mac:**
1. Open Terminal
2. Run: `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`
3. Run: `brew install node`

**Linux:**
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### Step 2: Download This Software

**Option A - Using Git:**
```bash
git clone https://github.com/udene01/verimutfs-node.git
cd verimutfs-node
```

**Option B - Download ZIP:**
1. Click green "Code" button on GitHub
2. Click "Download ZIP"
3. Extract ZIP file
4. Open terminal in that folder

### Step 3: Install & Run

```bash
# Install (takes 2-3 minutes)
npm install

# Build (takes 30 seconds)
npm run build

# Start your node!
npm start
```

That's it! Your node is now running and connected to the Verimut network! 🎉

---

## For Developers

### Super Quick Start

```bash
git clone https://github.com/udene01/verimutfs-node.git
cd verimutfs-node
npm install && npm run build && npm start
```

### With Custom Configuration

```bash
# Copy environment template
cp .env.example .env

# Edit configuration
nano .env

# Start with custom port
npm start -- --port 4001 --api-port 3002
```

### With Profile

```bash
# Copy profile template
cp profile.example.json my-profile.json

# Edit your profile
nano my-profile.json

# Start with profile
npm start -- --profile my-profile.json
```

---

## Common Tasks

### View Your Peer ID
```bash
# After starting, look for:
Peer ID: 12D3KooWABC123...
```

### Check Node Status
```bash
# Open in browser:
http://localhost:3001/health
```

### Search for Providers
```bash
curl -X POST http://localhost:3001/api/search \
  -H "Content-Type: application/json" \
  -d '{
    "latitude": 40.7128,
    "longitude": -74.0060,
    "radiusKm": 10,
    "skills": ["web development"]
  }'
```

### Stop the Node
Press `Ctrl+C` in the terminal

---

## Troubleshooting

### "Command not found"
→ Node.js not installed. Go to Step 1.

### "Port already in use"
→ Another program is using port 3001
```bash
npm start -- --api-port 3002
```

### "npm install" takes forever
→ Normal! Be patient, it's downloading packages.

### Can't connect to peers
→ Check your firewall settings or try:
```bash
npm start -- --bootstrap /ip4/YOUR_BOOTSTRAP_IP/tcp/4001/p2p/QmPeerID
```

---

## Next Steps

✅ **Node is running** - You're part of the network!

**What can you do now?**

1. **Create a Profile**
   - Copy `profile.example.json` to `my-profile.json`
   - Edit with your details
   - Restart with `npm start -- --profile my-profile.json`

2. **Try the API**
   - Visit `http://localhost:3001/health`
   - See README.md for all endpoints

3. **Monitor Your Node**
   - Watch terminal for connection updates
   - Every 30 seconds you'll see peer count

4. **Join the Community**
   - GitHub Discussions
   - Discord server
   - Email: support@verimut.com

---

## Need More Help?

📖 **Detailed docs**: See INSTALL.md  
🐛 **Problems?**: Open an issue on GitHub  
💬 **Questions?**: Join our Discord  
📧 **Email**: support@verimut.com

---

**Welcome to Verimut! You're now running a node and helping build a decentralized future! 🚀**

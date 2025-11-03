# Installation Guide

## System Requirements

- **Operating System**: Windows, macOS, or Linux
- **Node.js**: Version 18.0.0 or higher
- **npm**: Version 8.0.0 or higher
- **RAM**: Minimum 2GB
- **Storage**: Minimum 1GB free space
- **Network**: Stable internet connection

## Installation Steps

### 1. Install Node.js

If you don't have Node.js installed:

**Windows:**
- Download from [nodejs.org](https://nodejs.org/)
- Run the installer
- Verify installation:
  ```cmd
  node --version
  npm --version
  ```

**macOS:**
```bash
# Using Homebrew
brew install node

# Verify installation
node --version
npm --version
```

**Linux:**
```bash
# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
node --version
npm --version
```

### 2. Download VerimutFS Node

**Option A: Clone from GitHub**
```bash
git clone https://github.com/udene01/verimutfs-node.git
cd verimutfs-node
```

**Option B: Download ZIP**
1. Go to https://github.com/udene01/verimutfs-node
2. Click "Code" → "Download ZIP"
3. Extract the ZIP file
4. Open terminal in the extracted folder

### 3. Install Dependencies

```bash
npm install
```

This will download all required packages. It may take a few minutes.

### 4. Configure Your Node

Create a `.env` file from the template:

```bash
# Copy the example file
cp .env.example .env

# Edit the file with your settings
nano .env  # or use any text editor
```

**Basic Configuration:**
```env
LISTEN_PORT=0
API_PORT=3001
BOOTSTRAP_PEERS=
DATA_DIR=./verimut-data
VERBOSE=false
```

### 5. Build the Project

```bash
npm run build
```

This compiles the TypeScript code to JavaScript.

### 6. Start Your Node

```bash
npm start
```

You should see:
```
✅ Node started successfully!

📊 Node Information:
   Peer ID: 12D3KooW...
   Listen Addresses: /ip4/...
   API Server: http://localhost:3001
   ...

🌐 VerimutFS Node is running!
```

## Troubleshooting

### "node: command not found"

**Solution**: Node.js is not installed or not in PATH
- Reinstall Node.js
- On Windows, restart your terminal after installation
- On Mac/Linux, run `source ~/.bashrc` or restart terminal

### "npm install" fails

**Common causes:**
1. **Network issues**: Check your internet connection
2. **Permission issues**: 
   - Windows: Run terminal as Administrator
   - Mac/Linux: Use `sudo npm install` (not recommended, prefer fixing permissions)
3. **Node version too old**: Upgrade to Node 18+

### "Port already in use"

**Solution**: Another process is using port 3001
```bash
# Find and kill the process
# Windows
netstat -ano | findstr :3001
taskkill /PID <PID> /F

# Mac/Linux
lsof -ti:3001 | xargs kill
```

Or change the port:
```bash
npm start -- --api-port 3002
```

### "Module not found" errors after build

**Solution**: Clean and rebuild
```bash
npm run clean
npm install
npm run build
```

### Cannot connect to bootstrap peers

**Causes:**
1. **Firewall blocking**: Allow Node.js through firewall
2. **No bootstrap peers configured**: Add at least one bootstrap peer
3. **Network restrictions**: Some networks block P2P protocols

**Solutions:**
- Add bootstrap peers in `.env`:
  ```env
  BOOTSTRAP_PEERS=/ip4/YOUR_BOOTSTRAP_IP/tcp/4001/p2p/QmPeerID
  ```
- Check firewall settings
- Try from a different network

### Low disk space warning

**Solution**: Change data directory to a drive with more space
```bash
npm start -- --data-dir /path/to/large/drive/verimut-data
```

## Updating Your Node

```bash
# Pull latest changes
git pull origin main

# Reinstall dependencies (if package.json changed)
npm install

# Rebuild
npm run build

# Restart
npm start
```

## Uninstallation

```bash
# Stop the node (Ctrl+C)

# Remove data directory
rm -rf ./verimut-data

# Remove node_modules
npm run clean

# Remove the entire folder
cd ..
rm -rf verimutfs-node
```

## Advanced Installation

### Running as a System Service

**Linux (systemd):**

Create `/etc/systemd/system/verimutfs.service`:
```ini
[Unit]
Description=VerimutFS Node
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/path/to/verimutfs-node
ExecStart=/usr/bin/node dist/cli.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable verimutfs
sudo systemctl start verimutfs
sudo systemctl status verimutfs
```

**Windows (nssm):**

1. Download [NSSM](https://nssm.cc/)
2. Install as service:
   ```cmd
   nssm install VerimutFS "C:\Program Files\nodejs\node.exe" "C:\path\to\verimutfs-node\dist\cli.js"
   nssm start VerimutFS
   ```

### Docker Installation

Create `Dockerfile`:
```dockerfile
FROM node:18
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 3001 4001
CMD ["npm", "start"]
```

Build and run:
```bash
docker build -t verimutfs-node .
docker run -d -p 3001:3001 -p 4001:4001 verimutfs-node
```

## Getting Help

- **Documentation**: Check README.md
- **Issues**: https://github.com/udene01/verimutfs-node/issues
- **Discussions**: https://github.com/udene01/verimutfs-node/discussions
- **Email**: support@verimut.com

## Next Steps

After installation:

1. **Create a profile**: See "Creating a Profile" in README.md
2. **Test the API**: Try the health check endpoint
3. **Monitor your node**: Watch connection status
4. **Join the community**: Participate in discussions

---

**Welcome to the Verimut Network!** 🎉

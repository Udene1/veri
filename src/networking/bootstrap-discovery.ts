/**
 * Bootstrap Discovery System
 * 
 * Enables automatic bootstrap peer discovery via VNS.
 * Solves the bootstrap URL distribution problem by allowing:
 * 1. Genesis/bootstrap nodes to self-register as "bootstrap.vns"
 * 2. New nodes to discover bootstraps by resolving "bootstrap.vns"
 * 3. Dynamic bootstrap mesh formation without manual URL sharing
 * 
 * Architecture:
 * - Uses well-known seed bootstrap(s) for initial connection
 * - Queries VNS for "bootstrap.vns" to discover all registered bootstraps
 * - Automatically expands HTTP_BOOTSTRAP_PEERS with discovered peers
 * - Supports both static IPs and VNS-based discovery
 */

import crypto from 'crypto';

// Simple logging utility
const log = (message: string) => console.log(message);

/**
 * Compute proof-of-work nonce for VNS registration
 * Uses SHA-256 with configurable difficulty (default: 3 leading zeros)
 */
async function computeProofOfWork(
  name: string,
  owner: string,
  difficulty: number = 3,
  maxAttempts: number = 1000000
): Promise<number | null> {
  const prefix = '0'.repeat(difficulty);
  
  for (let nonce = 0; nonce < maxAttempts; nonce++) {
    const input = `${name}:${owner}:${nonce}`;
    const hash = crypto.createHash('sha256').update(input).digest('hex');
    
    if (hash.startsWith(prefix)) {
      return nonce;
    }
    
    // Log progress every 100k attempts
    if (nonce > 0 && nonce % 100000 === 0) {
      log(`[BootstrapDiscovery] Computing PoW... ${nonce} attempts`);
    }
  }
  
  return null; // Failed to find valid nonce
}

export interface BootstrapDiscoveryConfig {
  /**
   * Well-known seed bootstrap URLs (hardcoded)
   * These are the initial contact points for VNS bootstrap discovery
   */
  seedBootstraps?: string[];
  
  /**
   * Local HTTP API port (for self-registration)
   */
  port?: number;
  
  /**
   * Public URL for this node (if acting as bootstrap)
   */
  publicUrl?: string;
  
  /**
   * Enable verbose logging
   */
  verbose?: boolean;
}

export interface BootstrapEntry {
  url: string;
  timestamp: number;
  peerId?: string;
}

/**
 * Parse bootstrap peers from environment variable
 * Supports both static URLs and VNS-based discovery triggers
 * 
 * Format:
 * - "http://1.2.3.4:3001,http://5.6.7.8:3001" → static URLs
 * - "seed:bootstrap.vns" → trigger VNS discovery from seed
 * - "bootstrap.vns" → trigger VNS discovery from seed
 */
export function parseBootstrapConfig(envVar: string): {
  staticPeers: string[];
  vnsDiscovery: boolean;
  vnsName?: string;
} {
  if (!envVar || envVar.trim() === '') {
    return { staticPeers: [], vnsDiscovery: false };
  }

  const parts = envVar.split(',').map(s => s.trim()).filter(Boolean);
  
  // Check for VNS discovery trigger
  const vnsEntry = parts.find(p => 
    p.startsWith('seed:') || 
    p === 'bootstrap-node' ||
    (p.endsWith('.vns') && !p.startsWith('http'))
  );
  
  if (vnsEntry) {
    const vnsName = vnsEntry.startsWith('seed:') 
      ? vnsEntry.substring(5) 
      : (vnsEntry === 'bootstrap-node' ? 'bootstrap-node' : vnsEntry);
    
    return {
      staticPeers: parts.filter(p => p.startsWith('http')),
      vnsDiscovery: true,
      vnsName
    };
  }

  // All static URLs
  return {
    staticPeers: parts,
    vnsDiscovery: false
  };
}

/**
 * Discover bootstrap peers via VNS
 * 
 * @param vnsName - VNS name to query (e.g., "bootstrap.vns")
 * @param seedBootstraps - Seed bootstrap URLs to query
 * @returns Array of discovered bootstrap URLs
 */
export async function discoverBootstrapPeers(
  vnsName: string,
  seedBootstraps: string[]
): Promise<string[]> {
  const discovered: string[] = [];
  const prefix = '[BootstrapDiscovery]';

  log(`${prefix} Discovering bootstrap peers via VNS name: ${vnsName}`);
  log(`${prefix} Querying ${seedBootstraps.length} seed bootstrap(s)...`);

  for (const seed of seedBootstraps) {
    try {
      const url = `${seed}/api/vns/resolve/${encodeURIComponent(vnsName)}`;
      log(`${prefix} Querying ${seed}...`);

      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000) // 5s timeout
      });

      if (!response.ok) {
        log(`${prefix} ✗ Failed to query ${seed}: ${response.status}`);
        continue;
      }

      const data: any = await response.json();
      
      // Handle different response formats
      if (data.entry && data.entry.value) {
        const value: any = data.entry.value;
        
        // Array of bootstrap URLs
        if (Array.isArray(value.endpoints)) {
          discovered.push(...value.endpoints);
          log(`${prefix} ✓ Discovered ${value.endpoints.length} bootstrap(s) from ${seed}`);
        }
        // Single bootstrap URL
        else if (typeof value.endpoint === 'string') {
          discovered.push(value.endpoint);
          log(`${prefix} ✓ Discovered 1 bootstrap from ${seed}`);
        }
        // Direct string value
        else if (typeof value === 'string' && value.startsWith('http')) {
          discovered.push(value);
          log(`${prefix} ✓ Discovered 1 bootstrap from ${seed}`);
        }
      }
    } catch (error: any) {
      log(`${prefix} ✗ Error querying ${seed}: ${error.message}`);
    }
  }

  // Deduplicate and filter
  const unique = [...new Set(discovered)].filter(url => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  });

  log(`${prefix} Discovery complete: ${unique.length} unique bootstrap peer(s) found`);
  return unique;
}

/**
 * Register this node as a bootstrap peer in VNS
 * 
 * @param vnsName - VNS name to register under (e.g., "bootstrap-node")
 * @param publicUrl - Public URL for this bootstrap node
 * @param vnsApi - Local VNS API base URL
 * @returns Success status
 */
export async function registerAsBootstrap(
  vnsName: string,
  publicUrl: string,
  vnsApi: string = 'http://localhost:3001'
): Promise<boolean> {
  const prefix = '[BootstrapDiscovery]';
  
  try {
    log(`${prefix} Registering as bootstrap: ${vnsName} → ${publicUrl}`);

    // Generate Ed25519 keypair for signing
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    // Compute proof-of-work nonce
    // Note: VNS automatically adds .vfs suffix, so compute PoW with that
    const owner = 'bootstrap-node';
    const normalizedName = vnsName.endsWith('.vfs') ? vnsName : `${vnsName}.vfs`;
    const nonce = await computeProofOfWork(normalizedName, owner);
    
    if (nonce === null) {
      log(`${prefix} ✗ Failed to compute proof-of-work`);
      return false;
    }

    log(`${prefix} Computed PoW nonce: ${nonce}`);
    
    // Verify locally before sending (with normalized name)
    const testInput = `${normalizedName}:${owner}:${nonce}`;
    const testHash = crypto.createHash('sha256').update(testInput).digest('hex');
    log(`${prefix} Local PoW verification: ${testHash.substring(0, 10)} (valid: ${testHash.startsWith('000')}) for "${normalizedName}"`);
    
    if (!testHash.startsWith('000')) {
      log(`${prefix} ✗ Local PoW validation failed! This shouldn't happen.`);
      return false;
    }

    // Prepare registration data with signature
    const timestamp = Date.now();
    const expires = timestamp + (365 * 24 * 60 * 60 * 1000); // 1 year
    const records = [
      {
        type: 'TXT',
        value: publicUrl,
        ttl: 3600
      }
    ];

    // Create canonical JSON for signing (matching VNS serializeForSigning format)
    const canonical = {
      name: normalizedName,
      owner: owner,
      records: records,
      timestamp: timestamp,
      expires: expires,
      nonce: nonce
    };
    const signaturePayload = JSON.stringify(canonical);
    
    // Sign the registration data
    const privateKeyObject = crypto.createPrivateKey(privateKey);
    const dataBuffer = Buffer.from(signaturePayload, 'utf8');
    const signatureBuffer = crypto.sign(null, dataBuffer, privateKeyObject);
    const signature = signatureBuffer.toString('base64');

    // Register via local VNS API (using correct VNS format with PoW)
    const response = await fetch(`${vnsApi}/api/vns/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: vnsName,
        owner: owner,
        nonce: nonce,
        records: records,
        timestamp: timestamp,
        expires: expires,
        signature: signature,
        publicKey: publicKey
      })
    });

    if (!response.ok) {
      const text = await response.text();
      log(`${prefix} ✗ Failed to register: ${response.status} ${text}`);
      return false;
    }

    log(`${prefix} ✓ Successfully registered as ${vnsName}`);
    return true;
  } catch (error: any) {
    log(`${prefix} ✗ Error during registration: ${error.message}`);
    return false;
  }
}

/**
 * Expand bootstrap peers with VNS discovery
 * 
 * @param envVar - HTTP_BOOTSTRAP_PEERS environment variable
 * @param config - Discovery configuration
 * @returns Final list of bootstrap peer URLs
 */
export async function expandBootstrapPeers(
  envVar: string,
  config: BootstrapDiscoveryConfig = {}
): Promise<string[]> {
  const parsed = parseBootstrapConfig(envVar);
  const prefix = '[BootstrapDiscovery]';
  
  // No discovery needed - return static peers
  if (!parsed.vnsDiscovery) {
    return parsed.staticPeers;
  }

  // Use provided seeds or fallback to default
  const seedBootstraps = config.seedBootstraps || [
    // TODO: Replace with your actual seed bootstrap URLs
    'http://seed.verimut.com:3001'
  ];

  log(`${prefix} VNS discovery enabled for: ${parsed.vnsName}`);

  try {
    // Discover bootstraps via VNS
    const discovered = await discoverBootstrapPeers(
      parsed.vnsName!,
      seedBootstraps
    );

    // Combine static + discovered (dedupe)
    const combined = [...new Set([...parsed.staticPeers, ...discovered])];
    
    log(`${prefix} Final bootstrap list: ${combined.length} peer(s)`);
    return combined;
  } catch (error: any) {
    log(`${prefix} ✗ Discovery failed: ${error.message}`);
    log(`${prefix} Falling back to static peers: ${parsed.staticPeers.length}`);
    return parsed.staticPeers;
  }
}

/**
 * Bootstrap discovery workflow for node startup
 * 
 * 1. Parse HTTP_BOOTSTRAP_PEERS
 * 2. If VNS discovery enabled, query seed bootstraps
 * 3. Expand bootstrap list with discovered peers
 * 4. If this node is a bootstrap, self-register in VNS
 */
export async function initializeBootstrapDiscovery(
  config: BootstrapDiscoveryConfig = {}
): Promise<string[]> {
  const envVar = process.env.HTTP_BOOTSTRAP_PEERS || '';
  const prefix = '[BootstrapDiscovery]';

  log(`${prefix} Initializing bootstrap discovery...`);

  // Expand bootstrap peers (static + discovered)
  const bootstrapPeers = await expandBootstrapPeers(envVar, config);

  // If this node should act as bootstrap, register it
  if (config.publicUrl) {
    const vnsName = 'bootstrap.vns'; // Standard bootstrap VNS name
    const vnsApi = `http://localhost:${config.port || 3001}`;
    
    // Wait a bit for VNS to initialize
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    await registerAsBootstrap(vnsName, config.publicUrl, vnsApi);
  }

  return bootstrapPeers;
}

/**
 * Configuration Management
 * Loads and validates node configuration
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

export interface NodeConfig {
  listenPort: number;
  apiPort: number | null;
  bootstrapPeers: string[];
  dataDir: string;
  verbose: boolean;
}

// Default bootstrap peers (update with your network's bootstrap nodes)
const DEFAULT_BOOTSTRAP_PEERS = [
  // Add your bootstrap node addresses here
  // Example: '/ip4/104.131.131.82/tcp/4001/p2p/QmaCpDMGvV2BGHeYERUEnRQAwe3N8SzbUtfsmvsqQLuvuJ'
];

/**
 * Load configuration from environment and options
 */
export function loadConfig(options: Partial<NodeConfig> = {}): NodeConfig {
  // Load .env file if exists
  const envPath = path.join(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }

  // Merge configurations (priority: CLI > ENV > defaults)
  const config: NodeConfig = {
    listenPort: options.listenPort ?? 
                parseInt(process.env.LISTEN_PORT || '0'),
    
    apiPort: options.apiPort !== undefined ? options.apiPort : 
             (process.env.API_PORT ? parseInt(process.env.API_PORT) : 3001),
    
    bootstrapPeers: options.bootstrapPeers?.length ? 
                    options.bootstrapPeers : 
                    (process.env.BOOTSTRAP_PEERS ? 
                     process.env.BOOTSTRAP_PEERS.split(',').map(p => p.trim()) : 
                     DEFAULT_BOOTSTRAP_PEERS),
    
    dataDir: options.dataDir ?? 
             process.env.DATA_DIR ?? 
             './verimut-data',
    
    verbose: options.verbose ?? 
             process.env.VERBOSE === 'true'
  };

  // Validate configuration
  validateConfig(config);

  return config;
}

/**
 * Validate configuration values
 */
function validateConfig(config: NodeConfig): void {
  if (config.listenPort < 0 || config.listenPort > 65535) {
    throw new Error(`Invalid listen port: ${config.listenPort}`);
  }

  if (config.apiPort !== null && (config.apiPort < 0 || config.apiPort > 65535)) {
    throw new Error(`Invalid API port: ${config.apiPort}`);
  }

  if (!config.dataDir) {
    throw new Error('Data directory must be specified');
  }

  // Create data directory if it doesn't exist
  if (!fs.existsSync(config.dataDir)) {
    fs.mkdirSync(config.dataDir, { recursive: true });
  }
}

/**
 * Save configuration to file
 */
export function saveConfig(config: NodeConfig, filePath: string): void {
  const configData = {
    listenPort: config.listenPort,
    apiPort: config.apiPort,
    bootstrapPeers: config.bootstrapPeers,
    dataDir: config.dataDir,
    verbose: config.verbose
  };

  fs.writeFileSync(filePath, JSON.stringify(configData, null, 2));
}

/**
 * Load configuration from file
 */
export function loadConfigFromFile(filePath: string): NodeConfig {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Config file not found: ${filePath}`);
  }

  const data = fs.readFileSync(filePath, 'utf-8');
  const configData = JSON.parse(data);

  return loadConfig(configData);
}

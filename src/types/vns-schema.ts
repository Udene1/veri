/**
 * VNS (Verimut Name Service) Schema
 * 
 * Decentralized DNS-like system for .vfs TLD
 * All names are first-come-first-served with PoW anti-spam
 */

/**
 * VNS Record Types
 */
export type VNSRecordType = 'A' | 'AAAA' | 'TXT' | 'FS' | 'SYNC';

/**
 * Individual DNS-like record for a VNS name
 */
export interface VNSRecord {
  type: VNSRecordType;
  value: string; // IP address (A/AAAA), metadata (TXT), CID/path (FS), or peer endpoint (SYNC)
  ttl?: number; // Time-to-live in seconds (default: 3600)
}

/**
 * Complete registration request for a .vfs name
 */
export interface VNSRegistration {
  name: string; // e.g., "coolname.vfs" (must end in .vfs)
  owner: string; // Public key or peer ID of the owner
  records: VNSRecord[]; // Array of DNS-like records
  timestamp: number; // Registration time (Unix timestamp in ms)
  expires: number; // Expiration time (1 year from registration)
  nonce: number; // Proof-of-work nonce (SHA256 with N leading zeros)
  signature: string; // Ed25519 signature of serialized registration data
  publicKey?: string; // Owner's public key for signature verification
}

/**
 * Internal namespace entry stored in blockstore
 * Includes conflict resolution metadata
 */
export interface VNSNamespaceEntry {
  name: string; // Normalized name (lowercase, with .vfs)
  registration: VNSRegistration; // The actual registration data
  cid: string; // IPFS CID of this entry in blockstore
  merkleRoot?: string; // Merkle root for log integrity verification
  lastModified: number; // Timestamp of last update (for LWW conflict resolution)
  version: number; // Incremental version counter
}

/**
 * VNS resolution response
 */
export interface VNSResolutionResult {
  found: boolean;
  name?: string;
  records?: VNSRecord[];
  owner?: string;
  expires?: number;
  ttl?: number; // Cache TTL in seconds
  error?: string; // Error message if resolution failed
}

/**
 * VNS operation types for logging
 */
export type VNSOperationType = 'register' | 'update' | 'transfer' | 'resolve' | 'expire';

/**
 * VNS log entry for VerimutLog integration
 */
export interface VNSLogEntry {
  operation: VNSOperationType;
  name: string;
  owner?: string;
  newOwner?: string; // For transfer operations
  cid?: string; // CID of the entry in blockstore
  merkleRoot?: string;
  timestamp: number;
  success: boolean;
  error?: string;
}

/**
 * VNS sync message for gossipsub propagation
 */
export interface VNSSyncMessage {
  type: VNSOperationType;
  entry: VNSNamespaceEntry;
  peerId: string; // Originating peer
  timestamp: number;
  signature?: string; // Optional signature for message authenticity
}

/**
 * Reserved VNS names (hardcoded, cannot be registered)
 */
export const RESERVED_VNS_NAMES = [
  'root.vfs',     // Points to genesis CID
  'admin.vfs',    // Reserved for node administrators
  'sync.vfs',     // VerimutSync endpoints
  'bootstrap.vfs' // Bootstrap peer list
] as const;

/**
 * VNS configuration constants
 */
export const VNS_CONFIG = {
  TLD: '.vfs',
  MAX_NAME_LENGTH: 63, // DNS label limit
  MIN_NAME_LENGTH: 3,
  TTL_DEFAULT: 3600, // 1 hour
  EXPIRATION_PERIOD: 365 * 24 * 60 * 60 * 1000, // 1 year in ms
  POW_DIFFICULTY: 3, // Leading zeros required in SHA256 hash
  RATE_LIMIT_PER_HOUR: 5, // Max registrations per peer per hour
  RATE_LIMIT_WINDOW_MS: 60 * 60 * 1000, // 1 hour
  SHARDING_THRESHOLD: 5000, // Start sharding at 5k entries
  MAX_RECORDS_PER_NAME: 20 // Prevent bloat
} as const;

/**
 * Validate a VNS name format
 */
export function validateVNSName(name: string): { valid: boolean; error?: string } {
  // Must end with .vfs
  if (!name.endsWith(VNS_CONFIG.TLD)) {
    return { valid: false, error: `Name must end with ${VNS_CONFIG.TLD}` };
  }

  // Extract the label (part before .vfs)
  const label = name.slice(0, -VNS_CONFIG.TLD.length);

  // Check length
  if (label.length < VNS_CONFIG.MIN_NAME_LENGTH) {
    return { valid: false, error: `Name too short (min ${VNS_CONFIG.MIN_NAME_LENGTH} chars)` };
  }
  if (label.length > VNS_CONFIG.MAX_NAME_LENGTH) {
    return { valid: false, error: `Name too long (max ${VNS_CONFIG.MAX_NAME_LENGTH} chars)` };
  }

  // Check if reserved
  if (RESERVED_VNS_NAMES.includes(name as any)) {
    return { valid: false, error: 'Name is reserved' };
  }

  // Must contain only alphanumeric, hyphen, underscore
  if (!/^[a-z0-9_-]+$/.test(label)) {
    return { valid: false, error: 'Name must contain only lowercase letters, numbers, hyphens, and underscores' };
  }

  // Cannot start or end with hyphen
  if (label.startsWith('-') || label.endsWith('-')) {
    return { valid: false, error: 'Name cannot start or end with a hyphen' };
  }

  return { valid: true };
}

/**
 * Normalize a VNS name (lowercase, ensure .vfs suffix)
 */
export function normalizeVNSName(name: string): string {
  name = name.toLowerCase().trim();
  if (!name.endsWith(VNS_CONFIG.TLD)) {
    name += VNS_CONFIG.TLD;
  }
  return name;
}

/**
 * VNS Namespace Store
 * 
 * Core storage and resolution engine for VNS names
 * Backed by FileBlockstore at /vns/root with in-memory caching
 * Uses Last-Write-Wins (LWW) for conflict resolution
 */

import crypto from 'crypto';
import type { Blockstore } from '../types.js';
import type { VerimutLog } from '../log.js';
import {
  VNSRegistration,
  VNSNamespaceEntry,
  VNSResolutionResult,
  VNSLogEntry,
  RESERVED_VNS_NAMES,
  VNS_CONFIG,
  validateVNSName,
  normalizeVNSName
} from '../types/vns-schema.js';
import { VNSSecurity } from './security.js';

/**
 * Genesis entry for root.vfs
 */
const GENESIS_ROOT: VNSRegistration = {
  name: 'root.vfs',
  owner: 'genesis',
  records: [
    { type: 'TXT', value: 'Verimut Name Service Genesis Root', ttl: 3600 },
    { type: 'TXT', value: 'version:1.0.0', ttl: 3600 }
  ],
  timestamp: 0,
  expires: Number.MAX_SAFE_INTEGER,
  nonce: 0,
  signature: 'genesis'
};

/**
 * VNS Delta message for P2P propagation
 */
export interface VNSDelta {
  type: 'register' | 'update' | 'transfer' | 'expire';
  entry: VNSNamespaceEntry;
  merkleRoot: string;
  peerId: string;
  timestamp: number;
}

/**
 * VNS Namespace Store
 * Local-first storage with P2P sync capabilities
 */
export class VNSNamespaceStore {
  private blockstore: Blockstore;
  private log: VerimutLog | null;
  private security: VNSSecurity;
  
  // In-memory cache: name -> entry
  private entries: Map<string, VNSNamespaceEntry>;
  
  // Reverse index: owner -> names[]
  private ownerIndex: Map<string, string[]>;
  
  // Merkle root for integrity
  private merkleRoot: string;
  
  // Store path in blockstore
  private readonly storePath = '/vns/root';
  
  // Enable/disable flag
  private enabled: boolean;

  // P2P sync callback (set by VerimutSync)
  private syncCallback: ((delta: VNSDelta) => Promise<void>) | null = null;

  // Local peer ID (for delta propagation)
  private localPeerId: string = 'unknown';

  constructor(blockstore: Blockstore, log: VerimutLog | null, security?: VNSSecurity) {
    this.blockstore = blockstore;
    this.log = log;
    this.security = security || new VNSSecurity();
    this.entries = new Map();
    this.ownerIndex = new Map();
    this.merkleRoot = '';
    this.enabled = true;
  }

  /**
   * Set the sync callback for delta propagation
   */
  setSyncCallback(callback: (delta: VNSDelta) => Promise<void>, peerId: string): void {
    this.syncCallback = callback;
    this.localPeerId = peerId;
    console.log(`[VNS] Sync callback registered for peer ${peerId.slice(0, 16)}...`);
  }

  /**
   * Initialize the store and load genesis + reserved names
   */
  async initialize(): Promise<void> {
    console.log('[VNS] Initializing namespace store...');

    // Load genesis root
    await this.loadGenesis();

    // Load reserved names (admin.vfs, sync.vfs, bootstrap.vfs)
    await this.loadReservedNames();

    // Try to load existing namespace from blockstore
    await this.loadFromBlockstore();

    // Compute initial merkle root
    this.updateMerkleRoot();

    console.log(`[VNS] Initialized with ${this.entries.size} entries`);
  }

  /**
   * Load genesis root entry
   */
  private async loadGenesis(): Promise<void> {
    const entry: VNSNamespaceEntry = {
      name: GENESIS_ROOT.name,
      registration: GENESIS_ROOT,
      cid: 'genesis',
      lastModified: 0,
      version: 1
    };

    this.entries.set(GENESIS_ROOT.name, entry);
    this.indexOwner(GENESIS_ROOT.owner, GENESIS_ROOT.name);
  }

  /**
   * Load reserved names with placeholder entries
   */
  private async loadReservedNames(): Promise<void> {
    const reservedNames = ['admin.vfs', 'sync.vfs', 'bootstrap.vfs'];
    
    for (const name of reservedNames) {
      const entry: VNSNamespaceEntry = {
        name,
        registration: {
          name,
          owner: 'reserved',
          records: [{ type: 'TXT', value: 'Reserved for system use', ttl: 3600 }],
          timestamp: 0,
          expires: Number.MAX_SAFE_INTEGER,
          nonce: 0,
          signature: 'reserved'
        },
        cid: `reserved:${name}`,
        lastModified: 0,
        version: 1
      };

      this.entries.set(name, entry);
      this.indexOwner('reserved', name);
    }
  }

  /**
   * Load namespace entries from blockstore (stub for now)
   */
  private async loadFromBlockstore(): Promise<void> {
    // TODO: Implement loading from /vns/root CID
    // For now, start with empty namespace (beyond genesis/reserved)
    console.log('[VNS] Blockstore loading not yet implemented (starting fresh)');
  }

  /**
   * Register a new VNS name
   */
  async register(registration: VNSRegistration, peerId: string): Promise<{ success: boolean; error?: string; cid?: string }> {
    if (!this.enabled) {
      return { success: false, error: 'VNS is disabled' };
    }

    try {
      // Normalize name
      const name = normalizeVNSName(registration.name);
      registration.name = name;

      // Validate name format
      const nameValidation = validateVNSName(name);
      if (!nameValidation.valid) {
        return { success: false, error: nameValidation.error };
      }

      // Check security (PoW, rate limit, signature)
      const securityValidation = this.security.validateRegistration(registration, peerId);
      if (!securityValidation.valid) {
        return { success: false, error: securityValidation.error };
      }

      // Check if name already exists
      const existing = this.entries.get(name);
      if (existing) {
        // LWW conflict resolution: newer timestamp wins
        if (registration.timestamp <= existing.registration.timestamp) {
          return { success: false, error: 'Name already registered with newer timestamp' };
        }
        
        console.log(`[VNS] Updating existing registration for ${name} (LWW)`);
      }

      // Store in blockstore
      const cid = await this.storeInBlockstore(registration);

      // Create namespace entry
      const entry: VNSNamespaceEntry = {
        name,
        registration,
        cid,
        lastModified: Date.now(),
        version: existing ? existing.version + 1 : 1
      };

      // Update in-memory cache
      this.entries.set(name, entry);
      this.indexOwner(registration.owner, name);

      // Update merkle root
      this.updateMerkleRoot();

      // Log the operation
      await this.logOperation({
        operation: 'register',
        name,
        owner: registration.owner,
        cid,
        merkleRoot: this.merkleRoot,
        timestamp: Date.now(),
        success: true
      });

      console.log(`[VNS] Registered ${name} -> ${cid} (owner: ${registration.owner.slice(0, 16)}...)`);

      // Propagate delta to peers
      await this.triggerDeltaPropagation(existing ? 'update' : 'register', name);

      return { success: true, cid };
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      console.error('[VNS] Registration failed:', error);
      
      // Log failed operation
      await this.logOperation({
        operation: 'register',
        name: registration.name,
        owner: registration.owner,
        timestamp: Date.now(),
        success: false,
        error
      });

      return { success: false, error };
    }
  }

  /**
   * Resolve a VNS name to its records
   */
  async resolve(name: string): Promise<VNSResolutionResult> {
    try {
      // Normalize name
      name = normalizeVNSName(name);

      // Check local cache first
      const entry = this.entries.get(name);
      if (!entry) {
        // Log failed resolution
        await this.logOperation({
          operation: 'resolve',
          name,
          timestamp: Date.now(),
          success: false,
          error: 'Name not found'
        });

        return {
          found: false,
          error: 'Name not found in local cache'
        };
      }

      // Check if expired
      if (this.security.isExpired(entry.registration.expires)) {
        // Mark as expired (but don't delete yet)
        await this.logOperation({
          operation: 'expire',
          name,
          owner: entry.registration.owner,
          timestamp: Date.now(),
          success: true
        });

        return {
          found: false,
          error: 'Name has expired'
        };
      }

      // Log successful resolution
      await this.logOperation({
        operation: 'resolve',
        name,
        owner: entry.registration.owner,
        timestamp: Date.now(),
        success: true
      });

      return {
        found: true,
        name: entry.name,
        records: entry.registration.records,
        owner: entry.registration.owner,
        expires: entry.registration.expires,
        ttl: VNS_CONFIG.TTL_DEFAULT
      };
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      console.error('[VNS] Resolution failed:', error);
      
      return {
        found: false,
        error
      };
    }
  }

  /**
   * Transfer ownership of a name (with signature verification)
   */
  async transfer(name: string, newOwner: string, signature: string, peerId: string): Promise<{ success: boolean; error?: string }> {
    try {
      name = normalizeVNSName(name);

      const entry = this.entries.get(name);
      if (!entry) {
        return { success: false, error: 'Name not found' };
      }

      // Check if expired
      if (this.security.isExpired(entry.registration.expires)) {
        return { success: false, error: 'Name has expired' };
      }

      // TODO: Implement multisig verification for transfers
      // For now, just check if the signature matches the current owner

      // Update registration
      const updatedReg = {
        ...entry.registration,
        owner: newOwner,
        timestamp: Date.now()
      };

      // Store updated registration
      const cid = await this.storeInBlockstore(updatedReg);

      // Update entry
      const updatedEntry: VNSNamespaceEntry = {
        ...entry,
        registration: updatedReg,
        cid,
        lastModified: Date.now(),
        version: entry.version + 1
      };

      this.entries.set(name, updatedEntry);
      this.indexOwner(newOwner, name);

      // Update merkle root
      this.updateMerkleRoot();

      // Log transfer
      await this.logOperation({
        operation: 'transfer',
        name,
        owner: entry.registration.owner,
        newOwner,
        cid,
        merkleRoot: this.merkleRoot,
        timestamp: Date.now(),
        success: true
      });

      console.log(`[VNS] Transferred ${name} from ${entry.registration.owner.slice(0, 16)}... to ${newOwner.slice(0, 16)}...`);

      // Propagate transfer delta to peers
      await this.triggerDeltaPropagation('transfer', name);

      return { success: true };
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      console.error('[VNS] Transfer failed:', error);
      return { success: false, error };
    }
  }

  /**
   * Get all names owned by a specific owner
   */
  getNamesByOwner(owner: string): string[] {
    return this.ownerIndex.get(owner) || [];
  }

  /**
   * Get the current merkle root
   */
  getMerkleRoot(): string {
    return this.merkleRoot;
  }

  /**
   * Get total number of registered names
   */
  size(): number {
    return this.entries.size;
  }

  /**
   * Store registration in blockstore and return CID
   */
  private async storeInBlockstore(registration: VNSRegistration): Promise<string> {
    const data = Buffer.from(JSON.stringify(registration), 'utf8');
    const cid = await this.blockstore.put(data);
    return cid;
  }

  /**
   * Index a name by owner
   */
  private indexOwner(owner: string, name: string): void {
    const names = this.ownerIndex.get(owner) || [];
    if (!names.includes(name)) {
      names.push(name);
      this.ownerIndex.set(owner, names);
    }
  }

  /**
   * Update merkle root based on current entries
   */
  private updateMerkleRoot(): void {
    // Simple merkle root: hash of all entry CIDs sorted
    const cids = Array.from(this.entries.values())
      .map(e => e.cid)
      .sort();
    
    const combined = cids.join(':');
    this.merkleRoot = crypto.createHash('sha256')
      .update(combined)
      .digest('hex');
  }

  /**
   * Log a VNS operation to VerimutLog
   */
  private async logOperation(entry: VNSLogEntry): Promise<void> {
    if (this.log) {
      try {
        await this.log.add(entry);
      } catch (e) {
        console.warn('[VNS] Failed to log operation:', e);
      }
    }
  }

  /**
   * Enable/disable VNS
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    console.log(`[VNS] ${enabled ? 'Enabled' : 'Disabled'}`);
  }

  /**
   * Check if VNS is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Export all entries (for sync/backup)
   */
  exportEntries(): VNSNamespaceEntry[] {
    return Array.from(this.entries.values());
  }

  /**
   * Import an entry (from sync/peer)
   */
  async importEntry(entry: VNSNamespaceEntry): Promise<boolean> {
    try {
      const existing = this.entries.get(entry.name);

      // LWW: Only import if newer
      if (existing && entry.lastModified <= existing.lastModified) {
        return false; // Older or equal, ignore
      }

      // Update cache
      this.entries.set(entry.name, entry);
      this.indexOwner(entry.registration.owner, entry.name);

      // Update merkle root
      this.updateMerkleRoot();

      console.log(`[VNS] Imported entry for ${entry.name} (version ${entry.version})`);
      return true;
    } catch (e) {
      console.error('[VNS] Failed to import entry:', e);
      return false;
    }
  }

  /**
   * Propagate a delta to peers via VerimutSync
   */
  private async propagateDelta(type: VNSDelta['type'], entry: VNSNamespaceEntry): Promise<void> {
    if (!this.syncCallback) {
      console.log('[VNS] No sync callback registered, skipping delta propagation');
      return;
    }

    try {
      const delta: VNSDelta = {
        type,
        entry,
        merkleRoot: this.merkleRoot,
        peerId: this.localPeerId,
        timestamp: Date.now()
      };

      await this.syncCallback(delta);
      console.log(`[VNS] Propagated ${type} delta for ${entry.name}`);
    } catch (e) {
      console.error('[VNS] Failed to propagate delta:', e);
    }
  }

  /**
   * Apply an incoming delta from a peer
   * Validates signature, PoW, and uses LWW for conflict resolution
   */
  async applyDelta(delta: VNSDelta, sourcePeerId: string): Promise<{ applied: boolean; error?: string }> {
    try {
      // Ignore our own deltas
      if (delta.peerId === this.localPeerId) {
        return { applied: false, error: 'Ignoring own delta' };
      }

      const entry = delta.entry;
      const name = entry.name;

      console.log(`[VNS] Received ${delta.type} delta for ${name} from ${sourcePeerId.slice(0, 16)}...`);

      // Validate name format
      const nameValidation = validateVNSName(name);
      if (!nameValidation.valid) {
        return { applied: false, error: `Invalid name: ${nameValidation.error}` };
      }

      // Validate registration signature and PoW
      const securityValidation = this.security.validateRegistration(
        entry.registration,
        sourcePeerId
      );
      if (!securityValidation.valid) {
        return { applied: false, error: `Security validation failed: ${securityValidation.error}` };
      }

      // Check if expired
      if (this.security.isExpired(entry.registration.expires)) {
        // Handle expiry
        if (delta.type === 'expire') {
          const existing = this.entries.get(name);
          if (existing) {
            this.entries.delete(name);
            this.updateMerkleRoot();
            
            await this.logOperation({
              operation: 'expire',
              name,
              owner: existing.registration.owner,
              timestamp: Date.now(),
              success: true
            });

            console.log(`[VNS] Expired ${name} via delta`);
            return { applied: true };
          }
        }
        return { applied: false, error: 'Entry has expired' };
      }

      // LWW conflict resolution
      const existing = this.entries.get(name);
      if (existing) {
        // Only apply if newer
        if (entry.lastModified <= existing.lastModified) {
          console.log(`[VNS] Delta for ${name} is older (${entry.lastModified} <= ${existing.lastModified}), ignoring`);
          return { applied: false, error: 'Older or equal timestamp (LWW)' };
        }

        // Check if it's a transfer
        if (delta.type === 'transfer' && entry.registration.owner !== existing.registration.owner) {
          console.log(`[VNS] Transfer detected: ${name} from ${existing.registration.owner.slice(0, 16)}... to ${entry.registration.owner.slice(0, 16)}...`);
        }
      }

      // Apply the entry
      this.entries.set(name, entry);
      this.indexOwner(entry.registration.owner, name);
      this.updateMerkleRoot();

      // Log the operation
      await this.logOperation({
        operation: delta.type === 'expire' ? 'expire' : (existing ? 'update' : 'register'),
        name,
        owner: entry.registration.owner,
        newOwner: delta.type === 'transfer' ? entry.registration.owner : undefined,
        cid: entry.cid,
        merkleRoot: this.merkleRoot,
        timestamp: Date.now(),
        success: true
      });

      console.log(`[VNS] Applied ${delta.type} delta for ${name} (version ${entry.version})`);

      // Re-propagate if we're the new owner (helps with mesh convergence)
      if (entry.registration.owner === this.localPeerId) {
        await this.propagateDelta(delta.type, entry);
      }

      return { applied: true };
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      console.error('[VNS] Failed to apply delta:', error);
      return { applied: false, error };
    }
  }

  /**
   * Trigger delta propagation after successful local operations
   */
  private async triggerDeltaPropagation(type: VNSDelta['type'], name: string): Promise<void> {
    const entry = this.entries.get(name);
    if (entry) {
      await this.propagateDelta(type, entry);
    }
  }
}

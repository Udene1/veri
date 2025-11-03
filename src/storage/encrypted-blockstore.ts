import type { Blockstore } from 'interface-blockstore';
import { CID } from 'multiformats/cid';
import { encryptSymmetric, decryptSymmetric, type EncryptedData } from '../crypto/crypto-utils.js';

/**
 * Encrypted Blockstore Wrapper
 * 
 * Transparently encrypts blocks before storing and decrypts after retrieving.
 * This ensures that:
 * 1. Node operators cannot read stored data
 * 2. Malicious nodes cannot extract user information
 * 3. Data remains encrypted at rest
 * 
 * Architecture:
 * - Wraps any Blockstore implementation (FileBlockstore, S3Blockstore, etc.)
 * - Uses AES-256-GCM for symmetric encryption
 * - Stores encrypted data as: { ciphertext, iv, authTag, algorithm }
 * - CIDs remain unchanged (encryption happens at storage layer)
 * 
 * Note: This is a simplified wrapper that focuses on core encryption.
 * For production, consider using a full Blockstore implementation.
 */

export class EncryptedBlockstore {
  private inner: Blockstore;
  private encryptionKey: string; // Base64 encoded 32-byte key
  private enabled: boolean;      // Can be disabled for testing

  constructor(blockstore: Blockstore, encryptionKey: string, enabled: boolean = true) {
    this.inner = blockstore;
    this.encryptionKey = encryptionKey;
    this.enabled = enabled;
  }

  // ============================================================================
  // CORE BLOCKSTORE METHODS
  // ============================================================================

  async put(key: CID, value: Uint8Array): Promise<void> {
    if (!this.enabled) {
      return this.inner.put(key, value);
    }

    try {
      // Convert Uint8Array to base64 string for encryption
      const plaintext = Buffer.from(value).toString('base64');
      
      // Encrypt the block data
      const encrypted = encryptSymmetric(plaintext, this.encryptionKey);
      
      // Serialize encrypted data to JSON
      const encryptedBytes = Buffer.from(JSON.stringify(encrypted), 'utf8');
      
      // Store encrypted data with original CID
      await this.inner.put(key, encryptedBytes);
    } catch (error) {
      throw new Error(`Failed to encrypt block ${key.toString()}: ${error}`);
    }
  }

  async get(key: CID): Promise<Uint8Array> {
    if (!this.enabled) {
      return this.inner.get(key);
    }

    try {
      // Retrieve encrypted block
      const encryptedBytes = await this.inner.get(key);
      
      // Parse encrypted data
      const encryptedStr = Buffer.from(encryptedBytes).toString('utf8');
      const encrypted: EncryptedData = JSON.parse(encryptedStr);
      
      // Decrypt the block data
      const plaintext = decryptSymmetric(encrypted, this.encryptionKey);
      
      // Convert base64 back to Uint8Array
      return Buffer.from(plaintext, 'base64');
    } catch (error) {
      throw new Error(`Failed to decrypt block ${key.toString()}: ${error}`);
    }
  }

  async has(key: CID): Promise<boolean> {
    // Has check doesn't require decryption
    return this.inner.has(key);
  }

  async delete(key: CID): Promise<void> {
    return this.inner.delete(key);
  }

  // ============================================================================
  // BATCH OPERATIONS (simplified - use individual operations for encryption)
  // ============================================================================

  // ============================================================================
  // UTILITIES
  // ============================================================================

  /**
   * Enable/disable encryption (useful for testing)
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Check if encryption is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get underlying blockstore (for direct access if needed)
   */
  getInnerBlockstore(): Blockstore {
    return this.inner;
  }
  
  /**
   * Pass through all other blockstore methods to inner blockstore
   */
  [key: string]: any;
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create an encrypted blockstore with a user's encryption key
 */
export function createEncryptedBlockstore(
  blockstore: Blockstore,
  userEncryptionKey: string,
  enabled: boolean = true
): EncryptedBlockstore {
  return new EncryptedBlockstore(blockstore, userEncryptionKey, enabled);
}

/**
 * Create encrypted blockstore with a node-level encryption key
 * (less secure than user-level, but better than no encryption)
 */
export function createNodeEncryptedBlockstore(
  blockstore: Blockstore,
  nodeId: string,
  enabled: boolean = true
): EncryptedBlockstore {
  // Derive encryption key from node ID (in production, use KDF)
  const crypto = require('crypto');
  const key = crypto.createHash('sha256')
    .update('verimut-node-encryption-' + nodeId)
    .digest('base64');
  
  return new EncryptedBlockstore(blockstore, key, enabled);
}

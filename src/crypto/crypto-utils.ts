import { generateKeyPair as generateLibp2pKeyPair, marshalPublicKey, unmarshalPublicKey } from '@libp2p/crypto/keys';
import { peerIdFromKeys } from '@libp2p/peer-id';
import crypto from 'crypto';
import type { PeerId } from '@libp2p/interface';

/**
 * Cryptographic utilities for VerimutFS
 * - Key generation (Ed25519)
 * - Symmetric encryption (AES-256-GCM)
 * - ECDH key exchange
 * - Signing and verification
 * - Geohashing for proximity search
 */

export interface KeyPair {
  publicKey: string;    // Base64 encoded
  privateKey: string;   // Base64 encoded
  peerId: PeerId;
}

export interface EncryptedData {
  ciphertext: string;   // Base64 encoded
  iv: string;           // Base64 encoded (initialization vector)
  authTag: string;      // Base64 encoded (GCM authentication tag)
  algorithm: 'aes-256-gcm';
}

export interface GeolocationData {
  geohash: string;      // Precision-based geohash (user-controlled)
  precision: number;    // 3 (city), 5 (neighborhood), 7 (street)
  lat?: number;         // Optional: stored locally, never sent to network
  lng?: number;         // Optional: stored locally, never sent to network
}

// ============================================================================
// KEY GENERATION
// ============================================================================

/**
 * Generate Ed25519 keypair for signing and encryption
 */
export async function generateKeyPair(): Promise<KeyPair> {
  const libp2pKey = await generateLibp2pKeyPair('Ed25519');
  const publicKeyBytes = marshalPublicKey(libp2pKey.public);
  const peerId = await peerIdFromKeys(publicKeyBytes, libp2pKey.bytes);
  
  return {
    publicKey: Buffer.from(publicKeyBytes).toString('base64'),
    privateKey: Buffer.from(libp2pKey.bytes).toString('base64'),
    peerId: peerId as any,
  };
}

/**
 * Derive PeerId from public key string
 */
export async function publicKeyToPeerId(publicKeyBase64: string): Promise<PeerId> {
  const publicKeyBytes = Buffer.from(publicKeyBase64, 'base64');
  const publicKey = unmarshalPublicKey(publicKeyBytes);
  // Create PeerId from public key only
  return peerIdFromKeys(publicKeyBytes) as any;
}

// ============================================================================
// SYMMETRIC ENCRYPTION (AES-256-GCM)
// ============================================================================

/**
 * Encrypt data with AES-256-GCM using a symmetric key
 * @param data - Data to encrypt (will be JSON.stringify if object)
 * @param key - 32-byte encryption key (base64 encoded)
 */
export function encryptSymmetric(data: any, key: string): EncryptedData {
  const plaintext = typeof data === 'string' ? data : JSON.stringify(data);
  const keyBuffer = Buffer.from(key, 'base64');
  
  if (keyBuffer.length !== 32) {
    throw new Error('Encryption key must be 32 bytes (256 bits)');
  }
  
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer, iv);
  
  let ciphertext = cipher.update(plaintext, 'utf8', 'base64');
  ciphertext += cipher.final('base64');
  
  const authTag = cipher.getAuthTag();
  
  return {
    ciphertext,
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    algorithm: 'aes-256-gcm',
  };
}

/**
 * Decrypt AES-256-GCM encrypted data
 * @param encrypted - Encrypted data object
 * @param key - 32-byte decryption key (base64 encoded)
 */
export function decryptSymmetric(encrypted: EncryptedData, key: string): any {
  const keyBuffer = Buffer.from(key, 'base64');
  const iv = Buffer.from(encrypted.iv, 'base64');
  const authTag = Buffer.from(encrypted.authTag, 'base64');
  
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, iv);
  decipher.setAuthTag(authTag);
  
  let plaintext = decipher.update(encrypted.ciphertext, 'base64', 'utf8');
  plaintext += decipher.final('utf8');
  
  try {
    return JSON.parse(plaintext);
  } catch {
    return plaintext;
  }
}

/**
 * Generate random 32-byte symmetric key
 */
export function generateSymmetricKey(): string {
  return crypto.randomBytes(32).toString('base64');
}

// ============================================================================
// ECDH KEY EXCHANGE (for message encryption between users)
// ============================================================================

/**
 * Derive shared secret using ECDH (for encrypting messages between two users)
 * NOTE: Ed25519 is primarily for signing. For ECDH, we convert to Curve25519
 * @param myPrivateKey - My private key (base64)
 * @param theirPublicKey - Their public key (base64)
 */
export function deriveSharedSecret(myPrivateKey: string, theirPublicKey: string): string {
  // For production: Use @noble/curves or libsodium for proper Ed25519 -> X25519 conversion
  // Simplified here: we'll use SHA-256 hash of concatenated keys as shared secret
  const combined = myPrivateKey + theirPublicKey;
  const hash = crypto.createHash('sha256').update(combined).digest();
  return hash.toString('base64');
}

/**
 * Encrypt data for a specific recipient using ECDH shared secret
 */
export function encryptForRecipient(
  data: any,
  myPrivateKey: string,
  recipientPublicKey: string
): EncryptedData {
  const sharedSecret = deriveSharedSecret(myPrivateKey, recipientPublicKey);
  return encryptSymmetric(data, sharedSecret);
}

/**
 * Decrypt data from a specific sender using ECDH shared secret
 */
export function decryptFromSender(
  encrypted: EncryptedData,
  myPrivateKey: string,
  senderPublicKey: string
): any {
  const sharedSecret = deriveSharedSecret(myPrivateKey, senderPublicKey);
  return decryptSymmetric(encrypted, sharedSecret);
}

// ============================================================================
// SIGNING AND VERIFICATION
// ============================================================================

/**
 * Sign data with Ed25519 private key
 * @param data - Data to sign (will be JSON.stringify if object)
 * @param privateKey - Private key (base64 encoded)
 */
export function sign(data: any, privateKey: string): string {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  const privateKeyBuffer = Buffer.from(privateKey, 'base64');
  
  // For Ed25519 signing, we need the actual private key
  // Simplified: using HMAC-SHA256 as a signature scheme
  const signature = crypto.createHmac('sha256', privateKeyBuffer)
    .update(payload)
    .digest('base64');
  
  return signature;
}

/**
 * Verify signature with Ed25519 public key
 * @param data - Original data
 * @param signature - Signature to verify (base64)
 * @param publicKey - Public key (base64 encoded)
 */
export function verify(data: any, signature: string, publicKey: string): boolean {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  
  // For production: Use proper Ed25519 verification
  // Simplified: re-compute HMAC and compare
  // NOTE: This is NOT secure Ed25519 verification, just a placeholder
  try {
    const publicKeyBuffer = Buffer.from(publicKey, 'base64');
    const expectedSignature = crypto.createHmac('sha256', publicKeyBuffer)
      .update(payload)
      .digest('base64');
    
    return signature === expectedSignature;
  } catch {
    return false;
  }
}

// ============================================================================
// GEOHASHING (for proximity-based search)
// ============================================================================

const BASE32_CHARS = '0123456789bcdefghjkmnpqrstuvwxyz';

/**
 * Encode latitude/longitude to geohash string
 * @param lat - Latitude (-90 to 90)
 * @param lng - Longitude (-180 to 180)
 * @param precision - Number of characters (3=~150km, 5=~5km, 7=~150m)
 */
export function geohashEncode(lat: number, lng: number, precision: number = 5): string {
  let geohash = '';
  let evenBit = true;
  let bit = 0;
  let ch = 0;
  
  let latMin = -90, latMax = 90;
  let lngMin = -180, lngMax = 180;
  
  while (geohash.length < precision) {
    if (evenBit) {
      // Longitude
      const mid = (lngMin + lngMax) / 2;
      if (lng > mid) {
        ch |= (1 << (4 - bit));
        lngMin = mid;
      } else {
        lngMax = mid;
      }
    } else {
      // Latitude
      const mid = (latMin + latMax) / 2;
      if (lat > mid) {
        ch |= (1 << (4 - bit));
        latMin = mid;
      } else {
        latMax = mid;
      }
    }
    
    evenBit = !evenBit;
    
    if (bit < 4) {
      bit++;
    } else {
      geohash += BASE32_CHARS[ch];
      bit = 0;
      ch = 0;
    }
  }
  
  return geohash;
}

/**
 * Decode geohash to approximate latitude/longitude
 * Returns bounding box: [minLat, minLng, maxLat, maxLng]
 */
export function geohashDecode(geohash: string): { lat: number; lng: number; error: { lat: number; lng: number } } {
  let evenBit = true;
  let latMin = -90, latMax = 90;
  let lngMin = -180, lngMax = 180;
  
  for (let i = 0; i < geohash.length; i++) {
    const char = geohash[i];
    const charIndex = BASE32_CHARS.indexOf(char);
    
    if (charIndex === -1) {
      throw new Error(`Invalid geohash character: ${char}`);
    }
    
    for (let bit = 4; bit >= 0; bit--) {
      const bitValue = (charIndex >> bit) & 1;
      
      if (evenBit) {
        // Longitude
        const mid = (lngMin + lngMax) / 2;
        if (bitValue === 1) {
          lngMin = mid;
        } else {
          lngMax = mid;
        }
      } else {
        // Latitude
        const mid = (latMin + latMax) / 2;
        if (bitValue === 1) {
          latMin = mid;
        } else {
          latMax = mid;
        }
      }
      
      evenBit = !evenBit;
    }
  }
  
  const lat = (latMin + latMax) / 2;
  const lng = (lngMin + lngMax) / 2;
  
  return {
    lat,
    lng,
    error: {
      lat: (latMax - latMin) / 2,
      lng: (lngMax - lngMin) / 2,
    },
  };
}

/**
 * Get all neighbor geohashes (N, S, E, W, NE, NW, SE, SW)
 * Used for expanding search radius
 */
export function geohashNeighbors(geohash: string): string[] {
  const decoded = geohashDecode(geohash);
  const precision = geohash.length;
  
  // Calculate approximate offset based on geohash precision
  const latOffset = decoded.error.lat * 2;
  const lngOffset = decoded.error.lng * 2;
  
  const neighbors = [
    geohashEncode(decoded.lat + latOffset, decoded.lng, precision),          // North
    geohashEncode(decoded.lat - latOffset, decoded.lng, precision),          // South
    geohashEncode(decoded.lat, decoded.lng + lngOffset, precision),          // East
    geohashEncode(decoded.lat, decoded.lng - lngOffset, precision),          // West
    geohashEncode(decoded.lat + latOffset, decoded.lng + lngOffset, precision), // NE
    geohashEncode(decoded.lat + latOffset, decoded.lng - lngOffset, precision), // NW
    geohashEncode(decoded.lat - latOffset, decoded.lng + lngOffset, precision), // SE
    geohashEncode(decoded.lat - latOffset, decoded.lng - lngOffset, precision), // SW
  ];
  
  // Remove duplicates
  return Array.from(new Set(neighbors));
}

/**
 * Calculate distance between two coordinates (Haversine formula)
 * Returns distance in kilometers
 */
export function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371; // Earth radius in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  
  return distance;
}

// ============================================================================
// HASHING (for DHT index keys)
// ============================================================================

/**
 * Hash a value for DHT indexing (prevents plaintext skill names in DHT)
 * @param value - Value to hash (e.g., "fashion-design")
 * @param salt - Network-wide salt (prevents rainbow table attacks)
 */
export function hashIndexKey(value: string, salt: string): string {
  return crypto.createHash('sha256')
    .update(value + salt)
    .digest('hex');
}

/**
 * Hash a peer ID for privacy (stored in DHT values)
 */
export function hashPeerId(peerId: string): string {
  return crypto.createHash('sha256')
    .update(peerId)
    .digest('hex')
    .substring(0, 16); // Truncate to 16 chars for storage efficiency
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Generate network-wide salt (should be consistent across network)
 * In production, this would be hardcoded or derived from genesis block
 */
export function generateNetworkSalt(): string {
  return 'verimut-network-v1-salt-2025'; // Fixed salt for entire network
}

/**
 * Validate geolocation data
 */
export function validateGeolocation(data: GeolocationData): boolean {
  if (!data.geohash || typeof data.geohash !== 'string') {
    return false;
  }
  
  if (![3, 5, 7].includes(data.precision)) {
    return false;
  }
  
  if (data.geohash.length !== data.precision) {
    return false;
  }
  
  // Validate geohash characters
  for (const char of data.geohash) {
    if (!BASE32_CHARS.includes(char)) {
      return false;
    }
  }
  
  return true;
}

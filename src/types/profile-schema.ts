import type { CID } from 'multiformats/cid';
import type { EncryptedData, GeolocationData } from '../crypto/crypto-utils.js';

/**
 * Profile Schema for VerimutFS
 * 
 * Three-tier security model:
 * 1. PUBLIC: Discovery metadata (stored in DHT, hashed indexes)
 * 2. PRIVATE: Profile details (encrypted with user's key, stored in IPFS)
 * 3. CONVERSATION: End-to-end encrypted messages (per-conversation keys)
 */

// ============================================================================
// PUBLIC TIER (Discovery Metadata)
// ============================================================================

export interface PublicProfile {
  // Identity
  peerId: string;               // User's libp2p peer ID
  publicKey: string;            // Ed25519 public key (base64) for encryption/verification
  
  // Discovery indexes (used for DHT queries)
  skillHashes: string[];        // Hashed skill tags (sha256(skill + salt))
  geolocation: GeolocationData; // User-controlled precision geohash
  ageRange: AgeRange;           // Bucketed age for privacy
  availability: AvailabilityStatus;
  
  // References to encrypted data
  privateCID: string;           // IPFS CID pointing to encrypted private profile
  
  // Metadata
  profileVersion: number;       // For versioning/conflict resolution
  updatedAt: number;            // Unix timestamp
  signature: string;            // Ed25519 signature of this object
}

export type AgeRange = 
  | '18-25'
  | '25-30'
  | '30-40'
  | '40-50'
  | '50-60'
  | '60-70'
  | '70+';

export type AvailabilityStatus = 
  | 'available'        // Actively looking for work
  | 'busy'            // Currently booked
  | 'vacation'        // Temporarily unavailable
  | 'retired';        // Not taking new clients

// ============================================================================
// PRIVATE TIER (Encrypted Profile Details)
// ============================================================================

export interface PrivateProfile {
  // Personal Information (NEVER sent to network unencrypted)
  fullName: string;
  email: string;
  phone?: string;
  
  // Professional Details
  bio: string;                  // Full professional bio
  skills: SkillDetail[];        // Detailed skill descriptions
  experience: ExperienceEntry[];
  education: EducationEntry[];
  certifications: Certification[];
  
  // Portfolio
  portfolio: {
    images: string[];           // IPFS CIDs of portfolio images
    videos: string[];           // IPFS CIDs of portfolio videos
    descriptions: string[];     // Descriptions for each portfolio item
  };
  
  // Pricing
  hourlyRate?: number;          // USD per hour
  currency: string;             // 'USD', 'EUR', 'CAD', etc.
  acceptedPaymentMethods: PaymentMethod[];
  
  // Reviews (stored encrypted to prevent fake reviews)
  reviews: Review[];
  rating: number;               // Average rating (0-5)
  totalBookings: number;        // Total completed bookings
  
  // Privacy Settings
  privacySettings: PrivacySettings;
  
  // Exact location (stored locally on user's device, NEVER on network)
  exactLocation?: {
    lat: number;
    lng: number;
    address: string;
  };
}

export interface SkillDetail {
  name: string;                 // e.g., "Fashion Design"
  category: string;             // e.g., "Arts & Crafts"
  description: string;          // Detailed description
  yearsOfExperience: number;
  certifications: string[];     // Related certifications
  tags: string[];              // Searchable tags
}

export interface ExperienceEntry {
  title: string;
  company: string;
  startDate: string;            // ISO 8601 date
  endDate?: string;             // ISO 8601 date (null if current)
  description: string;
}

export interface EducationEntry {
  institution: string;
  degree: string;
  fieldOfStudy: string;
  graduationYear: number;
}

export interface Certification {
  name: string;
  issuer: string;
  issueDate: string;            // ISO 8601 date
  expiryDate?: string;          // ISO 8601 date (null if no expiry)
  credentialId?: string;
  credentialUrl?: string;
}

export type PaymentMethod = 
  | 'crypto'                    // Cryptocurrency
  | 'bank-transfer'
  | 'paypal'
  | 'stripe'
  | 'cash';

export interface Review {
  reviewerId: string;           // PeerId of reviewer
  reviewerName: string;
  rating: number;               // 1-5 stars
  comment: string;
  bookingId: string;            // Reference to booking
  createdAt: number;            // Unix timestamp
  signature: string;            // Reviewer's signature (prevents tampering)
}

export interface PrivacySettings {
  // Who can view full profile
  profileVisibility: 'public' | 'connections-only' | 'paid-view';
  paidViewPrice?: number;       // USD if 'paid-view'
  
  // Who can send messages
  messagePermissions: 'anyone' | 'connections-only' | 'no-one';
  
  // Show exact location after connection
  showExactLocationAfterConnection: boolean;
  
  // Show email/phone after connection
  showContactInfoAfterConnection: boolean;
  
  // Allow appearing in search results
  appearInSearchResults: boolean;
}

// ============================================================================
// CONVERSATION TIER (End-to-End Encrypted)
// ============================================================================

export interface Conversation {
  conversationId: string;       // UUID
  participants: string[];       // PeerIds of participants
  sharedSecret: string;         // ECDH shared secret (base64)
  messages: EncryptedMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface EncryptedMessage {
  messageId: string;
  senderId: string;             // PeerId
  encrypted: EncryptedData;     // Encrypted message content
  timestamp: number;
  signature: string;            // Sender's signature
}

export interface DecryptedMessage {
  messageId: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: number;
  attachments?: MessageAttachment[];
}

export interface MessageAttachment {
  type: 'image' | 'video' | 'document';
  cid: string;                  // IPFS CID
  filename: string;
  size: number;                 // Bytes
  mimeType: string;
}

// ============================================================================
// ACCESS CONTROL
// ============================================================================

export interface ConnectionRequest {
  requestId: string;            // UUID
  requesterId: string;          // PeerId of requester
  requesterName: string;
  requesterPublicKey: string;
  message: string;              // Optional intro message
  timestamp: number;
  signature: string;            // Requester's signature
}

export interface Connection {
  connectionId: string;
  peerId: string;               // Connected peer's ID
  peerName: string;
  publicKey: string;
  status: ConnectionStatus;
  establishedAt: number;
  conversationId?: string;      // Linked conversation
}

export type ConnectionStatus = 
  | 'pending'                   // Request sent, awaiting approval
  | 'accepted'                  // Connection established
  | 'rejected'                  // Request rejected
  | 'blocked';                  // User blocked

export interface AccessPermission {
  peerId: string;               // Who has permission
  permissions: {
    viewFullProfile: boolean;
    viewContactInfo: boolean;
    viewExactLocation: boolean;
    sendMessages: boolean;
  };
  grantedAt: number;
  expiresAt?: number;           // Optional expiry (for paid views)
}

// ============================================================================
// QUERY TYPES
// ============================================================================

export interface ProfileQuery {
  // Skill filters
  skills?: string[];            // Array of skill names (will be hashed for DHT lookup)
  skillCategories?: string[];
  
  // Location filters
  geolocation?: {
    geohash: string;            // Center point
    precision: number;          // Geohash precision
    radiusKm?: number;          // Search radius (triggers neighbor geohash search)
  };
  
  // Demographics
  ageRanges?: AgeRange[];
  
  // Availability
  availability?: AvailabilityStatus[];
  
  // Pricing
  maxHourlyRate?: number;
  minRating?: number;
  
  // Sorting
  sortBy?: 'distance' | 'rating' | 'hourly-rate' | 'experience';
  sortOrder?: 'asc' | 'desc';
  
  // Pagination
  limit?: number;
  offset?: number;
}

export interface ProfileQueryResult {
  // Basic match info (from public profile)
  peerId: string;
  skillHashes: string[];
  geolocation: GeolocationData;
  ageRange: AgeRange;
  availability: AvailabilityStatus;
  
  // Computed fields
  distance?: number;            // Km from search center (if location query)
  matchScore?: number;          // 0-1 relevance score
  
  // Reference for full profile fetch
  privateCID: string;
  publicKey: string;
}

// ============================================================================
// STORAGE TYPES
// ============================================================================

export interface EncryptedProfileBlob {
  version: number;
  encrypted: EncryptedData;     // Encrypted PrivateProfile
  publicKey: string;            // Owner's public key (for verification)
  signature: string;            // Signature of encrypted data
  createdAt: number;
  updatedAt: number;
}

export interface ProfileUpdateEvent {
  type: 'profile-update' | 'profile-delete';
  peerId: string;
  publicProfile: PublicProfile;
  privateCID: string;           // New CID after update
  timestamp: number;
  signature: string;
}

// ============================================================================
// DHT INDEX TYPES
// ============================================================================

export interface DHTIndexEntry {
  indexType: 'skill' | 'geohash' | 'age-range' | 'availability';
  key: string;                  // Hashed key (e.g., hash("fashion-design" + salt))
  values: string[];             // Array of hashed peerIds
  timestamp: number;
  signature: string;            // Network signature (prevents tampering)
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

export function validatePublicProfile(profile: PublicProfile): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!profile.peerId) errors.push('peerId is required');
  if (!profile.publicKey) errors.push('publicKey is required');
  if (!profile.skillHashes || profile.skillHashes.length === 0) {
    errors.push('At least one skill is required');
  }
  if (!profile.geolocation) errors.push('geolocation is required');
  if (!profile.ageRange) errors.push('ageRange is required');
  if (!profile.availability) errors.push('availability is required');
  if (!profile.privateCID) errors.push('privateCID is required');
  if (!profile.signature) errors.push('signature is required');
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validatePrivateProfile(profile: PrivateProfile): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!profile.fullName) errors.push('fullName is required');
  if (!profile.email) errors.push('email is required');
  if (!profile.bio) errors.push('bio is required');
  if (!profile.skills || profile.skills.length === 0) {
    errors.push('At least one skill is required');
  }
  if (!profile.currency) errors.push('currency is required');
  if (!profile.privacySettings) errors.push('privacySettings is required');
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

export function calculateAgeRange(birthYear: number): AgeRange {
  const currentYear = new Date().getFullYear();
  const age = currentYear - birthYear;
  
  if (age < 18) throw new Error('User must be 18+');
  if (age <= 25) return '18-25';
  if (age <= 30) return '25-30';
  if (age <= 40) return '30-40';
  if (age <= 50) return '40-50';
  if (age <= 60) return '50-60';
  if (age <= 70) return '60-70';
  return '70+';
}

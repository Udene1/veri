import type { Libp2p, Stream } from '@libp2p/interface';
import type { PeerId } from '@libp2p/interface';
import { pipe } from 'it-pipe';
import * as lp from 'it-length-prefixed';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import { toString as uint8ArrayToString } from 'uint8arrays/to-string';
import { AccessControlManager } from '../access/access-control.js';
import { decryptSymmetric, encryptForRecipient, verify } from '../crypto/crypto-utils.js';
import type {
  PublicProfile,
  PrivateProfile,
  PrivacySettings,
  EncryptedProfileBlob,
} from '../types/profile-schema.js';

/**
 * Profile Protocol Handler
 * 
 * libp2p protocol: /verimut/profile/1.0.0
 * 
 * Serves user profiles with access control:
 * - Public profiles: Always served (basic search results)
 * - Private profiles: Only served if requester has permission
 * 
 * Request format:
 * {
 *   type: 'public' | 'private',
 *   requesterId: string (PeerId),
 *   signature: string (proves identity),
 *   timestamp: number
 * }
 * 
 * Response format:
 * {
 *   success: boolean,
 *   profile?: PublicProfile | PrivateProfile,
 *   error?: string
 * }
 */

const PROTOCOL_ID = '/verimut/profile/1.0.0';

const logger = {
  info: (...args: any[]) => console.log('[ProfileProtocol]', ...args),
  debug: (...args: any[]) => console.log('[ProfileProtocol]', ...args),
  error: (...args: any[]) => console.error('[ProfileProtocol]', ...args),
};

export class ProfileProtocolHandler {
  private libp2p: Libp2p;
  private acl: AccessControlManager;
  private publicProfile: PublicProfile | null = null;
  private privateProfile: PrivateProfile | null = null;
  private privacySettings: PrivacySettings | null = null;
  private userPrivateKey: string;
  private userPublicKey: string;

  constructor(
    libp2p: Libp2p,
    acl: AccessControlManager,
    userPrivateKey: string,
    userPublicKey: string
  ) {
    this.libp2p = libp2p;
    this.acl = acl;
    this.userPrivateKey = userPrivateKey;
    this.userPublicKey = userPublicKey;
  }

  // ============================================================================
  // PROTOCOL REGISTRATION
  // ============================================================================

  /**
   * Register protocol handler with libp2p
   */
  async start(): Promise<void> {
    await this.libp2p.handle(PROTOCOL_ID, this._handleIncomingStream.bind(this));
    logger.info('Profile protocol handler registered:', PROTOCOL_ID);
  }

  /**
   * Unregister protocol handler
   */
  async stop(): Promise<void> {
    await this.libp2p.unhandle(PROTOCOL_ID);
    logger.info('Profile protocol handler unregistered');
  }

  // ============================================================================
  // PROFILE MANAGEMENT
  // ============================================================================

  /**
   * Set user's profiles (called after profile creation/update)
   */
  setProfiles(
    publicProfile: PublicProfile,
    privateProfile: PrivateProfile,
    privacySettings: PrivacySettings
  ): void {
    this.publicProfile = publicProfile;
    this.privateProfile = privateProfile;
    this.privacySettings = privacySettings;
    logger.info('Profiles updated');
  }

  // ============================================================================
  // INCOMING REQUESTS (Server Side)
  // ============================================================================

  /**
   * Handle incoming profile request from another peer
   */
  private async _handleIncomingStream({ stream }: { stream: Stream }): Promise<void> {
    try {
      await pipe(
        stream,
        lp.decode(),
        async (source) => {
          for await (const msg of source) {
            const requestStr = uint8ArrayToString((msg as any).subarray());
            const request = JSON.parse(requestStr);

            logger.debug('Received profile request:', request.type, 'from', request.requesterId);

            // Validate request
            if (!this._validateRequest(request)) {
              await this._sendResponse(stream, {
                success: false,
                error: 'Invalid request signature',
              });
              return;
            }

            // Handle based on request type
            let response;
            if (request.type === 'public') {
              response = await this._handlePublicProfileRequest(request);
            } else if (request.type === 'private') {
              response = await this._handlePrivateProfileRequest(request);
            } else {
              response = {
                success: false,
                error: 'Unknown request type',
              };
            }

            await this._sendResponse(stream, response);
          }
        }
      );
    } catch (error) {
      logger.error('Error handling incoming stream:', error);
    } finally {
      await stream.close();
    }
  }

  /**
   * Handle request for public profile (always allowed)
   */
  private async _handlePublicProfileRequest(request: any): Promise<any> {
    if (!this.publicProfile) {
      return {
        success: false,
        error: 'Profile not available',
      };
    }

    return {
      success: true,
      profile: this.publicProfile,
    };
  }

  /**
   * Handle request for private profile (permission required)
   */
  private async _handlePrivateProfileRequest(request: any): Promise<any> {
    if (!this.privateProfile || !this.privacySettings) {
      return {
        success: false,
        error: 'Profile not available',
      };
    }

    // Check permissions
    const canView = this.acl.canViewFullProfile(request.requesterId, this.privacySettings);

    if (!canView) {
      return {
        success: false,
        error: 'Permission denied',
      };
    }

    // Filter sensitive data based on specific permissions
    const filteredProfile = this._filterPrivateProfile(request.requesterId);

    // Encrypt for requester
    const encrypted = encryptForRecipient(
      filteredProfile,
      this.userPrivateKey,
      request.requesterPublicKey
    );

    return {
      success: true,
      profile: encrypted,
    };
  }

  /**
   * Filter private profile based on permissions
   */
  private _filterPrivateProfile(requesterId: string): Partial<PrivateProfile> {
    if (!this.privateProfile || !this.privacySettings) {
      throw new Error('Profile not available');
    }

    const filtered: Partial<PrivateProfile> = {
      fullName: this.privateProfile.fullName,
      bio: this.privateProfile.bio,
      skills: this.privateProfile.skills,
      experience: this.privateProfile.experience,
      education: this.privateProfile.education,
      certifications: this.privateProfile.certifications,
      portfolio: this.privateProfile.portfolio,
      hourlyRate: this.privateProfile.hourlyRate,
      currency: this.privateProfile.currency,
      acceptedPaymentMethods: this.privateProfile.acceptedPaymentMethods,
      reviews: this.privateProfile.reviews,
      rating: this.privateProfile.rating,
      totalBookings: this.privateProfile.totalBookings,
      privacySettings: this.privateProfile.privacySettings,
    };

    // Check contact info permission
    const canViewContact = this.acl.canViewContactInfo(requesterId, this.privacySettings);
    if (canViewContact) {
      filtered.email = this.privateProfile.email;
      filtered.phone = this.privateProfile.phone;
    }

    // Check exact location permission
    const canViewLocation = this.acl.canViewExactLocation(requesterId, this.privacySettings);
    if (canViewLocation) {
      filtered.exactLocation = this.privateProfile.exactLocation;
    }

    return filtered;
  }

  /**
   * Validate request signature
   */
  private _validateRequest(request: any): boolean {
    try {
      // Check required fields
      if (!request.type || !request.requesterId || !request.signature || !request.timestamp) {
        return false;
      }

      // Check timestamp (reject requests older than 1 minute)
      const age = Date.now() - request.timestamp;
      if (age > 60000 || age < 0) {
        logger.error('Request timestamp out of range:', age);
        return false;
      }

      // Verify signature
      const payload = JSON.stringify({
        type: request.type,
        requesterId: request.requesterId,
        timestamp: request.timestamp,
      });

      return verify(payload, request.signature, request.requesterPublicKey);
    } catch (error) {
      logger.error('Request validation failed:', error);
      return false;
    }
  }

  /**
   * Send response back to requester
   */
  private async _sendResponse(stream: Stream, response: any): Promise<void> {
    const responseStr = JSON.stringify(response);
    const responseBytes = uint8ArrayFromString(responseStr);

    await pipe(
      [responseBytes],
      lp.encode(),
      stream as any
    );
  }

  // ============================================================================
  // OUTGOING REQUESTS (Client Side)
  // ============================================================================

  /**
   * Request public profile from another peer
   */
  async requestPublicProfile(peerId: PeerId): Promise<PublicProfile | null> {
    try {
      const request = {
        type: 'public',
        requesterId: this.libp2p.peerId.toString(),
        requesterPublicKey: this.userPublicKey,
        timestamp: Date.now(),
        signature: '',
      };

      // Sign request
      const payload = JSON.stringify({
        type: request.type,
        requesterId: request.requesterId,
        timestamp: request.timestamp,
      });
      request.signature = this._signRequest(payload);

      // Open stream to peer
      const stream = await this.libp2p.dialProtocol(peerId, PROTOCOL_ID);

      // Send request and wait for response
      const response = await this._sendRequestAndWaitForResponse(stream, request);

      if (response.success) {
        return response.profile;
      } else {
        logger.error('Failed to get public profile:', response.error);
        return null;
      }
    } catch (error) {
      logger.error('Error requesting public profile:', error);
      return null;
    }
  }

  /**
   * Request private profile from another peer (requires permission)
   */
  async requestPrivateProfile(
    peerId: PeerId,
    theirPublicKey: string
  ): Promise<PrivateProfile | null> {
    try {
      const request = {
        type: 'private',
        requesterId: this.libp2p.peerId.toString(),
        requesterPublicKey: this.userPublicKey,
        timestamp: Date.now(),
        signature: '',
      };

      // Sign request
      const payload = JSON.stringify({
        type: request.type,
        requesterId: request.requesterId,
        timestamp: request.timestamp,
      });
      request.signature = this._signRequest(payload);

      // Open stream to peer
      const stream = await this.libp2p.dialProtocol(peerId, PROTOCOL_ID);

      // Send request and wait for response
      const response = await this._sendRequestAndWaitForResponse(stream, request);

      if (response.success) {
        // Decrypt profile
        const decrypted = this._decryptProfile(response.profile, theirPublicKey);
        return decrypted;
      } else {
        logger.error('Failed to get private profile:', response.error);
        return null;
      }
    } catch (error) {
      logger.error('Error requesting private profile:', error);
      return null;
    }
  }

  /**
   * Send request and wait for response
   */
  private async _sendRequestAndWaitForResponse(stream: Stream, request: any): Promise<any> {
    const requestStr = JSON.stringify(request);
    const requestBytes = uint8ArrayFromString(requestStr);

    let response: any = null;

    await pipe(
      [requestBytes],
      lp.encode(),
      stream as any,
      lp.decode(),
      async (source) => {
        for await (const msg of source) {
          const responseStr = uint8ArrayToString((msg as any).subarray());
          response = JSON.parse(responseStr);
        }
      }
    );

    await stream.close();
    return response;
  }

  /**
   * Sign a request
   */
  private _signRequest(payload: string): string {
    const crypto = require('crypto');
    return crypto
      .createHmac('sha256', this.userPrivateKey)
      .update(payload)
      .digest('base64');
  }

  /**
   * Decrypt received profile
   */
  private _decryptProfile(encrypted: any, senderPublicKey: string): PrivateProfile {
    const crypto = require('crypto');
    const sharedSecret = crypto
      .createHash('sha256')
      .update(this.userPrivateKey + senderPublicKey)
      .digest('base64');

    return decryptSymmetric(encrypted, sharedSecret);
  }

  // ============================================================================
  // UTILITIES
  // ============================================================================

  /**
   * Check if protocol is registered
   */
  isRegistered(): boolean {
    return this.libp2p.getProtocols().includes(PROTOCOL_ID);
  }

  /**
   * Get protocol ID
   */
  getProtocolId(): string {
    return PROTOCOL_ID;
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Create and start profile protocol handler
 */
export async function createProfileProtocol(
  libp2p: Libp2p,
  acl: AccessControlManager,
  privateKey: string,
  publicKey: string
): Promise<ProfileProtocolHandler> {
  const handler = new ProfileProtocolHandler(libp2p, acl, privateKey, publicKey);
  await handler.start();
  return handler;
}

import type { PeerId } from '@libp2p/interface';
import {
  sign,
  verify,
  encryptForRecipient,
  decryptFromSender,
} from '../crypto/crypto-utils.js';
import type {
  ConnectionRequest,
  Connection,
  ConnectionStatus,
  AccessPermission,
  PrivacySettings,
} from '../types/profile-schema.js';
import { randomUUID } from 'crypto';

/**
 * Access Control Manager
 * 
 * Manages connection requests, approvals, and permission checking.
 * Ensures that profiles are only shared with authorized users.
 * 
 * Security model:
 * - All connection requests are signed (prevents impersonation)
 * - Connections require explicit approval
 * - Permissions can be revoked at any time
 * - Paid views have expiry timestamps
 */

export class AccessControlManager {
  private peerId: PeerId;
  private privateKey: string;
  private publicKey: string;

  // Storage
  private connections: Map<string, Connection> = new Map(); // peerId → Connection
  private permissions: Map<string, AccessPermission> = new Map(); // peerId → Permission
  private pendingRequests: Map<string, ConnectionRequest> = new Map(); // requestId → Request

  constructor(peerId: PeerId, privateKey: string, publicKey: string) {
    this.peerId = peerId;
    this.privateKey = privateKey;
    this.publicKey = publicKey;
  }

  // ============================================================================
  // CONNECTION REQUESTS
  // ============================================================================

  /**
   * Create a connection request to send to another user
   */
  createConnectionRequest(
    targetPeerId: string,
    myName: string,
    message?: string
  ): ConnectionRequest {
    const request: ConnectionRequest = {
      requestId: randomUUID(),
      requesterId: this.peerId.toString(),
      requesterName: myName,
      requesterPublicKey: this.publicKey,
      message: message || '',
      timestamp: Date.now(),
      signature: '',
    };

    // Sign the request
    const payload = JSON.stringify({
      requestId: request.requestId,
      requesterId: request.requesterId,
      timestamp: request.timestamp,
    });
    request.signature = sign(payload, this.privateKey);

    return request;
  }

  /**
   * Validate an incoming connection request
   */
  validateConnectionRequest(request: ConnectionRequest): boolean {
    try {
      // Verify signature
      const payload = JSON.stringify({
        requestId: request.requestId,
        requesterId: request.requesterId,
        timestamp: request.timestamp,
      });

      if (!verify(payload, request.signature, request.requesterPublicKey)) {
        console.error('[AccessControl] Invalid signature on connection request');
        return false;
      }

      // Check timestamp (reject requests older than 1 hour)
      const age = Date.now() - request.timestamp;
      if (age > 3600000) {
        console.error('[AccessControl] Connection request expired');
        return false;
      }

      return true;
    } catch (error) {
      console.error('[AccessControl] Failed to validate connection request:', error);
      return false;
    }
  }

  /**
   * Store a pending connection request
   */
  addPendingRequest(request: ConnectionRequest): void {
    if (this.validateConnectionRequest(request)) {
      this.pendingRequests.set(request.requestId, request);
      console.log(`[AccessControl] Stored pending request from ${request.requesterName}`);
    }
  }

  /**
   * Get all pending requests
   */
  getPendingRequests(): ConnectionRequest[] {
    return Array.from(this.pendingRequests.values());
  }

  /**
   * Approve a connection request
   */
  approveConnection(
    requestId: string,
    myName: string,
    permissions: Partial<AccessPermission['permissions']> = {}
  ): Connection | null {
    const request = this.pendingRequests.get(requestId);
    if (!request) {
      console.error('[AccessControl] Request not found:', requestId);
      return null;
    }

    // Create connection
    const connection: Connection = {
      connectionId: randomUUID(),
      peerId: request.requesterId,
      peerName: request.requesterName,
      publicKey: request.requesterPublicKey,
      status: 'accepted',
      establishedAt: Date.now(),
    };

    // Set permissions
    const defaultPermissions: AccessPermission = {
      peerId: request.requesterId,
      permissions: {
        viewFullProfile: permissions.viewFullProfile ?? true,
        viewContactInfo: permissions.viewContactInfo ?? false,
        viewExactLocation: permissions.viewExactLocation ?? false,
        sendMessages: permissions.sendMessages ?? true,
      },
      grantedAt: Date.now(),
    };

    this.connections.set(request.requesterId, connection);
    this.permissions.set(request.requesterId, defaultPermissions);
    this.pendingRequests.delete(requestId);

    console.log(`[AccessControl] Approved connection with ${request.requesterName}`);
    return connection;
  }

  /**
   * Reject a connection request
   */
  rejectConnection(requestId: string): void {
    const request = this.pendingRequests.get(requestId);
    if (request) {
      this.pendingRequests.delete(requestId);
      console.log(`[AccessControl] Rejected connection request from ${request.requesterName}`);
    }
  }

  // ============================================================================
  // CONNECTION MANAGEMENT
  // ============================================================================

  /**
   * Get a connection by peer ID
   */
  getConnection(peerId: string): Connection | undefined {
    return this.connections.get(peerId);
  }

  /**
   * Get all connections
   */
  getAllConnections(): Connection[] {
    return Array.from(this.connections.values());
  }

  /**
   * Remove a connection (disconnect)
   */
  removeConnection(peerId: string): void {
    this.connections.delete(peerId);
    this.permissions.delete(peerId);
    console.log(`[AccessControl] Removed connection: ${peerId}`);
  }

  /**
   * Block a user
   */
  blockUser(peerId: string): void {
    const connection = this.connections.get(peerId);
    if (connection) {
      connection.status = 'blocked';
      this.permissions.delete(peerId); // Revoke all permissions
      console.log(`[AccessControl] Blocked user: ${peerId}`);
    }
  }

  // ============================================================================
  // PERMISSION CHECKING
  // ============================================================================

  /**
   * Check if a peer has permission to view full profile
   */
  canViewFullProfile(peerId: string, privacySettings: PrivacySettings): boolean {
    // Public profiles
    if (privacySettings.profileVisibility === 'public') {
      return true;
    }

    // Connections-only
    if (privacySettings.profileVisibility === 'connections-only') {
      const permission = this.permissions.get(peerId);
      return permission?.permissions.viewFullProfile ?? false;
    }

    // Paid view (check expiry)
    if (privacySettings.profileVisibility === 'paid-view') {
      const permission = this.permissions.get(peerId);
      if (!permission) return false;

      // Check expiry
      if (permission.expiresAt && permission.expiresAt < Date.now()) {
        return false;
      }

      return permission.permissions.viewFullProfile;
    }

    return false;
  }

  /**
   * Check if a peer can view contact info
   */
  canViewContactInfo(peerId: string, privacySettings: PrivacySettings): boolean {
    if (!privacySettings.showContactInfoAfterConnection) {
      return false;
    }

    const permission = this.permissions.get(peerId);
    return permission?.permissions.viewContactInfo ?? false;
  }

  /**
   * Check if a peer can view exact location
   */
  canViewExactLocation(peerId: string, privacySettings: PrivacySettings): boolean {
    if (!privacySettings.showExactLocationAfterConnection) {
      return false;
    }

    const permission = this.permissions.get(peerId);
    return permission?.permissions.viewExactLocation ?? false;
  }

  /**
   * Check if a peer can send messages
   */
  canSendMessages(peerId: string, privacySettings: PrivacySettings): boolean {
    if (privacySettings.messagePermissions === 'no-one') {
      return false;
    }

    if (privacySettings.messagePermissions === 'anyone') {
      return true;
    }

    // Connections-only
    const permission = this.permissions.get(peerId);
    return permission?.permissions.sendMessages ?? false;
  }

  /**
   * Grant paid view access (with expiry)
   */
  grantPaidViewAccess(peerId: string, durationMs: number = 2592000000): void {
    // Default: 30 days
    const permission: AccessPermission = {
      peerId,
      permissions: {
        viewFullProfile: true,
        viewContactInfo: false,
        viewExactLocation: false,
        sendMessages: false,
      },
      grantedAt: Date.now(),
      expiresAt: Date.now() + durationMs,
    };

    this.permissions.set(peerId, permission);
    console.log(`[AccessControl] Granted paid view access to ${peerId} (expires in ${durationMs}ms)`);
  }

  /**
   * Update permissions for an existing connection
   */
  updatePermissions(
    peerId: string,
    updates: Partial<AccessPermission['permissions']>
  ): void {
    const existing = this.permissions.get(peerId);
    if (!existing) {
      console.error('[AccessControl] No permission found for peer:', peerId);
      return;
    }

    existing.permissions = { ...existing.permissions, ...updates };
    this.permissions.set(peerId, existing);
    console.log(`[AccessControl] Updated permissions for ${peerId}`);
  }

  // ============================================================================
  // PERSISTENCE (for integration with VerimutLog)
  // ============================================================================

  /**
   * Export connections and permissions for storage
   */
  exportState(): {
    connections: Connection[];
    permissions: AccessPermission[];
    pendingRequests: ConnectionRequest[];
  } {
    return {
      connections: Array.from(this.connections.values()),
      permissions: Array.from(this.permissions.values()),
      pendingRequests: Array.from(this.pendingRequests.values()),
    };
  }

  /**
   * Import connections and permissions from storage
   */
  importState(state: {
    connections?: Connection[];
    permissions?: AccessPermission[];
    pendingRequests?: ConnectionRequest[];
  }): void {
    if (state.connections) {
      this.connections.clear();
      for (const conn of state.connections) {
        this.connections.set(conn.peerId, conn);
      }
    }

    if (state.permissions) {
      this.permissions.clear();
      for (const perm of state.permissions) {
        this.permissions.set(perm.peerId, perm);
      }
    }

    if (state.pendingRequests) {
      this.pendingRequests.clear();
      for (const req of state.pendingRequests) {
        this.pendingRequests.set(req.requestId, req);
      }
    }

    console.log('[AccessControl] Imported state');
  }

  // ============================================================================
  // UTILITIES
  // ============================================================================

  /**
   * Get statistics
   */
  getStats(): {
    totalConnections: number;
    pendingRequests: number;
    grantedPermissions: number;
  } {
    return {
      totalConnections: this.connections.size,
      pendingRequests: this.pendingRequests.size,
      grantedPermissions: this.permissions.size,
    };
  }
}

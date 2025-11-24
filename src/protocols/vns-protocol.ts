/**
 * VNS Protocol Handler
 * 
 * libp2p stream protocol for VNS operations: /verimut/vns/1.0.0
 * Handles register, resolve, and transfer requests
 */

import { pipe } from 'it-pipe';
import type { VNSNamespaceStore } from '../vns/namespace-store.js';
import type { VNSRegistration } from '../types/vns-schema.js';

/**
 * Protocol request types
 */
export type VNSRequestType = 'register' | 'resolve' | 'transfer' | 'query' | 'ping';

/**
 * Base request interface
 */
export interface VNSRequest {
  type: VNSRequestType;
  requestId?: string; // Optional for tracking
}

/**
 * Register request
 */
export interface VNSRegisterRequest extends VNSRequest {
  type: 'register';
  registration: VNSRegistration;
  peerId: string;
}

/**
 * Resolve request
 */
export interface VNSResolveRequest extends VNSRequest {
  type: 'resolve';
  name: string;
}

/**
 * Transfer request
 */
export interface VNSTransferRequest extends VNSRequest {
  type: 'transfer';
  name: string;
  newOwner: string;
  signature: string;
  peerId: string;
}

/**
 * Query request (get names by owner)
 */
export interface VNSQueryRequest extends VNSRequest {
  type: 'query';
  owner: string;
}

/**
 * Ping request (health check)
 */
export interface VNSPingRequest extends VNSRequest {
  type: 'ping';
}

/**
 * Generic response
 */
export interface VNSResponse {
  success: boolean;
  error?: string;
  data?: any;
}

/**
 * VNS Protocol Handler
 */
export class VNSProtocolHandler {
  private libp2p: any;
  private store: VNSNamespaceStore;
  private protocol = '/verimut/vns/1.0.0';
  private running = false;

  constructor(libp2p: any, store: VNSNamespaceStore) {
    this.libp2p = libp2p;
    this.store = store;
  }

  /**
   * Start the protocol handler
   */
  async start(): Promise<void> {
    if (this.running) return;

    if (!this.libp2p || typeof this.libp2p.handle !== 'function') {
      console.warn('[VNS Protocol] libp2p not available, skipping protocol handler');
      return;
    }

    try {
      await this.libp2p.handle(this.protocol, async ({ stream, connection }: any) => {
        await this.handleStream(stream, connection);
      });

      this.running = true;
      console.log(`[VNS Protocol] Handler started on ${this.protocol}`);
    } catch (e) {
      console.error('[VNS Protocol] Failed to start handler:', e);
    }
  }

  /**
   * Stop the protocol handler
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    try {
      if (this.libp2p && typeof this.libp2p.unhandle === 'function') {
        await this.libp2p.unhandle(this.protocol);
      }
      this.running = false;
      console.log('[VNS Protocol] Handler stopped');
    } catch (e) {
      console.error('[VNS Protocol] Failed to stop handler:', e);
    }
  }

  /**
   * Handle incoming stream
   */
  private async handleStream(stream: any, connection: any): Promise<void> {
    try {
      // Read request
      const request = await this.readRequest(stream);
      
      // Get peer ID from connection
      const peerId = connection?.remotePeer?.toString?.() || 'unknown';

      // Process request
      const response = await this.processRequest(request, peerId);

      // Send response
      await this.sendResponse(stream, response);
    } catch (e) {
      console.error('[VNS Protocol] Stream handling error:', e);
      
      // Try to send error response
      try {
        await this.sendResponse(stream, {
          success: false,
          error: e instanceof Error ? e.message : 'Unknown error'
        });
      } catch (e2) {
        // Ignore secondary errors
      }
    }
  }

  /**
   * Read request from stream
   */
  private async readRequest(stream: any): Promise<VNSRequest> {
    const chunks: Uint8Array[] = [];
    
    for await (const chunk of stream.source) {
      chunks.push(Buffer.from(chunk.subarray ? chunk.subarray() : chunk));
    }

    const data = Buffer.concat(chunks).toString('utf8');
    return JSON.parse(data);
  }

  /**
   * Send response to stream
   */
  private async sendResponse(stream: any, response: VNSResponse): Promise<void> {
    const data = Buffer.from(JSON.stringify(response), 'utf8');
    await pipe([data], stream.sink);
  }

  /**
   * Process a VNS request
   */
  private async processRequest(request: VNSRequest, peerId: string): Promise<VNSResponse> {
    try {
      switch (request.type) {
        case 'register':
          return await this.handleRegister(request as VNSRegisterRequest, peerId);
        
        case 'resolve':
          return await this.handleResolve(request as VNSResolveRequest);
        
        case 'transfer':
          return await this.handleTransfer(request as VNSTransferRequest, peerId);
        
        case 'query':
          return await this.handleQuery(request as VNSQueryRequest);
        
        case 'ping':
          return this.handlePing();
        
        default:
          return {
            success: false,
            error: `Unknown request type: ${(request as any).type}`
          };
      }
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : 'Unknown error'
      };
    }
  }

  /**
   * Handle register request
   */
  private async handleRegister(request: VNSRegisterRequest, peerId: string): Promise<VNSResponse> {
    const result = await this.store.register(request.registration, peerId);
    
    return {
      success: result.success,
      error: result.error,
      data: result.success ? { cid: result.cid } : undefined
    };
  }

  /**
   * Handle resolve request
   */
  private async handleResolve(request: VNSResolveRequest): Promise<VNSResponse> {
    const result = await this.store.resolve(request.name);
    
    return {
      success: result.found,
      error: result.error,
      data: result.found ? {
        name: result.name,
        records: result.records,
        owner: result.owner,
        expires: result.expires,
        ttl: result.ttl
      } : undefined
    };
  }

  /**
   * Handle transfer request
   */
  private async handleTransfer(request: VNSTransferRequest, peerId: string): Promise<VNSResponse> {
    const result = await this.store.transfer(
      request.name,
      request.newOwner,
      request.signature,
      peerId
    );
    
    return {
      success: result.success,
      error: result.error
    };
  }

  /**
   * Handle query request (get names by owner)
   */
  private async handleQuery(request: VNSQueryRequest): Promise<VNSResponse> {
    const names = this.store.getNamesByOwner(request.owner);
    
    return {
      success: true,
      data: { names }
    };
  }

  /**
   * Handle ping request
   */
  private handlePing(): VNSResponse {
    return {
      success: true,
      data: {
        protocol: this.protocol,
        enabled: this.store.isEnabled(),
        entries: this.store.size(),
        merkleRoot: this.store.getMerkleRoot(),
        timestamp: Date.now()
      }
    };
  }

  /**
   * Make a VNS request to a remote peer
   */
  async makeRequest(peerId: string, request: VNSRequest): Promise<VNSResponse> {
    if (!this.libp2p || typeof this.libp2p.dialProtocol !== 'function') {
      throw new Error('libp2p not available');
    }

    try {
      const { stream } = await this.libp2p.dialProtocol(peerId, this.protocol);
      
      // Send request
      const requestData = Buffer.from(JSON.stringify(request), 'utf8');
      await pipe([requestData], stream.sink);

      // Read response
      const chunks: Uint8Array[] = [];
      for await (const chunk of stream.source) {
        chunks.push(Buffer.from(chunk.subarray ? chunk.subarray() : chunk));
      }

      const responseData = Buffer.concat(chunks).toString('utf8');
      return JSON.parse(responseData);
    } catch (e) {
      throw new Error(`VNS request failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  }

  /**
   * Check if protocol is running
   */
  isRunning(): boolean {
    return this.running;
  }
}

/**
 * Helper function to setup VNS protocol on a node
 */
export async function setupVNSProtocol(
  libp2p: any,
  store: VNSNamespaceStore
): Promise<VNSProtocolHandler> {
  const handler = new VNSProtocolHandler(libp2p, store);
  await handler.start();
  return handler;
}

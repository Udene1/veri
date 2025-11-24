/**
 * HTTP-based P2P Communication Module
 * 
 * Provides HTTP-based delta propagation as a complement to libp2p pubsub.
 * This module enables multi-node VNS sync when libp2p gossipsub is unavailable.
 * 
 * Architecture:
 * - Integrates with VerimutSync via standard interface
 * - Uses HTTP POST to push deltas to bootstrap peers
 * - Receives deltas via /api/vns/push-delta endpoint
 * - Maintains same security model (Ed25519, PoW, LWW)
 */

import type { PeerId } from '@libp2p/interface';

export interface HTTPP2PConfig {
  /**
   * Bootstrap peer URLs for HTTP-based communication
   * Example: ['http://node1.example.com:3001', 'http://node2.example.com:3001']
   */
  bootstrapPeers: string[];
  
  /**
   * Local peer ID for identifying the source of deltas
   */
  peerId?: PeerId;
  
  /**
   * Enable verbose logging
   */
  verbose?: boolean;
}

export interface VNSDelta {
  type: 'register' | 'update' | 'expire';
  entry: any;
  peerId: string;
  timestamp: number;
  fromPeer?: string;
}

/**
 * HTTP P2P Manager
 * Handles HTTP-based delta propagation to other nodes
 */
export class HTTPP2P {
  private bootstrapPeers: string[];
  private peerId?: PeerId;
  private verbose: boolean;

  constructor(config: HTTPP2PConfig) {
    this.bootstrapPeers = config.bootstrapPeers;
    this.peerId = config.peerId;
    this.verbose = config.verbose ?? false;
    
    if (this.verbose) {
      console.log(`[HTTPP2P] Initialized with ${this.bootstrapPeers.length} bootstrap peer(s)`);
    }
  }

  /**
   * Push a VNS delta to all bootstrap peers via HTTP POST
   */
  async pushDelta(delta: VNSDelta): Promise<{ success: boolean; results: Array<{ peer: string; success: boolean; error?: string }> }> {
    const results: Array<{ peer: string; success: boolean; error?: string }> = [];
    
    if (this.bootstrapPeers.length === 0) {
      if (this.verbose) {
        console.warn('[HTTPP2P] No bootstrap peers configured, skipping HTTP push');
      }
      return { success: false, results };
    }

    if (this.verbose) {
      console.log(`[HTTPP2P] Pushing delta to ${this.bootstrapPeers.length} peer(s): ${delta.type} for ${delta.entry.name}`);
    }

    // Add source peer ID to delta
    const deltaWithPeer = {
      ...delta,
      fromPeer: this.peerId?.toString() || 'unknown'
    };

    // Push to all bootstrap peers in parallel
    const pushPromises = this.bootstrapPeers.map(async (peerUrl) => {
      try {
        const fetch = (await import('node-fetch')).default;
        const response = await fetch(`${peerUrl}/api/vns/push-delta`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(deltaWithPeer),
          signal: AbortSignal.timeout(5000) // 5 second timeout
        });

        if (response.ok) {
          if (this.verbose) {
            console.log(`[HTTPP2P] ✓ Successfully pushed to ${peerUrl}`);
          }
          results.push({ peer: peerUrl, success: true });
          return true;
        } else {
          const errorText = await response.text().catch(() => 'Unknown error');
          console.warn(`[HTTPP2P] ✗ Failed to push to ${peerUrl}: ${response.status} ${errorText}`);
          results.push({ peer: peerUrl, success: false, error: `HTTP ${response.status}` });
          return false;
        }
      } catch (e: any) {
        console.warn(`[HTTPP2P] ✗ Error pushing to ${peerUrl}:`, e.message);
        results.push({ peer: peerUrl, success: false, error: e.message });
        return false;
      }
    });

    const pushResults = await Promise.allSettled(pushPromises);
    const successCount = pushResults.filter(r => r.status === 'fulfilled' && r.value).length;
    
    if (this.verbose) {
      console.log(`[HTTPP2P] Push completed: ${successCount}/${this.bootstrapPeers.length} successful`);
    }

    return {
      success: successCount > 0,
      results
    };
  }

  /**
   * Update bootstrap peers list
   */
  updateBootstrapPeers(peers: string[]): void {
    this.bootstrapPeers = peers;
    if (this.verbose) {
      console.log(`[HTTPP2P] Updated bootstrap peers: ${peers.length} peer(s)`);
    }
  }

  /**
   * Get current bootstrap peers
   */
  getBootstrapPeers(): string[] {
    return [...this.bootstrapPeers];
  }

  /**
   * Check if HTTP P2P is available (has bootstrap peers)
   */
  isAvailable(): boolean {
    return this.bootstrapPeers.length > 0;
  }
}

/**
 * Factory function to create HTTPP2P instance
 */
export function createHTTPP2P(config: HTTPP2PConfig): HTTPP2P {
  return new HTTPP2P(config);
}

/**
 * Parse HTTP_BOOTSTRAP_PEERS environment variable
 * Supports comma-separated URLs and validates format
 */
export function parseBootstrapPeers(envVar: string | undefined): string[] {
  if (!envVar) return [];
  
  return envVar
    .split(',')
    .map(url => url.trim())
    .filter(url => {
      // Validate URL format
      try {
        new URL(url);
        return true;
      } catch {
        console.warn(`[HTTPP2P] Invalid bootstrap peer URL: ${url}`);
        return false;
      }
    });
}

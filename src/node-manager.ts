/**
 * VerimutFS Node Manager
 * Manages the lifecycle of a VerimutFS P2P node
 */

import * as fs from 'fs';
import * as http from 'http';
import type { NodeConfig } from './config.js';
import { createNode, stopNode, type NodeBundle } from './networking/peer.js';
import { createApiServer } from './api/http-server.js';

export class VerimutNode {
  private config: NodeConfig;
  private nodeBundle: NodeBundle | null = null;
  private apiServer: http.Server | null = null;

  constructor(config: NodeConfig) {
    this.config = config;
  }

  /**
   * Start the node
   */
  async start(): Promise<void> {
    if (this.config.verbose) {
      console.log('Initializing VerimutFS node...');
    }

    // Set environment variable for VNS if enabled
    if (this.config.enableVNS) {
      process.env.ENABLE_VNS = 'true';
    }

    // Create the node bundle (libp2p + helia + all services)
    this.nodeBundle = await createNode(this.config.bootstrapPeers);

    // Start API server if port is configured
    if (this.config.apiPort && this.nodeBundle) {
      this.apiServer = createApiServer({
        port: this.config.apiPort,
        nodeBundle: this.nodeBundle
      });
    }

    if (this.config.verbose) {
      console.log('Node started successfully');
    }
  }

  /**
   * Stop the node
   */
  async stop(): Promise<void> {
    // Stop API server first
    if (this.apiServer) {
      await new Promise<void>((resolve) => {
        this.apiServer!.close(() => resolve());
      });
      this.apiServer = null;
    }

    // Stop node
    if (this.nodeBundle) {
      await stopNode(this.nodeBundle);
      this.nodeBundle = null;
    }
  }

  /**
   * Get peer ID
   */
  get peerId(): string {
    return this.nodeBundle?.libp2p?.peerId?.toString() || '';
  }

  /**
   * Get listen addresses
   */
  get addresses(): string[] {
    try {
      return this.nodeBundle?.libp2p?.getMultiaddrs()?.map((ma: any) => ma.toString()) || [];
    } catch (e) {
      return [];
    }
  }

  /**
   * Get connected peers
   */
  getConnectedPeers(): string[] {
    try {
      return this.nodeBundle?.libp2p?.getPeers()?.map((p: any) => p.toString()) || [];
    } catch (e) {
      return [];
    }
  }

  /**
   * Load and publish profile from file
   */
  async loadAndPublishProfile(filePath: string): Promise<void> {
    if (!this.nodeBundle) {
      throw new Error('Node not started');
    }

    const profileData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    
    // TODO: Implement profile publishing through the verimut bundle
    // This would use this.nodeBundle.verimut to publish the profile
    console.log('Profile loaded:', profileData.publicProfile?.skillHashes?.length || 0, 'skills');
  }

  /**
   * Search for providers (placeholder)
   */
  async searchNearby(lat: number, lng: number, radiusKm: number, skills: string[] = []) {
    if (!this.nodeBundle) {
      throw new Error('Node not started');
    }

    // TODO: Implement search through query engine
    console.log(`Searching within ${radiusKm}km of ${lat},${lng} for skills:`, skills);
    return [];
  }

  /**
   * Get the underlying node bundle for advanced usage
   */
  get bundle(): NodeBundle | null {
    return this.nodeBundle;
  }

  /**
   * Get libp2p instance
   */
  get libp2p(): any {
    return this.nodeBundle?.libp2p || null;
  }

  /**
   * Get helia instance
   */
  get helia(): any {
    return this.nodeBundle?.helia || null;
  }

  /**
   * Get verimut services (log, sync, blocks)
   */
  get verimut(): any {
    return this.nodeBundle?.verimut || null;
  }
}

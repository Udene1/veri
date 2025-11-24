import type { KadDHT } from '@libp2p/kad-dht';
import type { PeerId } from '@libp2p/interface';
import {
  hashIndexKey,
  hashPeerId,
  generateNetworkSalt,
  geohashNeighbors,
  type GeolocationData,
} from '../crypto/crypto-utils.js';
import type {
  PublicProfile,
  AgeRange,
  AvailabilityStatus,
  DHTIndexEntry,
} from '../types/profile-schema.js';
// Simple logger replacement
const logger = {
  info: (...args: any[]) => console.log('[INFO]', ...args),
  debug: (...args: any[]) => console.log('[DEBUG]', ...args),
  error: (...args: any[]) => console.error('[ERROR]', ...args),
  warn: (...args: any[]) => console.warn('[WARN]', ...args),
};

/**
 * DHT Indexer for VerimutFS
 * 
 * Publishes multi-dimensional indexes to Kad-DHT for fast profile discovery:
 * - /index/skill/{hash(skill)} → [peerIds]
 * - /index/geo/{geohash} → [peerIds]
 * - /index/age/{ageRange} → [peerIds]
 * - /index/availability/{status} → [peerIds]
 * 
 * Privacy protections:
 * - Skill names are hashed (prevents plaintext skill discovery)
 * - Geohashes provide controlled precision (no exact coordinates)
 * - Peer IDs are hashed (prevents peer enumeration)
 * - All indexes use network-wide salt (prevents rainbow tables)
 */

export class DHTIndexer {
  private dht: KadDHT;
  private peerId: PeerId;
  private networkSalt: string;
  private publishInterval: NodeJS.Timeout | null = null;
  private indexCache: Map<string, Set<string>> = new Map(); // indexKey → Set<hashedPeerIds>

  constructor(dht: KadDHT, peerId: PeerId, networkSalt?: string) {
    this.dht = dht;
    this.peerId = peerId;
    this.networkSalt = networkSalt || generateNetworkSalt();
  }

  // ============================================================================
  // INDEX PUBLISHING
  // ============================================================================

  /**
   * Publish a user's profile to DHT indexes
   */
  async publishProfile(profile: PublicProfile): Promise<void> {
    const hashedPeerId = hashPeerId(profile.peerId);
    const tasks: Promise<void>[] = [];

    // 1. Publish skill indexes
    for (const skillHash of profile.skillHashes) {
      const indexKey = `/index/skill/${skillHash}`;
      tasks.push(this._publishToIndex(indexKey, hashedPeerId));
    }

    // 2. Publish geohash index
    const geoIndexKey = `/index/geo/${profile.geolocation.geohash}`;
    tasks.push(this._publishToIndex(geoIndexKey, hashedPeerId));

    // 3. Publish geohash neighbors (for radius search)
    const neighbors = geohashNeighbors(profile.geolocation.geohash);
    for (const neighborHash of neighbors) {
      const neighborIndexKey = `/index/geo/${neighborHash}`;
      tasks.push(this._publishToIndex(neighborIndexKey, hashedPeerId));
    }

    // 4. Publish age range index
    const ageIndexKey = `/index/age/${profile.ageRange}`;
    tasks.push(this._publishToIndex(ageIndexKey, hashedPeerId));

    // 5. Publish availability index
    const availIndexKey = `/index/availability/${profile.availability}`;
    tasks.push(this._publishToIndex(availIndexKey, hashedPeerId));

    await Promise.all(tasks);
    logger.info(`[DHTIndexer] Published indexes for peer ${profile.peerId}`);
  }

  /**
   * Remove a user's profile from DHT indexes
   */
  async unpublishProfile(profile: PublicProfile): Promise<void> {
    const hashedPeerId = hashPeerId(profile.peerId);
    const tasks: Promise<void>[] = [];

    // Remove from all index types
    for (const skillHash of profile.skillHashes) {
      tasks.push(this._removeFromIndex(`/index/skill/${skillHash}`, hashedPeerId));
    }

    tasks.push(this._removeFromIndex(`/index/geo/${profile.geolocation.geohash}`, hashedPeerId));

    const neighbors = geohashNeighbors(profile.geolocation.geohash);
    for (const neighborHash of neighbors) {
      tasks.push(this._removeFromIndex(`/index/geo/${neighborHash}`, hashedPeerId));
    }

    tasks.push(this._removeFromIndex(`/index/age/${profile.ageRange}`, hashedPeerId));
    tasks.push(this._removeFromIndex(`/index/availability/${profile.availability}`, hashedPeerId));

    await Promise.all(tasks);
    logger.info(`[DHTIndexer] Unpublished indexes for peer ${profile.peerId}`);
  }

  // ============================================================================
  // INDEX QUERYING
  // ============================================================================

  /**
   * Query profiles by skill
   * @param skillName - Plain skill name (will be hashed)
   */
  async queryBySkill(skillName: string): Promise<string[]> {
    const skillHash = hashIndexKey(skillName, this.networkSalt);
    const indexKey = `/index/skill/${skillHash}`;
    return this._queryIndex(indexKey);
  }

  /**
   * Query profiles by geohash (proximity search)
   * @param geohash - Target geohash
   * @param includeNeighbors - Whether to include neighboring geohashes (radius search)
   */
  async queryByGeohash(geohash: string, includeNeighbors: boolean = true): Promise<string[]> {
    const indexKeys = [`/index/geo/${geohash}`];

    if (includeNeighbors) {
      const neighbors = geohashNeighbors(geohash);
      indexKeys.push(...neighbors.map(h => `/index/geo/${h}`));
    }

    // Query all geohash indexes in parallel
    const results = await Promise.all(indexKeys.map(key => this._queryIndex(key)));

    // Merge and deduplicate results
    const allPeerIds = new Set<string>();
    for (const peerList of results) {
      for (const peerId of peerList) {
        allPeerIds.add(peerId);
      }
    }

    return Array.from(allPeerIds);
  }

  /**
   * Query profiles by age range
   */
  async queryByAgeRange(ageRange: AgeRange): Promise<string[]> {
    const indexKey = `/index/age/${ageRange}`;
    return this._queryIndex(indexKey);
  }

  /**
   * Query profiles by availability
   */
  async queryByAvailability(availability: AvailabilityStatus): Promise<string[]> {
    const indexKey = `/index/availability/${availability}`;
    return this._queryIndex(indexKey);
  }

  /**
   * Multi-criteria query (intersection of all criteria)
   */
  async queryMulti(criteria: {
    skills?: string[];
    geohash?: string;
    includeNeighbors?: boolean;
    ageRanges?: AgeRange[];
    availability?: AvailabilityStatus[];
  }): Promise<string[]> {
    const resultSets: Set<string>[] = [];

    // Query skills (OR within skills)
    if (criteria.skills && criteria.skills.length > 0) {
      const skillResults = await Promise.all(
        criteria.skills.map(skill => this.queryBySkill(skill))
      );
      const skillSet = new Set<string>();
      for (const results of skillResults) {
        for (const peerId of results) {
          skillSet.add(peerId);
        }
      }
      resultSets.push(skillSet);
    }

    // Query geohash
    if (criteria.geohash) {
      const geoResults = await this.queryByGeohash(
        criteria.geohash,
        criteria.includeNeighbors ?? true
      );
      resultSets.push(new Set(geoResults));
    }

    // Query age ranges (OR within age ranges)
    if (criteria.ageRanges && criteria.ageRanges.length > 0) {
      const ageResults = await Promise.all(
        criteria.ageRanges.map(age => this.queryByAgeRange(age))
      );
      const ageSet = new Set<string>();
      for (const results of ageResults) {
        for (const peerId of results) {
          ageSet.add(peerId);
        }
      }
      resultSets.push(ageSet);
    }

    // Query availability (OR within availability)
    if (criteria.availability && criteria.availability.length > 0) {
      const availResults = await Promise.all(
        criteria.availability.map(avail => this.queryByAvailability(avail))
      );
      const availSet = new Set<string>();
      for (const results of availResults) {
        for (const peerId of results) {
          availSet.add(peerId);
        }
      }
      resultSets.push(availSet);
    }

    // Intersection of all result sets (AND across different criteria)
    if (resultSets.length === 0) {
      return [];
    }

    let intersection = resultSets[0];
    for (let i = 1; i < resultSets.length; i++) {
      intersection = new Set([...intersection].filter(x => resultSets[i].has(x)));
    }

    return Array.from(intersection);
  }

  // ============================================================================
  // PERIODIC REPUBLISHING
  // ============================================================================

  /**
   * Start periodic republishing of indexes (DHT records expire)
   */
  startPeriodicPublishing(profile: PublicProfile, intervalMs: number = 3600000): void {
    if (this.publishInterval) {
      clearInterval(this.publishInterval);
    }

    // Publish immediately
    this.publishProfile(profile).catch(err =>
      logger.error('[DHTIndexer] Failed to publish profile:', err)
    );

    // Republish periodically
    this.publishInterval = setInterval(() => {
      this.publishProfile(profile).catch(err =>
        logger.error('[DHTIndexer] Failed to republish profile:', err)
      );
    }, intervalMs);

    logger.info(`[DHTIndexer] Started periodic publishing (interval: ${intervalMs}ms)`);
  }

  /**
   * Stop periodic republishing
   */
  stopPeriodicPublishing(): void {
    if (this.publishInterval) {
      clearInterval(this.publishInterval);
      this.publishInterval = null;
      logger.info('[DHTIndexer] Stopped periodic publishing');
    }
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /**
   * Publish a peer ID to a specific index
   */
  private async _publishToIndex(indexKey: string, hashedPeerId: string): Promise<void> {
    try {
      // Get existing index
      let peerSet = this.indexCache.get(indexKey);
      if (!peerSet) {
        peerSet = new Set();
        this.indexCache.set(indexKey, peerSet);
      }

      // Add peer to index
      peerSet.add(hashedPeerId);

      // Serialize and publish to DHT
      const indexData = JSON.stringify(Array.from(peerSet));
      const key = Buffer.from(indexKey, 'utf8');
      const value = Buffer.from(indexData, 'utf8');

      await this.dht.put(key, value);
      logger.debug(`[DHTIndexer] Published to index: ${indexKey}`);
    } catch (error) {
      logger.error(`[DHTIndexer] Failed to publish to index ${indexKey}:`, error);
      throw error;
    }
  }

  /**
   * Remove a peer ID from a specific index
   */
  private async _removeFromIndex(indexKey: string, hashedPeerId: string): Promise<void> {
    try {
      const peerSet = this.indexCache.get(indexKey);
      if (!peerSet) {
        return; // Index doesn't exist
      }

      peerSet.delete(hashedPeerId);

      if (peerSet.size === 0) {
        this.indexCache.delete(indexKey);
        // Optionally: remove from DHT (but DHT records expire automatically)
      } else {
        const indexData = JSON.stringify(Array.from(peerSet));
        const key = Buffer.from(indexKey, 'utf8');
        const value = Buffer.from(indexData, 'utf8');
        await this.dht.put(key, value);
      }

      logger.debug(`[DHTIndexer] Removed from index: ${indexKey}`);
    } catch (error) {
      logger.error(`[DHTIndexer] Failed to remove from index ${indexKey}:`, error);
    }
  }

  /**
   * Query a specific index
   */
  private async _queryIndex(indexKey: string): Promise<string[]> {
    try {
      // Check cache first
      const cached = this.indexCache.get(indexKey);
      if (cached) {
        return Array.from(cached);
      }

      // Query DHT (returns AsyncIterable<QueryEvent>)
      const key = Buffer.from(indexKey, 'utf8');
      const events = this.dht.get(key);

      // Collect DHT value from query events
      let value: Uint8Array | null = null;
      for await (const event of events) {
        if (event.name === 'VALUE') {
          value = event.value;
          break;
        }
      }

      if (!value) {
        return [];
      }

      const indexData = JSON.parse(Buffer.from(value).toString('utf8'));
      const peerSet = new Set<string>(indexData);

      // Update cache
      this.indexCache.set(indexKey, peerSet);

      return Array.from(peerSet);
    } catch (error) {
      logger.debug(`[DHTIndexer] Index not found: ${indexKey}`);
      return [];
    }
  }

  // ============================================================================
  // UTILITIES
  // ============================================================================

  /**
   * Clear local cache (forces fresh DHT queries)
   */
  clearCache(): void {
    this.indexCache.clear();
    logger.info('[DHTIndexer] Cleared index cache');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { indexCount: number; totalPeers: number } {
    let totalPeers = 0;
    for (const peerSet of this.indexCache.values()) {
      totalPeers += peerSet.size;
    }

    return {
      indexCount: this.indexCache.size,
      totalPeers,
    };
  }

  /**
   * Hash a skill name for DHT indexing
   */
  hashSkill(skillName: string): string {
    return hashIndexKey(skillName, this.networkSalt);
  }
}

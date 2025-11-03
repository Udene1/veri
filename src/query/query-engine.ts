import type { Libp2p } from '@libp2p/interface';
import type { DHTIndexer } from '../indexing/dht-index.js';
import {
  geohashEncode,
  geohashDecode,
  calculateDistance,
  type GeolocationData,
} from '../crypto/crypto-utils.js';
import type {
  ProfileQuery,
  ProfileQueryResult,
  PublicProfile,
  PrivateProfile,
} from '../types/profile-schema.js';

/**
 * Query Engine
 * 
 * Executes multi-criteria queries for proximity-based service discovery:
 * - Skill matching (hashed DHT indexes)
 * - Geolocation proximity (geohash expansion for radius search)
 * - Age range filtering
 * - Availability filtering
 * - Distance calculation and sorting
 * 
 * Features:
 * - Parallel DHT queries for speed
 * - Geohash neighbor expansion for radius search
 * - Client-side distance calculation from exact coordinates
 * - Result caching (60s TTL)
 * - Relevance scoring
 */

const logger = {
  info: (...args: any[]) => console.log('[QueryEngine]', ...args),
  debug: (...args: any[]) => console.log('[QueryEngine]', ...args),
  error: (...args: any[]) => console.error('[QueryEngine]', ...args),
};

export class QueryEngine {
  private libp2p: Libp2p;
  private dhtIndexer: DHTIndexer;
  private cache: Map<string, { result: ProfileQueryResult[]; timestamp: number }> = new Map();
  private cacheTTL: number = 60000; // 60 seconds

  constructor(libp2p: Libp2p, dhtIndexer: DHTIndexer) {
    this.libp2p = libp2p;
    this.dhtIndexer = dhtIndexer;
  }

  // ============================================================================
  // QUERY EXECUTION
  // ============================================================================

  /**
   * Execute a multi-criteria query
   */
  async executeQuery(query: ProfileQuery): Promise<ProfileQueryResult[]> {
    const cacheKey = JSON.stringify(query);

    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      logger.debug('Cache hit for query');
      return cached.result;
    }

    logger.info('Executing query:', query);

    // Build criteria for DHT query
    const criteria: any = {};

    // Skills
    if (query.skills && query.skills.length > 0) {
      criteria.skills = query.skills;
    }

    // Geolocation
    if (query.geolocation) {
      criteria.geohash = query.geolocation.geohash;
      criteria.includeNeighbors = query.geolocation.radiusKm !== undefined;
    }

    // Age ranges
    if (query.ageRanges && query.ageRanges.length > 0) {
      criteria.ageRanges = query.ageRanges;
    }

    // Availability
    if (query.availability && query.availability.length > 0) {
      criteria.availability = query.availability;
    }

    // Query DHT indexes
    const hashedPeerIds = await this.dhtIndexer.queryMulti(criteria);
    logger.info(`Found ${hashedPeerIds.length} matching peers`);

    // Fetch public profiles from matching peers
    const profiles = await this._fetchPublicProfiles(hashedPeerIds);

    // Build query results
    let results: ProfileQueryResult[] = profiles.map(profile => ({
      peerId: profile.peerId,
      skillHashes: profile.skillHashes,
      geolocation: profile.geolocation,
      ageRange: profile.ageRange,
      availability: profile.availability,
      privateCID: profile.privateCID,
      publicKey: profile.publicKey,
    }));

    // Calculate distances (if geolocation query)
    if (query.geolocation && query.geolocation.radiusKm !== undefined) {
      const centerGeo = geohashDecode(query.geolocation.geohash);

      results = results.map(result => {
        const resultGeo = geohashDecode(result.geolocation.geohash);
        const distance = calculateDistance(
          centerGeo.lat,
          centerGeo.lng,
          resultGeo.lat,
          resultGeo.lng
        );

        return { ...result, distance };
      });

      // Filter by radius
      results = results.filter(r => (r.distance ?? Infinity) <= query.geolocation!.radiusKm!);
    }

    // Calculate match scores
    results = results.map(result => ({
      ...result,
      matchScore: this._calculateMatchScore(result, query),
    }));

    // Apply additional filters
    if (query.maxHourlyRate !== undefined || query.minRating !== undefined) {
      // These require fetching private profiles (expensive)
      // For now, skip and return basic matches
      logger.debug('Advanced filters (rate/rating) require profile fetching');
    }

    // Sort results
    results = this._sortResults(results, query);

    // Apply pagination
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 50;
    results = results.slice(offset, offset + limit);

    // Cache results
    this.cache.set(cacheKey, { result: results, timestamp: Date.now() });

    logger.info(`Returning ${results.length} results`);
    return results;
  }

  /**
   * Search by proximity (convenience method)
   */
  async searchNearby(
    lat: number,
    lng: number,
    radiusKm: number = 10,
    skills?: string[],
    options?: Partial<ProfileQuery>
  ): Promise<ProfileQueryResult[]> {
    // Determine geohash precision based on radius
    let precision = 5; // Default: ~5km cells
    if (radiusKm <= 1) precision = 7; // ~150m cells for very local search
    else if (radiusKm >= 50) precision = 3; // ~150km cells for wide search

    const geohash = geohashEncode(lat, lng, precision);

    const query: ProfileQuery = {
      ...options,
      skills,
      geolocation: {
        geohash,
        precision,
        radiusKm,
      },
    };

    return this.executeQuery(query);
  }

  /**
   * Search by skill only
   */
  async searchBySkill(skill: string, options?: Partial<ProfileQuery>): Promise<ProfileQueryResult[]> {
    const query: ProfileQuery = {
      ...options,
      skills: [skill],
    };

    return this.executeQuery(query);
  }

  // ============================================================================
  // PROFILE FETCHING
  // ============================================================================

  /**
   * Fetch public profiles from matched peers
   * (This queries the profile-protocol.ts handler on each peer)
   */
  private async _fetchPublicProfiles(hashedPeerIds: string[]): Promise<PublicProfile[]> {
    logger.debug(`Fetching ${hashedPeerIds.length} public profiles...`);

    // Note: In full implementation, you'd need to:
    // 1. Maintain a mapping of hashedPeerId → actualPeerId
    // 2. For now, this assumes we store that mapping in DHT values
    
    // Parallel profile fetching for speed
    const fetchPromises = hashedPeerIds.map(async (hashedPeerId) => {
      try {
        // TODO: Unhash peer ID (requires reverse lookup or storing plaintext peerId in DHT)
        // For now, this is a placeholder showing the flow
        
        // const peerId = await this._unhashPeerId(hashedPeerId);
        // const profile = await profileProtocol.requestPublicProfile(peerId);
        // return profile;
        
        return null; // Placeholder
      } catch (error) {
        logger.error(`Failed to fetch profile for ${hashedPeerId}:`, error);
        return null;
      }
    });

    const profiles = await Promise.all(fetchPromises);
    return profiles.filter((p) => p !== null) as PublicProfile[];
  }

  // ============================================================================
  // SCORING AND SORTING
  // ============================================================================

  /**
   * Calculate relevance score (0-1)
   */
  private _calculateMatchScore(result: ProfileQueryResult, query: ProfileQuery): number {
    let score = 0;
    let factors = 0;

    // Skill match (if skills specified)
    if (query.skills && query.skills.length > 0) {
      const matchingSkills = query.skills.filter(skill => {
        const skillHash = this.dhtIndexer.hashSkill(skill);
        return result.skillHashes.includes(skillHash);
      });

      score += matchingSkills.length / query.skills.length;
      factors++;
    }

    // Distance match (if location specified)
    if (query.geolocation && result.distance !== undefined) {
      const radiusKm = query.geolocation.radiusKm ?? 10;
      const distanceScore = Math.max(0, 1 - result.distance / radiusKm);
      score += distanceScore;
      factors++;
    }

    // Availability match (exact match = 1, else 0.5)
    if (query.availability && query.availability.length > 0) {
      const matches = query.availability.includes(result.availability);
      score += matches ? 1 : 0.5;
      factors++;
    }

    return factors > 0 ? score / factors : 0.5; // Default score if no factors
  }

  /**
   * Sort results based on query criteria
   */
  private _sortResults(results: ProfileQueryResult[], query: ProfileQuery): ProfileQueryResult[] {
    const sortBy = query.sortBy ?? 'distance';
    const sortOrder = query.sortOrder ?? 'asc';

    return results.sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case 'distance':
          comparison = (a.distance ?? Infinity) - (b.distance ?? Infinity);
          break;

        case 'rating':
          // Would need to fetch private profiles for rating
          comparison = 0;
          break;

        case 'hourly-rate':
          // Would need to fetch private profiles for hourly rate
          comparison = 0;
          break;

        case 'experience':
          // Would need to fetch private profiles for experience
          comparison = 0;
          break;

        default:
          comparison = (b.matchScore ?? 0) - (a.matchScore ?? 0); // Default: by relevance
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }

  // ============================================================================
  // UTILITIES
  // ============================================================================

  /**
   * Clear query cache
   */
  clearCache(): void {
    this.cache.clear();
    logger.info('Cleared query cache');
  }

  /**
   * Set cache TTL (milliseconds)
   */
  setCacheTTL(ttl: number): void {
    this.cacheTTL = ttl;
    logger.info(`Set cache TTL to ${ttl}ms`);
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { entries: number; oldestAge: number } {
    const now = Date.now();
    let oldestAge = 0;

    for (const { timestamp } of this.cache.values()) {
      const age = now - timestamp;
      if (age > oldestAge) {
        oldestAge = age;
      }
    }

    return {
      entries: this.cache.size,
      oldestAge,
    };
  }

  /**
   * Calculate geohash for a location (helper)
   */
  static calculateGeohash(lat: number, lng: number, precision: number = 5): GeolocationData {
    return {
      geohash: geohashEncode(lat, lng, precision),
      precision,
      lat,
      lng,
    };
  }

  /**
   * Calculate distance between two geohashes (helper)
   */
  static distanceBetweenGeohashes(geohash1: string, geohash2: string): number {
    const geo1 = geohashDecode(geohash1);
    const geo2 = geohashDecode(geohash2);
    return calculateDistance(geo1.lat, geo1.lng, geo2.lat, geo2.lng);
  }
}

/**
 * VNS Security Module
 * 
 * Handles proof-of-work validation, rate limiting, and anti-spam measures
 */

import crypto from 'crypto';
import { VNS_CONFIG } from '../types/vns-schema.js';
import { verifySignature } from '../identity.js';

/**
 * Rate limiter for VNS operations per peer
 */
export class VNSRateLimiter {
  private attempts: Map<string, number[]>; // peerId -> array of timestamps

  constructor() {
    this.attempts = new Map();
  }

  /**
   * Check if a peer has exceeded rate limits
   */
  checkLimit(peerId: string): boolean {
    const now = Date.now();
    const windowStart = now - VNS_CONFIG.RATE_LIMIT_WINDOW_MS;

    // Get or create attempts array for this peer
    let attempts = this.attempts.get(peerId) || [];

    // Filter out attempts outside the window
    attempts = attempts.filter(ts => ts > windowStart);

    // Update the map
    this.attempts.set(peerId, attempts);

    // Check if limit exceeded
    return attempts.length < VNS_CONFIG.RATE_LIMIT_PER_HOUR;
  }

  /**
   * Record an attempt for a peer
   */
  recordAttempt(peerId: string): void {
    const now = Date.now();
    const attempts = this.attempts.get(peerId) || [];
    attempts.push(now);
    this.attempts.set(peerId, attempts);
  }

  /**
   * Clear old attempts (cleanup task)
   */
  cleanup(): void {
    const now = Date.now();
    const windowStart = now - VNS_CONFIG.RATE_LIMIT_WINDOW_MS;

    for (const [peerId, attempts] of this.attempts.entries()) {
      const filtered = attempts.filter(ts => ts > windowStart);
      if (filtered.length === 0) {
        this.attempts.delete(peerId);
      } else {
        this.attempts.set(peerId, filtered);
      }
    }
  }
}

/**
 * Proof-of-Work validator for VNS registrations
 */
export class VNSProofOfWork {
  private difficulty: number;

  constructor(difficulty: number = VNS_CONFIG.POW_DIFFICULTY) {
    this.difficulty = difficulty;
  }

  /**
   * Validate that a nonce produces a valid PoW hash
   * Hash must have N leading zeros where N = difficulty
   */
  validate(name: string, owner: string, nonce: number): boolean {
    const input = `${name}:${owner}:${nonce}`;
    const hash = crypto.createHash('sha256').update(input).digest('hex');
    
    // Check for required leading zeros
    const prefix = '0'.repeat(this.difficulty);
    return hash.startsWith(prefix);
  }

  /**
   * Compute a valid nonce for testing/demo purposes
   * WARNING: This can be CPU-intensive for high difficulty
   */
  compute(name: string, owner: string, maxAttempts: number = 1000000): number | null {
    for (let nonce = 0; nonce < maxAttempts; nonce++) {
      if (this.validate(name, owner, nonce)) {
        return nonce;
      }
    }
    return null; // Failed to find valid nonce
  }

  /**
   * Get the difficulty level
   */
  getDifficulty(): number {
    return this.difficulty;
  }

  /**
   * Estimate average attempts needed for current difficulty
   */
  estimateAttempts(): number {
    return Math.pow(16, this.difficulty);
  }
}

/**
 * Signature validator for VNS registrations
 */
export class VNSSignatureValidator {
  /**
   * Validate the signature on a VNS registration
   * Returns true if signature is valid and matches the owner
   */
  validate(data: string, signature: string, publicKey: string): boolean {
    try {
      return verifySignature(publicKey, data, signature);
    } catch (e) {
      console.error('VNS signature validation error:', e);
      return false;
    }
  }

  /**
   * Create a canonical string representation of registration data for signing
   */
  serializeForSigning(registration: {
    name: string;
    owner: string;
    records: any[];
    timestamp: number;
    expires: number;
    nonce: number;
  }): string {
    // Create deterministic JSON (sorted keys)
    const canonical = {
      name: registration.name,
      owner: registration.owner,
      records: registration.records.map(r => ({
        type: r.type,
        value: r.value,
        ttl: r.ttl || VNS_CONFIG.TTL_DEFAULT
      })),
      timestamp: registration.timestamp,
      expires: registration.expires,
      nonce: registration.nonce
    };

    return JSON.stringify(canonical);
  }
}

/**
 * ERC20 Stake Validator (Placeholder for MVP)
 * TODO: Post-launch integration with blockchain
 */
export class VNSStakeValidator {
  private minStakeAmount: number;
  private simulatedBalances: Map<string, number>; // Local balance sim for MVP

  constructor(minStakeAmount: number = 100) {
    this.minStakeAmount = minStakeAmount;
    this.simulatedBalances = new Map();
    
    // Pre-populate some test accounts for MVP
    this.simulatedBalances.set('genesis', 1000000);
    this.simulatedBalances.set('reserved', 1000000);
  }

  /**
   * Check if owner has sufficient ERC20 stake
   * MVP: Returns true (simulated local balance)
   * POST-LAUNCH: Query blockchain contract via Web3/Ethers
   */
  checkERC20Stake(owner: string, amount: number = this.minStakeAmount): boolean {
    // MVP: Simulate stake check
    const balance = this.simulatedBalances.get(owner) || 0;
    const hasStake = balance >= amount;
    
    console.log(`[VNS Stake] Simulated check for ${owner.slice(0, 16)}...: ${balance} tokens (min: ${amount}) -> ${hasStake ? 'PASS' : 'FAIL'}`);
    
    // TODO Post-Launch: Replace with actual blockchain query
    // const web3 = new Web3(RPC_ENDPOINT);
    // const contract = new web3.eth.Contract(ERC20_ABI, TOKEN_ADDRESS);
    // const balance = await contract.methods.balanceOf(owner).call();
    // return balance >= amount;
    
    return hasStake;
  }

  /**
   * Set simulated balance for testing (MVP only)
   */
  setSimulatedBalance(owner: string, amount: number): void {
    this.simulatedBalances.set(owner, amount);
    console.log(`[VNS Stake] Simulated balance set for ${owner.slice(0, 16)}...: ${amount} tokens`);
  }

  /**
   * Get minimum stake requirement
   */
  getMinStake(): number {
    return this.minStakeAmount;
  }
}

/**
 * Combined VNS security validator
 */
export class VNSSecurity {
  private rateLimiter: VNSRateLimiter;
  private pow: VNSProofOfWork;
  private signatureValidator: VNSSignatureValidator;
  private stakeValidator: VNSStakeValidator;

  constructor(powDifficulty: number = VNS_CONFIG.POW_DIFFICULTY, minStake: number = 100) {
    this.rateLimiter = new VNSRateLimiter();
    this.pow = new VNSProofOfWork(powDifficulty);
    this.signatureValidator = new VNSSignatureValidator();
    this.stakeValidator = new VNSStakeValidator(minStake);
  }

  /**
   * Validate anti-spam measures (modular for PoW or stake)
   * Currently: PoW required, stake optional (MVP)
   * Post-launch: Can switch to stake-only or hybrid
   */
  validateAntiSpam(registration: {
    name: string;
    owner: string;
    nonce: number;
  }): { valid: boolean; error?: string } {
    // Primary: PoW validation
    if (!this.pow.validate(registration.name, registration.owner, registration.nonce)) {
      return { valid: false, error: `Proof-of-work failed (requires ${this.pow.getDifficulty()} leading zeros)` };
    }

    // Optional: Stake validation (MVP simulated, can enable for premium names)
    // Uncomment post-launch for stake requirement:
    // if (!this.stakeValidator.checkERC20Stake(registration.owner)) {
    //   return { valid: false, error: 'Insufficient ERC20 stake' };
    // }

    return { valid: true };
  }

  /**
   * Validate a complete VNS registration
   */
  validateRegistration(registration: {
    name: string;
    owner: string;
    records: any[];
    timestamp: number;
    expires: number;
    nonce: number;
    signature: string;
    publicKey?: string;
  }, peerId: string): { valid: boolean; error?: string } {
    // Check rate limit
    if (!this.rateLimiter.checkLimit(peerId)) {
      return { valid: false, error: 'Rate limit exceeded (5 registrations per hour)' };
    }

    // Validate anti-spam (PoW + optional stake)
    const antiSpamCheck = this.validateAntiSpam(registration);
    if (!antiSpamCheck.valid) {
      return antiSpamCheck;
    }

    // Validate signature
    const dataToSign = this.signatureValidator.serializeForSigning(registration);
    if (!registration.publicKey) {
      return { valid: false, error: 'Missing public key for signature verification' };
    }
    if (!this.signatureValidator.validate(dataToSign, registration.signature, registration.publicKey)) {
      return { valid: false, error: 'Invalid signature' };
    }

    // Validate expiration (should be ~1 year from timestamp)
    const expectedExpires = registration.timestamp + VNS_CONFIG.EXPIRATION_PERIOD;
    const tolerance = 60 * 1000; // 1 minute tolerance
    if (Math.abs(registration.expires - expectedExpires) > tolerance) {
      return { valid: false, error: 'Invalid expiration period' };
    }

    // Check if expired
    if (Date.now() > registration.expires) {
      return { valid: false, error: 'Registration has expired' };
    }

    // Validate record count
    if (registration.records.length > VNS_CONFIG.MAX_RECORDS_PER_NAME) {
      return { valid: false, error: `Too many records (max ${VNS_CONFIG.MAX_RECORDS_PER_NAME})` };
    }

    // All validations passed
    this.rateLimiter.recordAttempt(peerId);
    return { valid: true };
  }

  /**
   * Check if a registration has expired
   */
  isExpired(expires: number): boolean {
    return Date.now() > expires;
  }

  /**
   * Compute a valid PoW nonce (for testing/CLI)
   */
  computePoW(name: string, owner: string): number | null {
    return this.pow.compute(name, owner);
  }

  /**
   * Check ERC20 stake (MVP simulated)
   */
  checkStake(owner: string, amount?: number): boolean {
    return this.stakeValidator.checkERC20Stake(owner, amount);
  }

  /**
   * Set simulated stake balance (MVP testing only)
   */
  setSimulatedStake(owner: string, amount: number): void {
    this.stakeValidator.setSimulatedBalance(owner, amount);
  }

  /**
   * Clean up old rate limit data
   */
  cleanup(): void {
    this.rateLimiter.cleanup();
  }

  /**
   * Get current PoW difficulty
   */
  getPoWDifficulty(): number {
    return this.pow.getDifficulty();
  }

  /**
   * Get stake validator for advanced usage
   */
  getStakeValidator(): VNSStakeValidator {
    return this.stakeValidator;
  }
}

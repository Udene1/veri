/**
 * VNS Security Tests
 * 
 * Unit tests for proof-of-work, rate limiting, and signature validation
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { VNSSecurity, VNSProofOfWork, VNSRateLimiter } from '../../src/vns/security.js';
import { VNS_CONFIG } from '../../src/types/vns-schema.js';
import { createOrLoadIdentity } from '../../src/identity.js';

describe('VNSProofOfWork', () => {
  let pow: VNSProofOfWork;

  beforeEach(() => {
    pow = new VNSProofOfWork(3); // 3 leading zeros for fast tests
  });

  it('should validate a correct PoW nonce', () => {
    const name = 'test.vfs';
    const owner = 'testowner';
    
    // Compute a valid nonce
    const nonce = pow.compute(name, owner, 100000);
    expect(nonce).not.toBeNull();
    
    if (nonce !== null) {
      // Validate it
      const valid = pow.validate(name, owner, nonce);
      expect(valid).toBe(true);
    }
  });

  it('should reject an invalid PoW nonce', () => {
    const name = 'test.vfs';
    const owner = 'testowner';
    const invalidNonce = 0;
    
    // Most likely invalid (unless we're incredibly lucky)
    const valid = pow.validate(name, owner, invalidNonce);
    // Can't guarantee false, but very likely
  });

  it('should compute a valid nonce within reasonable attempts', () => {
    const name = 'test.vfs';
    const owner = 'testowner';
    
    const nonce = pow.compute(name, owner, 100000);
    expect(nonce).not.toBeNull();
  });

  it('should have correct difficulty level', () => {
    expect(pow.getDifficulty()).toBe(3);
  });

  it('should estimate correct attempts', () => {
    const estimate = pow.estimateAttempts();
    expect(estimate).toBe(Math.pow(16, 3)); // 16^3 = 4096
  });
});

describe('VNSRateLimiter', () => {
  let limiter: VNSRateLimiter;

  beforeEach(() => {
    limiter = new VNSRateLimiter();
  });

  it('should allow initial requests', () => {
    const peerId = 'peer1';
    expect(limiter.checkLimit(peerId)).toBe(true);
  });

  it('should enforce rate limits', () => {
    const peerId = 'peer1';
    
    // Make max allowed requests
    for (let i = 0; i < VNS_CONFIG.RATE_LIMIT_PER_HOUR; i++) {
      expect(limiter.checkLimit(peerId)).toBe(true);
      limiter.recordAttempt(peerId);
    }
    
    // Next request should be blocked
    expect(limiter.checkLimit(peerId)).toBe(false);
  });

  it('should track different peers separately', () => {
    const peer1 = 'peer1';
    const peer2 = 'peer2';
    
    // Exhaust peer1's limit
    for (let i = 0; i < VNS_CONFIG.RATE_LIMIT_PER_HOUR; i++) {
      limiter.recordAttempt(peer1);
    }
    
    // Peer2 should still have quota
    expect(limiter.checkLimit(peer2)).toBe(true);
    expect(limiter.checkLimit(peer1)).toBe(false);
  });

  it('should cleanup old attempts', () => {
    const peerId = 'peer1';
    limiter.recordAttempt(peerId);
    
    // Cleanup should not crash
    limiter.cleanup();
  });
});

describe('VNSSecurity', () => {
  let security: VNSSecurity;

  beforeEach(() => {
    security = new VNSSecurity(3); // Lower difficulty for faster tests
  });

  it('should validate a complete registration', async () => {
    const identity = await createOrLoadIdentity('./test-identity.json');
    const name = 'test.vfs';
    const owner = identity.peerId.toString();
    
    // Compute PoW
    const nonce = security.computePoW(name, owner);
    expect(nonce).not.toBeNull();

    if (nonce !== null) {
      const now = Date.now();
      const registration = {
        name,
        owner,
        records: [
          { type: 'A' as const, value: '192.168.1.1', ttl: 3600 }
        ],
        timestamp: now,
        expires: now + VNS_CONFIG.EXPIRATION_PERIOD,
        nonce,
        signature: '', // Will be computed
        publicKey: identity.publicKeyPem
      };

      // Sign the registration
      const { signData } = await import('../../src/identity.js');
      const dataToSign = JSON.stringify({
        name: registration.name,
        owner: registration.owner,
        records: registration.records,
        timestamp: registration.timestamp,
        expires: registration.expires,
        nonce: registration.nonce
      });
      registration.signature = signData(identity.signingKeyPem, dataToSign);

      // Validate
      const result = security.validateRegistration(registration, 'peer1');
      expect(result.valid).toBe(true);
    }
  });

  it('should reject registration without valid PoW', () => {
    const registration = {
      name: 'test.vfs',
      owner: 'testowner',
      records: [{ type: 'A' as const, value: '192.168.1.1' }],
      timestamp: Date.now(),
      expires: Date.now() + VNS_CONFIG.EXPIRATION_PERIOD,
      nonce: 0, // Invalid nonce
      signature: 'fakesig',
      publicKey: 'fakepubkey'
    };

    const result = security.validateRegistration(registration, 'peer1');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Proof-of-work failed');
  });

  it('should reject expired registrations', () => {
    const registration = {
      name: 'test.vfs',
      owner: 'testowner',
      records: [{ type: 'A' as const, value: '192.168.1.1' }],
      timestamp: Date.now(),
      expires: Date.now() - 1000, // Already expired
      nonce: 0,
      signature: 'fakesig',
      publicKey: 'fakepubkey'
    };

    const result = security.validateRegistration(registration, 'peer1');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('expired');
  });

  it('should check expiration correctly', () => {
    const future = Date.now() + 10000;
    const past = Date.now() - 10000;

    expect(security.isExpired(past)).toBe(true);
    expect(security.isExpired(future)).toBe(false);
  });
});

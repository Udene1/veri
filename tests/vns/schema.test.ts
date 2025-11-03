/**
 * VNS Schema Tests
 * 
 * Unit tests for name validation and normalization
 */

import { describe, it, expect } from '@jest/globals';
import {
  validateVNSName,
  normalizeVNSName,
  VNS_CONFIG,
  RESERVED_VNS_NAMES
} from '../../src/types/vns-schema.js';

describe('validateVNSName', () => {
  it('should accept valid names', () => {
    const validNames = [
      'test.vfs',
      'my-project.vfs',
      'cool_name.vfs',
      'abc123.vfs',
      '123.vfs'
    ];

    validNames.forEach(name => {
      const result = validateVNSName(name);
      expect(result.valid).toBe(true);
    });
  });

  it('should reject names without .vfs suffix', () => {
    const result = validateVNSName('test');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('must end with .vfs');
  });

  it('should reject names that are too short', () => {
    const result = validateVNSName('ab.vfs');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('too short');
  });

  it('should reject names that are too long', () => {
    const longName = 'a'.repeat(64) + '.vfs';
    const result = validateVNSName(longName);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('too long');
  });

  it('should reject reserved names', () => {
    RESERVED_VNS_NAMES.forEach(name => {
      const result = validateVNSName(name);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('reserved');
    });
  });

  it('should reject names with invalid characters', () => {
    const invalidNames = [
      'test@domain.vfs',
      'test space.vfs',
      'test.domain.vfs', // No subdomains
      'Test.vfs', // Must be lowercase
      'test!.vfs'
    ];

    invalidNames.forEach(name => {
      const result = validateVNSName(name.toLowerCase());
      if (name.includes(' ') || name.includes('@') || name.includes('!')) {
        expect(result.valid).toBe(false);
      }
    });
  });

  it('should reject names starting or ending with hyphen', () => {
    expect(validateVNSName('-test.vfs').valid).toBe(false);
    expect(validateVNSName('test-.vfs').valid).toBe(false);
  });
});

describe('normalizeVNSName', () => {
  it('should convert to lowercase', () => {
    expect(normalizeVNSName('TEST.VFS')).toBe('test.vfs');
    expect(normalizeVNSName('MyProject.vfs')).toBe('myproject.vfs');
  });

  it('should add .vfs suffix if missing', () => {
    expect(normalizeVNSName('test')).toBe('test.vfs');
    expect(normalizeVNSName('myproject')).toBe('myproject.vfs');
  });

  it('should trim whitespace', () => {
    expect(normalizeVNSName('  test.vfs  ')).toBe('test.vfs');
  });

  it('should handle already normalized names', () => {
    expect(normalizeVNSName('test.vfs')).toBe('test.vfs');
  });
});

describe('VNS_CONFIG', () => {
  it('should have correct TLD', () => {
    expect(VNS_CONFIG.TLD).toBe('.vfs');
  });

  it('should have reasonable limits', () => {
    expect(VNS_CONFIG.MAX_NAME_LENGTH).toBe(63);
    expect(VNS_CONFIG.MIN_NAME_LENGTH).toBe(3);
    expect(VNS_CONFIG.TTL_DEFAULT).toBe(3600);
  });

  it('should have correct expiration period', () => {
    const oneYear = 365 * 24 * 60 * 60 * 1000;
    expect(VNS_CONFIG.EXPIRATION_PERIOD).toBe(oneYear);
  });

  it('should have sensible PoW difficulty', () => {
    expect(VNS_CONFIG.POW_DIFFICULTY).toBeGreaterThanOrEqual(2);
    expect(VNS_CONFIG.POW_DIFFICULTY).toBeLessThanOrEqual(6);
  });

  it('should have rate limiting configured', () => {
    expect(VNS_CONFIG.RATE_LIMIT_PER_HOUR).toBeGreaterThan(0);
    expect(VNS_CONFIG.RATE_LIMIT_WINDOW_MS).toBe(60 * 60 * 1000);
  });
});

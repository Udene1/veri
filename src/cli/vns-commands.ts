/**
 * VNS CLI Commands
 * 
 * Command-line interface for Verimut Name Service operations
 */

import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { VNSNamespaceStore } from '../vns/namespace-store.js';
import { VNSSecurity } from '../vns/security.js';
import { VNSRegistration, VNS_CONFIG, normalizeVNSName } from '../types/vns-schema.js';
import { createOrLoadIdentity } from '../identity.js';
import { signData } from '../identity.js';

/**
 * Display PoW progress bar
 */
function displayPoWProgress(attempt: number, maxAttempts: number): void {
  const pct = Math.floor((attempt / maxAttempts) * 100);
  const bar = '█'.repeat(Math.floor(pct / 2)) + '░'.repeat(50 - Math.floor(pct / 2));
  process.stdout.write(`\r${chalk.cyan('Computing PoW:')} [${bar}] ${pct}% (${attempt}/${maxAttempts})`);
}

/**
 * Compute PoW with progress display
 */
async function computePoWWithProgress(
  name: string,
  owner: string,
  security: VNSSecurity
): Promise<number | null> {
  console.log(chalk.blue(`\n🔨 Computing proof-of-work for ${name}...`));
  console.log(chalk.gray(`   Difficulty: ${security.getPoWDifficulty()} leading zeros`));
  console.log(chalk.gray(`   Estimated attempts: ~${Math.pow(16, security.getPoWDifficulty())}\n`));

  const maxAttempts = 1000000; // 1 million attempts
  const updateInterval = 1000; // Update every 1k attempts

  return new Promise((resolve) => {
    let attempt = 0;
    const startTime = Date.now();

    const tryNonce = () => {
      const nonce = attempt;
      const input = `${name}:${owner}:${nonce}`;
      const hash = crypto.createHash('sha256').update(input).digest('hex');
      const prefix = '0'.repeat(security.getPoWDifficulty());

      if (hash.startsWith(prefix)) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        process.stdout.write('\r' + ' '.repeat(80) + '\r'); // Clear line
        console.log(chalk.green(`✅ Found valid nonce: ${nonce} (${attempt + 1} attempts in ${elapsed}s)\n`));
        resolve(nonce);
        return;
      }

      attempt++;

      if (attempt % updateInterval === 0) {
        displayPoWProgress(attempt, maxAttempts);
      }

      if (attempt >= maxAttempts) {
        process.stdout.write('\r' + ' '.repeat(80) + '\r');
        console.log(chalk.red('❌ Failed to find valid nonce within attempt limit\n'));
        resolve(null);
        return;
      }

      // Continue searching (non-blocking)
      setImmediate(tryNonce);
    };

    tryNonce();
  });
}

/**
 * Create VNS command group
 */
export function createVNSCommand(): Command {
  const vns = new Command('vns');
  vns.description('Verimut Name Service (VNS) commands');

  /**
   * Register a new .vfs name
   */
  vns
    .command('register <name>')
    .description('Register a new .vfs name')
    .option('--cid <cid>', 'IPFS CID for FS record')
    .option('--ip <address>', 'IPv4 address for A record')
    .option('--ip6 <address>', 'IPv6 address for AAAA record')
    .option('--txt <text>', 'Text metadata for TXT record')
    .option('--sync <endpoint>', 'VerimutSync peer endpoint')
    .option('--key <path>', 'Private key file (default: ./peer-key.json)', './peer-key.json')
    .option('--data-dir <path>', 'Data directory (default: ./verimut-data)', './verimut-data')
    .option('--no-pow', 'Skip proof-of-work (for testing only)')
    .action(async (name: string, opts) => {
      try {
        console.log(chalk.blue('\n🌐 VNS Registration\n'));

        // Normalize name
        name = normalizeVNSName(name);
        console.log(chalk.cyan(`Name: ${name}`));

        // Load identity
        console.log(chalk.gray(`Loading identity from ${opts.key}...`));
        const identity = await createOrLoadIdentity(opts.key);
        const owner = identity.peerId.toString();
        console.log(chalk.gray(`Owner: ${owner.slice(0, 32)}...\n`));

        // Build records
        const records: any[] = [];
        if (opts.cid) records.push({ type: 'FS', value: opts.cid, ttl: VNS_CONFIG.TTL_DEFAULT });
        if (opts.ip) records.push({ type: 'A', value: opts.ip, ttl: VNS_CONFIG.TTL_DEFAULT });
        if (opts.ip6) records.push({ type: 'AAAA', value: opts.ip6, ttl: VNS_CONFIG.TTL_DEFAULT });
        if (opts.txt) records.push({ type: 'TXT', value: opts.txt, ttl: VNS_CONFIG.TTL_DEFAULT });
        if (opts.sync) records.push({ type: 'SYNC', value: opts.sync, ttl: VNS_CONFIG.TTL_DEFAULT });

        if (records.length === 0) {
          console.log(chalk.yellow('⚠️  No records specified. Adding default TXT record.'));
          records.push({ type: 'TXT', value: 'Registered via VNS CLI', ttl: VNS_CONFIG.TTL_DEFAULT });
        }

        console.log(chalk.cyan('Records:'));
        records.forEach(r => console.log(chalk.gray(`  ${r.type}: ${r.value}`)));
        console.log('');

        // Compute PoW
        const security = new VNSSecurity();
        let nonce: number;

        if (opts.pow === false) {
          console.log(chalk.yellow('⚠️  Skipping PoW (testing mode)\n'));
          nonce = 0;
        } else {
          const computedNonce = await computePoWWithProgress(name, owner, security);
          if (computedNonce === null) {
            console.log(chalk.red('❌ Registration failed: Could not compute valid PoW'));
            process.exit(1);
          }
          nonce = computedNonce;
        }

        // Create registration
        const now = Date.now();
        const registration: VNSRegistration = {
          name,
          owner,
          records,
          timestamp: now,
          expires: now + VNS_CONFIG.EXPIRATION_PERIOD,
          nonce,
          signature: '',
          publicKey: identity.publicKeyPem
        };

        // Sign registration
        const dataToSign = JSON.stringify({
          name: registration.name,
          owner: registration.owner,
          records: registration.records,
          timestamp: registration.timestamp,
          expires: registration.expires,
          nonce: registration.nonce
        });
        registration.signature = signData(identity.signingKeyPem, dataToSign);

        console.log(chalk.blue('📝 Registration prepared:'));
        console.log(chalk.gray(`   Timestamp: ${new Date(registration.timestamp).toISOString()}`));
        console.log(chalk.gray(`   Expires: ${new Date(registration.expires).toISOString()}`));
        console.log(chalk.gray(`   Signature: ${registration.signature.slice(0, 32)}...\n`));

        // TODO: Submit to node via API or direct store
        // For now, display the registration data
        console.log(chalk.green('✅ Registration created successfully!'));
        console.log(chalk.yellow('\n⚠️  Note: Registration must be submitted to a running VNS node'));
        console.log(chalk.gray('   Use the HTTP API: POST /api/vns/register'));
        console.log(chalk.gray('\n   Example:'));
        console.log(chalk.gray(`   curl -X POST http://localhost:3001/api/vns/register \\`));
        console.log(chalk.gray(`     -H "Content-Type: application/json" \\`));
        console.log(chalk.gray(`     -d '${JSON.stringify(registration, null, 2).substring(0, 100)}...'`));
        console.log('');

        // Save to file for easy submission
        const outputFile = path.join(opts.dataDir, `vns-registration-${name.replace('.vfs', '')}.json`);
        fs.mkdirSync(path.dirname(outputFile), { recursive: true });
        fs.writeFileSync(outputFile, JSON.stringify(registration, null, 2));
        console.log(chalk.cyan(`💾 Registration saved to: ${outputFile}\n`));

      } catch (e) {
        console.error(chalk.red('❌ Error:'), e instanceof Error ? e.message : e);
        process.exit(1);
      }
    });

  /**
   * Resolve a .vfs name
   */
  vns
    .command('resolve <name>')
    .description('Resolve a .vfs name to its records')
    .option('--api <url>', 'VNS API endpoint', 'http://localhost:3001')
    .action(async (name: string, opts) => {
      try {
        console.log(chalk.blue('\n🔍 VNS Resolution\n'));

        // Normalize name
        name = normalizeVNSName(name);
        console.log(chalk.cyan(`Resolving: ${name}\n`));

        // Query API
        const fetch = (await import('node-fetch')).default;
        const url = `${opts.api}/api/vns/resolve/${encodeURIComponent(name)}`;
        
        console.log(chalk.gray(`Querying: ${url}...`));
        const response = await fetch(url);
        
        if (!response.ok) {
          console.log(chalk.red(`❌ HTTP ${response.status}: ${response.statusText}\n`));
          process.exit(1);
        }

        const result = await response.json();

        if (!result.entry || !result.entry.found) {
          console.log(chalk.yellow(`⚠️  Name not found: ${name}\n`));
          process.exit(0);
        }

        // Display results
        console.log(chalk.green('✅ Name found!\n'));
        console.log(chalk.cyan('Details:'));
        console.log(chalk.gray(`   Name: ${result.entry.name}`));
        console.log(chalk.gray(`   Owner: ${result.entry.owner}`));
        console.log(chalk.gray(`   Expires: ${new Date(result.entry.expires).toISOString()}`));
        console.log(chalk.gray(`   TTL: ${result.entry.ttl}s\n`));

        console.log(chalk.cyan('Records:'));
        if (result.entry.records && result.entry.records.length > 0) {
          result.entry.records.forEach((r: any) => {
            console.log(chalk.gray(`   ${r.type.padEnd(6)} ${r.value}`));
          });
        } else {
          console.log(chalk.gray('   (no records)'));
        }
        console.log('');

      } catch (e) {
        console.error(chalk.red('❌ Error:'), e instanceof Error ? e.message : e);
        process.exit(1);
      }
    });

  /**
   * Transfer ownership of a name
   */
  vns
    .command('transfer <name> <new-owner>')
    .description('Transfer ownership of a .vfs name')
    .option('--key <path>', 'Private key file (default: ./peer-key.json)', './peer-key.json')
    .option('--api <url>', 'VNS API endpoint', 'http://localhost:3001')
    .action(async (name: string, newOwner: string, opts) => {
      try {
        console.log(chalk.blue('\n🔄 VNS Transfer\n'));

        // Normalize name
        name = normalizeVNSName(name);
        console.log(chalk.cyan(`Name: ${name}`));
        console.log(chalk.cyan(`New Owner: ${newOwner}\n`));

        // Load identity
        const identity = await createOrLoadIdentity(opts.key);
        const currentOwner = identity.peerId.toString();

        // Sign transfer
        const dataToSign = JSON.stringify({ name, newOwner, timestamp: Date.now() });
        const signature = signData(identity.signingKeyPem, dataToSign);

        // Submit transfer
        const fetch = (await import('node-fetch')).default;
        const url = `${opts.api}/api/vns/transfer/${encodeURIComponent(name)}`;
        
        console.log(chalk.gray(`Submitting transfer to: ${url}...`));
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newOwner, signature, currentOwner })
        });

        if (!response.ok) {
          console.log(chalk.red(`❌ HTTP ${response.status}: ${response.statusText}\n`));
          process.exit(1);
        }

        const result = await response.json();

        if (result.success) {
          console.log(chalk.green('✅ Transfer successful!\n'));
        } else {
          console.log(chalk.red(`❌ Transfer failed: ${result.error}\n`));
          process.exit(1);
        }

      } catch (e) {
        console.error(chalk.red('❌ Error:'), e instanceof Error ? e.message : e);
        process.exit(1);
      }
    });

  /**
   * Query names by owner
   */
  vns
    .command('query <owner>')
    .description('Query all names owned by a peer ID')
    .option('--api <url>', 'VNS API endpoint', 'http://localhost:3001')
    .action(async (owner: string, opts) => {
      try {
        console.log(chalk.blue('\n🔎 VNS Query\n'));
        console.log(chalk.cyan(`Owner: ${owner}\n`));

        const fetch = (await import('node-fetch')).default;
        const url = `${opts.api}/api/vns/query?owner=${encodeURIComponent(owner)}`;
        
        console.log(chalk.gray(`Querying: ${url}...`));
        const response = await fetch(url);
        
        if (!response.ok) {
          console.log(chalk.red(`❌ HTTP ${response.status}: ${response.statusText}\n`));
          process.exit(1);
        }

        const result = await response.json();

        if (!result.names || result.names.length === 0) {
          console.log(chalk.yellow(`⚠️  No names found for owner ${owner.slice(0, 32)}...\n`));
          process.exit(0);
        }

        console.log(chalk.green(`✅ Found ${result.names.length} name(s):\n`));
        result.names.forEach((name: string) => {
          console.log(chalk.cyan(`   • ${name}`));
        });
        console.log('');

      } catch (e) {
        console.error(chalk.red('❌ Error:'), e instanceof Error ? e.message : e);
        process.exit(1);
      }
    });

  return vns;
}

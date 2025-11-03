import fs from 'fs';
import path from 'path';
import { CID } from 'multiformats/cid';
import * as sha from 'multiformats/hashes/sha2';
import { bytes } from 'multiformats';
import type { Blockstore } from './types.js';

/**
 * Simple file-backed content-addressed blockstore using multiformats CIDs.
 * - Stores blocks under <repo>/blocks/<cid>
 * - Uses raw codec (store raw bytes) and sha2-256
 */
export class FileBlockstore implements Blockstore {
  base: string;
  constructor(repoPath = './.verimut') {
    this.base = path.join(repoPath, 'blocks');
    try { fs.mkdirSync(this.base, { recursive: true }); } catch (e) { /* ignore */ }
  }

  async put(data: Uint8Array | Buffer): Promise<string> {
    // compute cid (raw + sha2-256)
    const digest = await sha.sha256.digest(bytes.coerce(data));
    const cid = CID.createV1(0x55 /* raw */, digest).toString();
    const file = path.join(this.base, cid);
    fs.writeFileSync(file, Buffer.from(data));
    return cid;
  }

  async get(cidStr: string): Promise<Uint8Array | undefined> {
    const file = path.join(this.base, cidStr);
    if (!fs.existsSync(file)) return undefined;
    return fs.readFileSync(file);
  }

  async has(cidStr: string): Promise<boolean> {
    const file = path.join(this.base, cidStr);
    return fs.existsSync(file);
  }
}

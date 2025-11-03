import { EventEmitter } from 'events';
import type { Blockstore } from './types.js';
import { signData, verifySignature } from './identity.js';
import type { VerimutIdentity } from './identity.js';
// note: block CID computation is handled by the FileBlockstore; this module
// only needs to verify and apply wrapped blocks fetched into the store.

export interface VerimutLogEntry {
  cid: string;
  value: any;
  author?: string;
  ts: number;
}

export class VerimutLog {
  name: string;
  blocks: Blockstore;
  events: EventEmitter;
  entries: VerimutLogEntry[];
  identity?: VerimutIdentity | null;

  constructor(name: string, blocks: Blockstore, identity?: VerimutIdentity | null) {
    this.name = name;
    this.blocks = blocks;
    this.events = new EventEmitter();
    this.entries = [];
    this.identity = identity ?? null;
  }

  async add(value: any, author?: string) {
    const ts = Date.now();
    const payload = JSON.stringify({ value, author: author ?? this.identity?.peerId?.toString?.() ?? author, ts });
    let signature: string | undefined = undefined;
    if (this.identity && this.identity.signingKeyPem) {
      signature = signData(this.identity.signingKeyPem, payload);
    }
    const wrapped = { payload: JSON.parse(payload), signature, pubkey: this.identity?.publicKeyPem };
    const block = Buffer.from(JSON.stringify(wrapped));
    const cid = await this.blocks.put(block);
    const entry = { cid, value, author: wrapped.payload.author, ts };
    this.entries.push(entry);
    this.events.emit('update', entry);
    return cid;
  }

  async all() {
    return this.entries.slice();
  }

  // Apply a block that already exists in the blockstore (by cid).
  // This verifies the wrapped payload signature and only appends if valid.
  async applyCid(cid: string) {
    try {
      const raw = await this.blocks.get(cid);
      if (!raw) {
        console.warn(`VerimutLog.applyCid: missing block ${cid}`);
        return false;
      }
      const txt = Buffer.from(raw).toString('utf8');
      const wrapped = JSON.parse(txt);
      const payloadJson = JSON.stringify(wrapped.payload);
      const signature = wrapped.signature;
      const pubkey = wrapped.pubkey;
      // verify signature if present
      if (signature && pubkey) {
        const ok = verifySignature(pubkey, payloadJson, signature);
        if (!ok) {
          console.warn(`VerimutLog.applyCid: signature verification failed for ${cid}`);
          return false;
        }
      } else {
        console.warn(`VerimutLog.applyCid: no signature/pubkey present for ${cid}`);
        // treat unsigned entries as invalid for now
        return false;
      }

      const payload = wrapped.payload;
      const entry = { cid, value: payload.value, author: payload.author, ts: payload.ts };
      // avoid duplicates
      if (!this.entries.find((e) => e.cid === cid)) {
        this.entries.push(entry);
        this.events.emit('update', entry);
        console.log(`VerimutLog: applied entry ${cid} author=${entry.author}`);
      }
      return true;
    } catch (e) {
      console.error('VerimutLog.applyCid error', e);
      return false;
    }
  }
}

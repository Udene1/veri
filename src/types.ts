export type Bytes = Uint8Array | Buffer;

export interface Block {
  cid: string;
  bytes: Bytes;
}

export interface Blockstore {
  put(bytes: Bytes): Promise<string>; // return CID string
  get(cid: string): Promise<Bytes | undefined>;
  has(cid: string): Promise<boolean>;
}

export interface PinStore {
  add(cid: string): AsyncIterable<string>;
  isPinned(cid: string): Promise<boolean>;
}

export interface VerimutNodeOptions {
  repoPath?: string;
}

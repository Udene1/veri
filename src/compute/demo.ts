import { sign } from '../utils/crypto.js';

export function shard(data: string, n = 3): string[] {
  if (!data) return [];
  const size = Math.max(1, Math.floor(data.length / n));
  const out: string[] = [];
  for (let i = 0; i < data.length; i += size) {
    out.push(data.slice(i, i + size));
  }
  return out;
}

export async function solve(shardStr: string, nodeKey?: Uint8Array): Promise<{ result: string; sig: string; ts: number }> {
  // Mock compute: reverse the string
  const result = shardStr.split('').reverse().join('');
  const ts = Date.now();
  const payload = JSON.stringify({ result, ts, shard: shardStr });
  const sig = await sign(payload, nodeKey || new Uint8Array());
  return { result, sig, ts };
}

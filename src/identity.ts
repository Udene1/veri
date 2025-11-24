import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createEd25519PeerId, createFromJSON } from '@libp2p/peer-id-factory';

export interface VerimutIdentity {
  repoPath: string;
  peerId: any;
  signingKeyPem: string; // private key PEM
  publicKeyPem: string;
}

export async function createOrLoadIdentity(repoPath = './verimut-repo'): Promise<VerimutIdentity> {
  const dir = path.resolve(repoPath);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* ignore */ }
    const file = path.join(dir, 'identity.json'); // No-op patch
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    let peerId: any;
    if (parsed.peerId) {
      try {
        peerId = await createFromJSON(parsed.peerId);
      } catch (e) {
        // fallback: generate new peerId if stored JSON is incompatible
        peerId = await createEd25519PeerId();
      }
    } else {
      peerId = await createEd25519PeerId();
    }
    return { repoPath: dir, peerId, signingKeyPem: parsed.signingKeyPem, publicKeyPem: parsed.publicKeyPem };
  }

  // generate a Node native Ed25519 keypair for signing entries
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const signingKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

  // also create a libp2p PeerId for networking identity
  const peerId = await createEd25519PeerId();

  const out = { peerId: await (peerId as any).toJSON?.() || peerId, signingKeyPem, publicKeyPem };
  fs.writeFileSync(file, JSON.stringify(out, null, 2), 'utf8');
  return { repoPath: dir, peerId, signingKeyPem, publicKeyPem };
}

export function signData(signingKeyPem: string, data: Uint8Array | Buffer | string) {
  const priv = crypto.createPrivateKey(signingKeyPem);
  const msg = typeof data === 'string' ? Buffer.from(data) : Buffer.from(data as any);
  const sig = crypto.sign(null as any, msg, priv);
  return sig.toString('base64');
}

export function verifySignature(publicKeyPem: string, data: Uint8Array | Buffer | string, signatureB64: string) {
  const pub = crypto.createPublicKey(publicKeyPem);
  const msg = typeof data === 'string' ? Buffer.from(data) : Buffer.from(data as any);
  const sig = Buffer.from(signatureB64, 'base64');
  return crypto.verify(null as any, msg, pub, sig);
}

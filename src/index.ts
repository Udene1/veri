import { FileBlockstore } from './blockstore.js';
import { VerimutLog } from './log.js';
import { createOrLoadIdentity, verifySignature } from './identity.js';

async function main() {
  console.log('Starting verimut-node demo...');
  const blocks = new FileBlockstore('./verimut-repo');
  const identity = await createOrLoadIdentity('./verimut-repo');
  const pidStr = identity && identity.peerId && typeof identity.peerId.toString === 'function' ? identity.peerId.toString() : '<peerId>';
  console.log('Identity peerId:', pidStr);
  const log = new VerimutLog('demo', blocks as any, identity as any);

  const cid = await log.add({ task: 'demo-task', payload: { foo: 'bar' } }, undefined);
  console.log('Added entry cid:', cid);

  const all = await log.all();
  console.log('Log entries:', all);

  // verify last entry signature
  if (all.length) {
    const last = all[all.length - 1];
    // read wrapped payload from blockstore to verify signature
    const raw = await blocks.get(last.cid);
    if (raw) {
      try {
        const obj = JSON.parse(Buffer.from(raw).toString('utf8'));
        const ok = verifySignature(obj.pubkey, JSON.stringify(obj.payload), obj.signature);
        console.log('Signature valid?', ok);
      } catch (e) { console.warn('Failed to verify entry signature', e); }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

export { FileBlockstore, VerimutLog };

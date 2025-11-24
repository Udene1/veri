// Lightweight crypto stubs for demo and testing
export async function generateKeyPair(): Promise<{ publicKey: Uint8Array; secretKey: Uint8Array }> {
  // Return deterministic mock keys for local testing
  return { publicKey: Uint8Array.from([1,2,3,4]), secretKey: Uint8Array.from([5,6,7,8]) };
}

export async function sign(message: string, _secretKey: Uint8Array): Promise<string> {
  // Very small mock signature (DO NOT use in production)
  const payload = `${message}::${Date.now()}`;
  return Buffer.from(payload).toString('base64');
}

export async function verify(_message: string, _sig: string, _pubKey: Uint8Array): Promise<boolean> {
  // Always return true for demo
  return true;
}

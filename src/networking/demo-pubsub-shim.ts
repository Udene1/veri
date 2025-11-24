import net from 'net';

type Msg = { topic: string; data: string };

class ShimPubsub {
  private server?: net.Server;
  private sockets: Set<net.Socket> = new Set();
  private client?: net.Socket | null = null;
  private listeners: ((evt: { detail: { topic: string; data: Buffer } }) => void)[] = [];

  async createServer(port: number) {
    this.server = net.createServer((sock) => {
      this.sockets.add(sock);
      sock.setEncoding('utf8');
  sock.on('data', (d: any) => this.onData(sock, String(d)));
      sock.on('close', () => this.sockets.delete(sock));
      sock.on('error', () => this.sockets.delete(sock));
    });
    await new Promise<void>((res, rej) => this.server!.listen(port, () => res()).on('error', rej));
    console.log('Demo shim server listening on', port);
  }

  private onData(origin: net.Socket, chunk: string) {
    try {
      const lines = chunk.split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        const msg: Msg = JSON.parse(line);
        const buf = Buffer.from(msg.data, 'utf8');
        // Emit locally
        for (const l of this.listeners) l({ detail: { topic: msg.topic, data: buf } });
        // Broadcast to all connected sockets except origin
        for (const s of Array.from(this.sockets)) {
          if (s !== origin && !s.destroyed) {
            s.write(JSON.stringify(msg) + '\n');
          }
        }
      }
    } catch (e) { /* ignore parse errors */ }
  }

  async createClient(host: string, port: number) {
    const sock = net.createConnection({ host, port });
    this.client = sock;
    sock.setEncoding('utf8');
    sock.on('data', (d: any) => this.onClientData(String(d)));
    sock.on('close', () => { this.client = null; });
    sock.on('error', () => { this.client = null; });
    await new Promise<void>((res, rej) => sock.on('connect', () => res()).on('error', rej));
    console.log('Demo shim client connected to', host + ':' + port);
    return sock;
  }

  private onClientData(chunk: string) {
    try {
      const lines = chunk.split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        const msg: Msg = JSON.parse(line);
        const buf = Buffer.from(msg.data, 'utf8');
        for (const l of this.listeners) l({ detail: { topic: msg.topic, data: buf } });
      }
    } catch (e) { /* ignore */ }
  }

  addEventListener(_evt: string, fn: (evt: any) => void) {
    this.listeners.push(fn);
  }

  async publish(topic: string, data: Buffer | Uint8Array) {
    const msg: Msg = { topic, data: Buffer.from(data).toString('utf8') };
    const line = JSON.stringify(msg) + '\n';
    // If we have a client socket (we are a client), write to server
    if (this.client && !this.client.destroyed) {
      this.client.write(line);
    }
    // Otherwise send to all connected sockets (server side)
    else {
      for (const s of Array.from(this.sockets)) {
        if (!s.destroyed) s.write(line);
      }
    }
    // Also emit locally so server-side handlers pick it up
    for (const l of this.listeners) l({ detail: { topic, data: Buffer.from(data) } });
  }

  async close() {
    try { this.server?.close(); } catch (e) { /* ignore */ }
    for (const s of Array.from(this.sockets)) { try { s.destroy(); } catch (e) { } }
    this.sockets.clear();
  }
}

export async function createDemoShimAsServer(port = 4001) {
  const shim = new ShimPubsub();
  await shim.createServer(port);
  return shim;
}

export async function createDemoShimAsClient(host = '127.0.0.1', port = 4001) {
  const shim = new ShimPubsub();
  await shim.createClient(host, port);
  return shim;
}

/**
 * Mesh Health Monitor - tracks gossipsub mesh formation and provides diagnostics
 */

export interface MeshHealth {
  topicPeers: number;
  connections: number;
  inboundConns: number;
  outboundConns: number;
  isHealthy: boolean;
  diagnosis: string;
}

export class MeshMonitor {
  private libp2p: any;
  private targetTopic: string;
  private checkInterval: number;
  private timer: any = null;
  private onHealthChange?: (health: MeshHealth) => void;
  private lastHealth: MeshHealth | null = null;

  constructor(
    libp2p: any, 
    targetTopic: string = '/verimut/verimut-tasks',
    checkInterval: number = 5000
  ) {
    this.libp2p = libp2p;
    this.targetTopic = targetTopic;
    this.checkInterval = checkInterval;
  }

  start(onHealthChange?: (health: MeshHealth) => void) {
    if (this.timer) return;
    this.onHealthChange = onHealthChange;
    
    this.timer = setInterval(() => {
      const health = this.checkHealth();
      
      // Only notify if health status changed
      if (this.lastHealth && health.isHealthy !== this.lastHealth.isHealthy) {
        if (this.onHealthChange) this.onHealthChange(health);
      }
      
      this.lastHealth = health;
    }, this.checkInterval);

    // Immediate check on start
    const initialHealth = this.checkHealth();
    this.lastHealth = initialHealth;
    if (this.onHealthChange) this.onHealthChange(initialHealth);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  checkHealth(): MeshHealth {
    try {
      const pubsub = this.libp2p?.pubsub ?? this.libp2p?.services?.pubsub;
      const connManager = this.libp2p?.connectionManager;
      
      // Get topic peers
      let topicPeers = 0;
      try {
        if (pubsub && typeof pubsub.getSubscribers === 'function') {
          topicPeers = pubsub.getSubscribers(this.targetTopic)?.length || 0;
        } else if (pubsub && typeof pubsub.getPeersForTopic === 'function') {
          topicPeers = pubsub.getPeersForTopic(this.targetTopic)?.length || 0;
        }
      } catch (e) { /* ignore */ }

      // Get connection counts
      let connections = 0;
      let inboundConns = 0;
      let outboundConns = 0;
      
      try {
        const conns = this.libp2p?.getConnections ? this.libp2p.getConnections() : [];
        connections = conns.length;
        
        for (const conn of conns) {
          const dir = conn.stat?.direction ?? conn.direction;
          if (dir === 'inbound') inboundConns++;
          else if (dir === 'outbound') outboundConns++;
        }
      } catch (e) { /* ignore */ }

      // Determine health
      let isHealthy = false;
      let diagnosis = '';

      if (connections === 0) {
        diagnosis = '⚠️ No libp2p connections';
      } else if (topicPeers === 0) {
        diagnosis = `⚠️ Connected (${connections}) but no peers in gossipsub mesh`;
      } else if (topicPeers < 2) {
        diagnosis = `⚡ Minimal mesh (${topicPeers} peer) - may experience delays`;
        isHealthy = true;
      } else {
        diagnosis = `✓ Healthy mesh (${topicPeers} peers, ${connections} connections)`;
        isHealthy = true;
      }

      return {
        topicPeers,
        connections,
        inboundConns,
        outboundConns,
        isHealthy,
        diagnosis
      };
    } catch (e) {
      return {
        topicPeers: 0,
        connections: 0,
        inboundConns: 0,
        outboundConns: 0,
        isHealthy: false,
        diagnosis: `❌ Error checking mesh: ${(e as any)?.message ?? e}`
      };
    }
  }

  getCurrentHealth(): MeshHealth {
    return this.lastHealth || this.checkHealth();
  }
}

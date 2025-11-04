/**
 * HTTP API Server for VerimutFS
 * Provides REST endpoints for frontend integration
 */

import * as http from 'http';
import type { NodeBundle } from '../networking/peer.js';

export interface ApiServerOptions {
  port: number;
  nodeBundle: NodeBundle;
}

// In-memory mapping of wallet addresses to their latest profile CIDs
const profileCIDMap = new Map<string, string>();

// User progress and points tracking
interface UserProgress {
  address: string;
  points: number;
  walletConnectedAt: Date | null;
  profileCompletedAt: Date | null;
  firstSkillUploadedAt: Date | null;
  transactionsCompleted: number;
  referralsCount: number;
  totalTransactionVolume: number; // Total value of transactions in USD/ETH
  escrowUsageCount: number;
  escrowAvoidanceCount: number;
  disputesWon: number;
  disputesLost: number;
  isProvider: boolean;
  trustScore: number;
  tasks: {
    walletConnected: boolean;
    profileCompleted: boolean;
    skillUploaded: boolean;
    firstTransaction: boolean;
  };
}

const userProgressMap = new Map<string, UserProgress>();

// Points configuration
const POINTS_CONFIG = {
  WALLET_CONNECT: 100,
  PROFILE_COMPLETE: 250,
  SKILL_UPLOAD: 500,
  FIRST_TRANSACTION: 1000,
  TRANSACTION_BONUS: 100, // per transaction after first
  REFERRAL_BONUS: 500,
  REFERRED_BONUS: 200
};

// Helper function to get or create user progress
function getUserProgress(address: string): UserProgress {
  const normalizedAddress = address.toLowerCase();
  if (!userProgressMap.has(normalizedAddress)) {
    userProgressMap.set(normalizedAddress, {
      address: normalizedAddress,
      points: 0,
      walletConnectedAt: null,
      profileCompletedAt: null,
      firstSkillUploadedAt: null,
      transactionsCompleted: 0,
      referralsCount: 0,
      totalTransactionVolume: 0,
      escrowUsageCount: 0,
      escrowAvoidanceCount: 0,
      disputesWon: 0,
      disputesLost: 0,
      isProvider: false,
      trustScore: 50, // Base trust score
      tasks: {
        walletConnected: false,
        profileCompleted: false,
        skillUploaded: false,
        firstTransaction: false
      }
    });
  }
  return userProgressMap.get(normalizedAddress)!;
}

// Helper function to award points
function awardPoints(address: string, points: number, reason: string): void {
  const progress = getUserProgress(address);
  progress.points += points;
  console.log(`[POINTS] Awarded ${points} points to ${address} for: ${reason}. Total: ${progress.points}`);
}

// Helper function to calculate trust score
function calculateTrustScore(progress: UserProgress): number {
  let score = 50; // Base score
  
  // Successful transactions bonus
  if (progress.isProvider) {
    score += progress.transactionsCompleted * 15; // Providers get more points
  } else {
    score += progress.transactionsCompleted * 10; // Customers get base points
  }
  
  // Volume bonus (1 point per $10 USD transaction volume)
  score += Math.floor(progress.totalTransactionVolume / 10);
  
  // Escrow usage bonus/penalty
  score += progress.escrowUsageCount * 5;
  if (progress.escrowAvoidanceCount > 0) {
    score = Math.max(0, score - (progress.escrowAvoidanceCount * 10));
  }
  
  // Completion rate (if has transactions)
  if (progress.transactionsCompleted > 0) {
    // Assume all completed transactions for now (in production, track separately)
    score += 20; // 100% completion rate bonus
  }
  
  // Dispute resolution
  score += progress.disputesWon * 5;
  score = Math.max(0, score - (progress.disputesLost * 20));
  
  // Platform activity bonus (basic implementation)
  if (progress.walletConnectedAt) {
    const weeksActive = Math.floor((Date.now() - progress.walletConnectedAt.getTime()) / (7 * 24 * 60 * 60 * 1000));
    score += Math.min(52, weeksActive); // Max 52 points for 1 year
  }
  
  // Early adopter bonus (first 1000 users)
  if (userProgressMap.size <= 1000) {
    score += 25;
  }
  
  // Cap at 1000
  return Math.min(1000, score);
}

// Helper function to update trust score
function updateTrustScore(address: string): void {
  const progress = getUserProgress(address);
  const oldScore = progress.trustScore;
  progress.trustScore = calculateTrustScore(progress);
  console.log(`[TRUST] Updated trust score for ${address}: ${oldScore} -> ${progress.trustScore}`);
}

// Helper function to determine next available task
function getNextAvailableTask(progress: UserProgress, canCompleteProfile: boolean = false): string {
  if (!progress.tasks.walletConnected) {
    return 'Connect your wallet to start earning points';
  }
  
  if (!progress.tasks.profileCompleted) {
    if (canCompleteProfile) {
      return 'Complete your profile (add skills, bio, and info)';
    } else {
      const daysLeft = Math.ceil((2 * 24 * 60 * 60 * 1000 - (Date.now() - (progress.walletConnectedAt?.getTime() || 0))) / (24 * 60 * 60 * 1000));
      return `Profile completion unlocks in ${Math.max(0, daysLeft)} day(s)`;
    }
  }
  
  if (!progress.tasks.skillUploaded) {
    return 'Upload your first skill or service';
  }
  
  if (!progress.tasks.firstTransaction) {
    return 'Complete your first transaction';
  }
  
  return 'Keep completing transactions and referring users to earn more points!';
}

export function createApiServer(options: ApiServerOptions): http.Server {
  const { port, nodeBundle } = options;

  const server = http.createServer(async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://localhost:${port}`);
    const path = url.pathname;

    // JSON response helper
    const sendJson = (data: any, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };

    const sendError = (message: string, status = 500) => {
      sendJson({ error: message }, status);
    };

    // Parse JSON body for POST/PUT
    const getBody = (): Promise<any> => {
      return new Promise((resolve, reject) => {
        if (req.method !== 'POST' && req.method !== 'PUT') {
          resolve(null);
          return;
        }
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            resolve(body ? JSON.parse(body) : null);
          } catch (e) {
            reject(e);
          }
        });
      });
    };

    try {
      // Status endpoint
      if (path === '/api/status' && req.method === 'GET') {
        const peers = nodeBundle.libp2p?.getPeers?.() || [];
        sendJson({
          status: 'running',
          peerId: nodeBundle.libp2p?.peerId?.toString() || '',
          peers: peers.length,
          addresses: nodeBundle.libp2p?.getMultiaddrs?.()?.map((a: any) => a.toString()) || []
        });
        return;
      }

      // Profile endpoints
      if (path === '/api/profile' && req.method === 'GET') {
        const address = url.searchParams.get('address');
        if (!address) {
          sendError('Missing address parameter', 400);
          return;
        }
        
        // Try to fetch profile from IPFS using stored CID
        try {
          const normalizedAddress = address.toLowerCase();
          const profileCID = profileCIDMap.get(normalizedAddress);
          
          if (!profileCID) {
            // No profile found for this address
            console.log('[API] No profile CID found for address:', address);
            sendJson({
              address,
              name: '',
              bio: '',
              skills: [],
              avatar: '',
              email: '',
              location: '',
              website: '',
              twitter: '',
              linkedin: '',
              experience: '',
              education: ''
            });
            return;
          }
          
          console.log('[API] Retrieving profile for address:', address, 'CID:', profileCID);
          
          // Retrieve the profile data from IPFS
          const { CID } = await import('multiformats/cid');
          const cid = CID.parse(profileCID);
          const bytes = await nodeBundle.helia.blockstore.get(cid);
          const profileData = JSON.parse(new TextDecoder().decode(bytes));
          
          console.log('[API] Retrieved profile from IPFS:', profileData);
          sendJson(profileData);
        } catch (e: any) {
          console.error('[API] Error retrieving profile:', e);
          sendError('Profile not found: ' + e.message, 404);
        }
        return;
      }

      // Get user profile - GET /api/user/:address (frontend expects this format)
      if (path.startsWith('/api/user/') && req.method === 'GET') {
        const address = path.split('/').pop();
        if (!address) {
          sendError('Missing address in URL', 400);
          return;
        }
        
        // Try to fetch profile from IPFS using stored CID
        try {
          const normalizedAddress = address.toLowerCase();
          const profileCID = profileCIDMap.get(normalizedAddress);
          
          if (!profileCID) {
            // No profile found for this address
            console.log('[API] No profile CID found for address:', address);
            sendJson({
              address,
              name: '',
              bio: '',
              skills: [],
              avatar: '',
              email: '',
              location: '',
              website: '',
              twitter: '',
              linkedin: '',
              experience: '',
              education: ''
            });
            return;
          }
          
          console.log('[API] Retrieving profile for address:', address, 'CID:', profileCID);
          
          // Retrieve the profile data from IPFS
          const { CID } = await import('multiformats/cid');
          const cid = CID.parse(profileCID);
          const bytes = await nodeBundle.helia.blockstore.get(cid);
          const profileData = JSON.parse(new TextDecoder().decode(bytes));
          
          console.log('[API] Retrieved profile from IPFS:', profileData);
          sendJson(profileData);
        } catch (e: any) {
          console.error('[API] Error retrieving profile:', e);
          sendError('Profile not found: ' + e.message, 404);
        }
        return;
      }

      // Update user profile - PUT /api/user/:address
      if (path.startsWith('/api/user/') && req.method === 'PUT') {
        console.log('[API] Received PUT request to:', path);
        const address = path.split('/').pop();
        console.log('[API] Extracted address:', address);
        const body = await getBody();
        console.log('[API] Parsed body:', body);
        if (!body) {
          sendError('Missing profile data', 400);
          return;
        }

        // Store profile to IPFS
        try {
          console.log('[API] Updating profile for address:', address);
          console.log('[API] nodeBundle.fs exists:', !!nodeBundle.fs);
          
          if (!nodeBundle.fs) {
            throw new Error('File system (fs) not initialized in node bundle');
          }

          const profileData = JSON.stringify({ ...body, address });
          const encoder = new TextEncoder();
          const bytes = encoder.encode(profileData);
          
          console.log('[API] Adding bytes to IPFS, size:', bytes.length);
          
          // Add to IPFS via Helia - use direct blockstore approach  
          let cid;
          try {
            // Use Helia's blockstore directly
            const { sha256 } = await import('multiformats/hashes/sha2');
            const { CID } = await import('multiformats/cid');
            const { code } = await import('multiformats/codecs/raw');
            
            const hash = await sha256.digest(bytes);
            cid = CID.create(1, code, hash);
            
            // Store the block
            await nodeBundle.helia.blockstore.put(cid, bytes);
            console.log('[API] Profile stored to IPFS blockstore:', cid.toString());
            
            // Store the address-to-CID mapping
            if (address) {
              profileCIDMap.set(address.toLowerCase(), cid.toString());
              console.log('[API] Stored CID mapping for address:', address);
            }
          } catch (blockstoreError: any) {
            console.error('[API] Blockstore error:', blockstoreError.message);
            throw new Error('Failed to store to IPFS: ' + blockstoreError.message);
          }
          
          // Publish to pubsub if available
          const pubsub = nodeBundle.verimut?.pubsub;
          if (pubsub && typeof pubsub.publish === 'function') {
            const updateMsg = JSON.stringify({
              type: 'profile_update',
              address,
              cid: cid.toString(),
              timestamp: Date.now()
            });
            await pubsub.publish('profile-updates', encoder.encode(updateMsg));
            console.log('[API] Published to pubsub');
          }

          // Award points for wallet connection (first time) and profile completion
          if (address) {
            const progress = getUserProgress(address);
            
            // Award wallet connection points if this is first time we see this address
            if (!progress.tasks.walletConnected) {
              progress.tasks.walletConnected = true;
              progress.walletConnectedAt = new Date();
              awardPoints(address, POINTS_CONFIG.WALLET_CONNECT, 'Wallet Connected');
            }
            
            // Check if this looks like a complete profile and award points if eligible
            const profileComplete = body.name && body.bio && (body.skills?.length > 0 || body.experience);
            if (profileComplete && !progress.tasks.profileCompleted) {
              const canCompleteProfile = progress.walletConnectedAt ? 
                (Date.now() - progress.walletConnectedAt.getTime()) >= (2 * 24 * 60 * 60 * 1000) : false;
                
              if (canCompleteProfile) {
                progress.tasks.profileCompleted = true;
                progress.profileCompletedAt = new Date();
                awardPoints(address, POINTS_CONFIG.PROFILE_COMPLETE, 'Profile Completed');
              }
            }
          }

          sendJson({
            success: true,
            cid: cid.toString(),
            message: 'Profile updated successfully'
          });
        } catch (e: any) {
          console.error('[API] Error updating profile:', e);
          sendError(e.message || 'Failed to update profile', 500);
        }
        return;
      }
      
      // Legacy endpoint - POST /api/profile
      if (path === '/api/profile' && req.method === 'POST') {
        const body = await getBody();
        if (!body) {
          sendError('Missing profile data', 400);
          return;
        }

        // Store profile to IPFS
        try {
          const profileData = JSON.stringify(body);
          const encoder = new TextEncoder();
          const bytes = encoder.encode(profileData);
          
          // Add to IPFS via Helia
          const cid = await nodeBundle.fs.addBytes(bytes);
          
          // Publish to pubsub if available
          const pubsub = nodeBundle.verimut?.pubsub;
          if (pubsub && typeof pubsub.publish === 'function') {
            const updateMsg = JSON.stringify({
              type: 'profile_update',
              address: body.address,
              cid: cid.toString(),
              timestamp: Date.now()
            });
            await pubsub.publish('profile-updates', encoder.encode(updateMsg));
          }

          sendJson({
            success: true,
            cid: cid.toString(),
            message: 'Profile updated successfully'
          });
        } catch (e: any) {
          sendError(e.message || 'Failed to update profile', 500);
        }
        return;
      }

      // Skills endpoints
      if (path === '/api/skills' && req.method === 'GET') {
        // Return mock skills for now
        sendJson({
          skills: []
        });
        return;
      }

      if (path.startsWith('/api/skills/') && req.method === 'GET') {
        const skillId = path.split('/').pop();
        sendJson({
          id: skillId,
          title: 'Sample Skill',
          description: 'Description',
          provider: '0x000...',
          price: '0',
          rating: 0
        });
        return;
      }

      // Bookings endpoint
      if (path === '/api/bookings' && req.method === 'GET') {
        sendJson({
          bookings: []
        });
        return;
      }

      // Messages endpoint
      if (path === '/api/messages' && req.method === 'GET') {
        sendJson({
          messages: []
        });
        return;
      }

      // Health check
      if (path === '/health') {
        sendJson({ healthy: true });
        return;
      }

      // Points and Progress System Endpoints
      
      // Get user progress and points - GET /api/user/:address/progress
      if (path.match(/^\/api\/user\/[^\/]+\/progress$/) && req.method === 'GET') {
        const address = path.split('/')[3];
        if (!address) {
          sendError('Missing address in URL', 400);
          return;
        }
        
        try {
          const progress = getUserProgress(address);
          
          // Check if profile completion task should be available (2 days after wallet connection)
          const canCompleteProfile = progress.walletConnectedAt ? 
            (Date.now() - progress.walletConnectedAt.getTime()) >= (2 * 24 * 60 * 60 * 1000) : false;
          
          sendJson({
            ...progress,
            canCompleteProfile,
            nextTask: getNextAvailableTask(progress, canCompleteProfile)
          });
        } catch (e: any) {
          sendError('Error fetching user progress: ' + e.message, 500);
        }
        return;
      }

      // Record wallet connection - POST /api/user/:address/connect-wallet
      if (path.match(/^\/api\/user\/[^\/]+\/connect-wallet$/) && req.method === 'POST') {
        const address = path.split('/')[3];
        if (!address) {
          sendError('Missing address in URL', 400);
          return;
        }
        
        try {
          const progress = getUserProgress(address);
          
          if (!progress.tasks.walletConnected) {
            progress.tasks.walletConnected = true;
            progress.walletConnectedAt = new Date();
            awardPoints(address, POINTS_CONFIG.WALLET_CONNECT, 'Wallet Connection');
            
            sendJson({
              success: true,
              pointsAwarded: POINTS_CONFIG.WALLET_CONNECT,
              totalPoints: progress.points,
              message: 'Wallet connected! Points awarded.',
              nextTask: 'Wait 2 days to unlock profile completion task'
            });
          } else {
            sendJson({
              success: true,
              pointsAwarded: 0,
              totalPoints: progress.points,
              message: 'Wallet already connected',
              nextTask: getNextAvailableTask(progress)
            });
          }
        } catch (e: any) {
          sendError('Error recording wallet connection: ' + e.message, 500);
        }
        return;
      }

      // Record skill upload - POST /api/user/:address/skill-uploaded
      if (path.match(/^\/api\/user\/[^\/]+\/skill-uploaded$/) && req.method === 'POST') {
        const address = path.split('/')[3];
        if (!address) {
          sendError('Missing address in URL', 400);
          return;
        }
        
        try {
          const progress = getUserProgress(address);
          
          if (!progress.tasks.skillUploaded && progress.tasks.profileCompleted) {
            progress.tasks.skillUploaded = true;
            progress.firstSkillUploadedAt = new Date();
            awardPoints(address, POINTS_CONFIG.SKILL_UPLOAD, 'First Skill Upload');
            
            sendJson({
              success: true,
              pointsAwarded: POINTS_CONFIG.SKILL_UPLOAD,
              totalPoints: progress.points,
              message: 'Skill uploaded! Points awarded.',
              nextTask: 'Complete your first transaction to earn more points'
            });
          } else if (!progress.tasks.profileCompleted) {
            sendJson({
              success: false,
              message: 'Please complete your profile first',
              nextTask: 'Complete your profile'
            });
          } else {
            sendJson({
              success: true,
              pointsAwarded: 0,
              totalPoints: progress.points,
              message: 'Skill upload bonus already claimed'
            });
          }
        } catch (e: any) {
          sendError('Error recording skill upload: ' + e.message, 500);
        }
        return;
      }

      // Record transaction completion - POST /api/user/:address/transaction
      if (path.match(/^\/api\/user\/[^\/]+\/transaction$/) && req.method === 'POST') {
        const address = path.split('/')[3];
        if (!address) {
          sendError('Missing address in URL', 400);
          return;
        }
        
        try {
          const progress = getUserProgress(address);
          progress.transactionsCompleted++;
          
          let pointsAwarded = 0;
          let message = '';
          
          if (!progress.tasks.firstTransaction) {
            progress.tasks.firstTransaction = true;
            pointsAwarded = POINTS_CONFIG.FIRST_TRANSACTION;
            message = 'First transaction completed! Bonus points awarded.';
          } else {
            pointsAwarded = POINTS_CONFIG.TRANSACTION_BONUS;
            message = `Transaction #${progress.transactionsCompleted} completed!`;
          }
          
          awardPoints(address, pointsAwarded, `Transaction #${progress.transactionsCompleted}`);
          
          sendJson({
            success: true,
            pointsAwarded,
            totalPoints: progress.points,
            transactionNumber: progress.transactionsCompleted,
            message
          });
        } catch (e: any) {
          sendError('Error recording transaction: ' + e.message, 500);
        }
        return;
      }

      // Record referral - POST /api/user/:address/referral
      if (path.match(/^\/api\/user\/[^\/]+\/referral$/) && req.method === 'POST') {
        const address = path.split('/')[3];
        const body = await getBody();
        
        if (!address || !body?.referredAddress) {
          sendError('Missing address or referredAddress', 400);
          return;
        }
        
        try {
          const referrerProgress = getUserProgress(address);
          const referredProgress = getUserProgress(body.referredAddress);
          
          // Award points to both users
          referrerProgress.referralsCount++;
          awardPoints(address, POINTS_CONFIG.REFERRAL_BONUS, 'Successful Referral');
          awardPoints(body.referredAddress, POINTS_CONFIG.REFERRED_BONUS, 'Referred by ' + address.slice(0, 8));
          
          sendJson({
            success: true,
            referrerPointsAwarded: POINTS_CONFIG.REFERRAL_BONUS,
            referredPointsAwarded: POINTS_CONFIG.REFERRED_BONUS,
            referrerTotalPoints: referrerProgress.points,
            message: 'Referral bonus awarded to both users!'
          });
        } catch (e: any) {
          sendError('Error processing referral: ' + e.message, 500);
        }
        return;
      }

      // Get leaderboard - GET /api/leaderboard
      if (path === '/api/leaderboard' && req.method === 'GET') {
        try {
          const leaderboard = Array.from(userProgressMap.values())
            .sort((a, b) => b.points - a.points)
            .slice(0, 20)
            .map(user => ({
              address: user.address.slice(0, 6) + '...' + user.address.slice(-4),
              points: user.points,
              transactionsCompleted: user.transactionsCompleted,
              referralsCount: user.referralsCount
            }));
          
          sendJson({ leaderboard });
        } catch (e: any) {
          sendError('Error fetching leaderboard: ' + e.message, 500);
        }
        return;
      }

      // Platform statistics endpoint
      if (path === '/api/stats' && req.method === 'GET') {
        try {
          // Generate stats based on our VerimutFS node
          const stats = {
            totalSkills: profileCIDMap.size * 3, // Estimate skills based on profiles
            totalUsers: profileCIDMap.size,
            totalSessions: Math.floor(profileCIDMap.size * 1.5),
            activeNodes: 1, // This node
            totalProfiles: profileCIDMap.size,
            ipfsBlocks: profileCIDMap.size,
            networkPeers: nodeBundle.libp2p?.getPeers?.()?.length || 0
          };
          sendJson(stats);
        } catch (e: any) {
          sendError('Stats error: ' + e.message, 500);
        }
        return;
      }

      // Debug endpoint to check fs object
      if (path === '/debug/fs' && req.method === 'GET') {
        try {
          const fsInfo = {
            exists: !!nodeBundle.fs,
            type: typeof nodeBundle.fs,
            methods: nodeBundle.fs ? Object.getOwnPropertyNames(nodeBundle.fs) : [],
            prototype_methods: nodeBundle.fs ? Object.getOwnPropertyNames(Object.getPrototypeOf(nodeBundle.fs)) : []
          };
          sendJson(fsInfo);
        } catch (e: any) {
          sendError('Debug error: ' + e.message, 500);
        }
        return;
      }

      // Debug endpoint to check profile CID mappings
      if (path === '/debug/profiles' && req.method === 'GET') {
        try {
          const mappings = Object.fromEntries(profileCIDMap);
          sendJson({
            count: profileCIDMap.size,
            mappings: mappings
          });
        } catch (e: any) {
          sendError('Debug error: ' + e.message, 500);
        }
        return;
      }

      // Points endpoints
      
      // Get user points - GET /api/points/:address
      if (path.startsWith('/api/points/') && req.method === 'GET') {
        const address = path.split('/').pop();
        if (!address) {
          sendError('Missing address in URL', 400);
          return;
        }
        
        try {
          const progress = getUserProgress(address);
          
          // Check if profile completion task is unlocked (2 days after wallet connect)
          const canCompleteProfile = progress.walletConnectedAt ? 
            (Date.now() - progress.walletConnectedAt.getTime()) >= (2 * 24 * 60 * 60 * 1000) : false;
          
          sendJson({
            points: progress.points,
            tasks: progress.tasks,
            nextTask: getNextAvailableTask(progress, canCompleteProfile),
            canCompleteProfile,
            stats: {
              transactionsCompleted: progress.transactionsCompleted,
              referralsCount: progress.referralsCount,
              walletConnectedAt: progress.walletConnectedAt,
              profileCompletedAt: progress.profileCompletedAt,
              firstSkillUploadedAt: progress.firstSkillUploadedAt
            }
          });
        } catch (e: any) {
          sendError('Error fetching points: ' + e.message, 500);
        }
        return;
      }

      // Award points - POST /api/points/:address/award
      if (path.match(/^\/api\/points\/[^\/]+\/award$/) && req.method === 'POST') {
        const addressMatch = path.match(/^\/api\/points\/([^\/]+)\/award$/);
        const address = addressMatch ? addressMatch[1] : null;
        
        if (!address) {
          sendError('Missing address in URL', 400);
          return;
        }
        
        const body = await getBody();
        if (!body || !body.task) {
          sendError('Missing task in request body', 400);
          return;
        }
        
        try {
          const progress = getUserProgress(address);
          let pointsAwarded = 0;
          let message = '';
          
          switch (body.task) {
            case 'wallet_connect':
              if (!progress.tasks.walletConnected) {
                progress.tasks.walletConnected = true;
                progress.walletConnectedAt = new Date();
                pointsAwarded = POINTS_CONFIG.WALLET_CONNECT;
                awardPoints(address, pointsAwarded, 'Wallet Connected');
                message = 'Welcome! You earned points for connecting your wallet!';
              } else {
                message = 'Wallet already connected';
              }
              break;
              
            case 'profile_complete':
              const canCompleteProfile = progress.walletConnectedAt ? 
                (Date.now() - progress.walletConnectedAt.getTime()) >= (2 * 24 * 60 * 60 * 1000) : false;
                
              if (!progress.tasks.profileCompleted && canCompleteProfile) {
                progress.tasks.profileCompleted = true;
                progress.profileCompletedAt = new Date();
                pointsAwarded = POINTS_CONFIG.PROFILE_COMPLETE;
                awardPoints(address, pointsAwarded, 'Profile Completed');
                message = 'Great job completing your profile!';
              } else if (!canCompleteProfile) {
                sendError('Profile completion task not yet unlocked', 400);
                return;
              } else {
                message = 'Profile already completed';
              }
              break;
              
            case 'skill_upload':
              if (!progress.tasks.skillUploaded) {
                progress.tasks.skillUploaded = true;
                progress.firstSkillUploadedAt = new Date();
                pointsAwarded = POINTS_CONFIG.SKILL_UPLOAD;
                awardPoints(address, pointsAwarded, 'First Skill Uploaded');
                message = 'Awesome! You uploaded your first skill!';
              } else {
                message = 'First skill already uploaded';
              }
              break;
              
            case 'transaction':
              progress.transactionsCompleted++;
              if (!progress.tasks.firstTransaction) {
                progress.tasks.firstTransaction = true;
                pointsAwarded = POINTS_CONFIG.FIRST_TRANSACTION;
                awardPoints(address, pointsAwarded, 'First Transaction Completed');
                message = 'Congratulations on your first transaction!';
              } else {
                pointsAwarded = POINTS_CONFIG.TRANSACTION_BONUS;
                awardPoints(address, pointsAwarded, `Transaction #${progress.transactionsCompleted}`);
                message = `Transaction completed! You've now completed ${progress.transactionsCompleted} transactions.`;
              }
              break;
              
            case 'referral':
              progress.referralsCount++;
              pointsAwarded = POINTS_CONFIG.REFERRAL_BONUS;
              awardPoints(address, pointsAwarded, 'Successful Referral');
              message = `Great referral! You now have ${progress.referralsCount} successful referrals.`;
              break;
              
            default:
              sendError('Unknown task type', 400);
              return;
          }
          
          sendJson({
            success: true,
            pointsAwarded,
            totalPoints: progress.points,
            message,
            nextTask: getNextAvailableTask(progress, progress.walletConnectedAt ? 
              (Date.now() - progress.walletConnectedAt.getTime()) >= (2 * 24 * 60 * 60 * 1000) : false)
          });
        } catch (e: any) {
          sendError('Error awarding points: ' + e.message, 500);
        }
        return;
      }

      // Complete task - POST /api/tasks/:address/complete
      if (path.match(/^\/api\/tasks\/[^\/]+\/complete$/) && req.method === 'POST') {
        const addressMatch = path.match(/^\/api\/tasks\/([^\/]+)\/complete$/);
        const address = addressMatch ? addressMatch[1] : null;
        
        if (!address) {
          sendError('Missing address in URL', 400);
          return;
        }
        
        const body = await getBody();
        if (!body || !body.task) {
          sendError('Missing task in request body', 400);
          return;
        }
        
        // Forward to the award points endpoint
        try {
          const progress = getUserProgress(address);
          
          // This endpoint just marks tasks as complete and awards points
          // Redirect to the award endpoint for consistency
          const response = await fetch(`http://localhost:${port}/api/points/${address}/award`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ task: body.task })
          });
          
          const result = await response.json();
          sendJson(result, response.status);
        } catch (e: any) {
          sendError('Error completing task: ' + e.message, 500);
        }
        return;
      }

      // Record transaction - POST /api/transactions/record
      if (path === '/api/transactions/record' && req.method === 'POST') {
        const body = await getBody();
        if (!body || !body.customer || !body.provider || !body.amount) {
          sendError('Missing required fields: customer, provider, amount', 400);
          return;
        }
        
        try {
          const { customer, provider, amount, usedEscrow = true } = body;
          
          // Update both parties' progress
          const customerProgress = getUserProgress(customer);
          const providerProgress = getUserProgress(provider);
          
          // Mark provider as provider
          providerProgress.isProvider = true;
          
          // Update transaction counts
          customerProgress.transactionsCompleted++;
          providerProgress.transactionsCompleted++;
          
          // Update transaction volume
          customerProgress.totalTransactionVolume += amount;
          providerProgress.totalTransactionVolume += amount;
          
          // Update escrow usage
          if (usedEscrow) {
            customerProgress.escrowUsageCount++;
            providerProgress.escrowUsageCount++;
          } else {
            customerProgress.escrowAvoidanceCount++;
            providerProgress.escrowAvoidanceCount++;
          }
          
          // Update trust scores
          updateTrustScore(customer);
          updateTrustScore(provider);
          
          sendJson({
            success: true,
            message: 'Transaction recorded successfully',
            customerTrustScore: customerProgress.trustScore,
            providerTrustScore: providerProgress.trustScore
          });
        } catch (e: any) {
          sendError('Error recording transaction: ' + e.message, 500);
        }
        return;
      }

      // Get trust score - GET /api/trust/:address
      if (path.startsWith('/api/trust/') && req.method === 'GET') {
        const address = path.split('/').pop();
        if (!address) {
          sendError('Missing address in URL', 400);
          return;
        }
        
        try {
          const progress = getUserProgress(address);
          
          sendJson({
            address: progress.address,
            trustScore: progress.trustScore,
            totalTransactions: progress.transactionsCompleted,
            totalVolume: progress.totalTransactionVolume,
            escrowUsage: {
              used: progress.escrowUsageCount,
              avoided: progress.escrowAvoidanceCount,
              percentage: progress.escrowUsageCount + progress.escrowAvoidanceCount > 0 ? 
                Math.round((progress.escrowUsageCount / (progress.escrowUsageCount + progress.escrowAvoidanceCount)) * 100) : 0
            },
            disputes: {
              won: progress.disputesWon,
              lost: progress.disputesLost
            },
            isProvider: progress.isProvider,
            memberSince: progress.walletConnectedAt
          });
        } catch (e: any) {
          sendError('Error fetching trust score: ' + e.message, 500);
        }
        return;
      }

      // VNS endpoints
      if (path.startsWith('/api/vns/')) {
        const vnsStore = (nodeBundle as any).vns?.store;
        
        if (!vnsStore) {
          sendError('VNS not enabled on this node', 503);
          return;
        }

        // POST /api/vns/register - Register a new VNS name
        if (path === '/api/vns/register' && req.method === 'POST') {
          try {
            const body = await getBody();
            if (!body || !body.name || !body.owner || !body.records) {
              sendError('Missing required fields: name, owner, records', 400);
              return;
            }

            // Extract peer ID from connection or use a default
            const peerId = nodeBundle.libp2p?.peerId?.toString() || 'api-client';

            const result = await vnsStore.register(body, peerId);
            
            if (result.success) {
              sendJson({
                success: true,
                cid: result.cid,
                message: `Successfully registered ${body.name}`
              });
            } else {
              sendError(result.error || 'Registration failed', 400);
            }
          } catch (e: any) {
            sendError('Registration error: ' + e.message, 500);
          }
          return;
        }

        // GET /api/vns/resolve/:name - Resolve a VNS name
        if (path.startsWith('/api/vns/resolve/') && req.method === 'GET') {
          try {
            const name = decodeURIComponent(path.replace('/api/vns/resolve/', ''));
            const result = await vnsStore.resolve(name);
            
            sendJson({
              entry: result.found ? result : null,
              ttl: result.ttl || 3600
            });
          } catch (e: any) {
            sendError('Resolution error: ' + e.message, 500);
          }
          return;
        }

        // POST /api/vns/transfer/:name - Transfer name ownership
        if (path.startsWith('/api/vns/transfer/') && req.method === 'POST') {
          try {
            const name = decodeURIComponent(path.replace('/api/vns/transfer/', ''));
            const body = await getBody();
            
            if (!body || !body.newOwner || !body.signature) {
              sendError('Missing required fields: newOwner, signature', 400);
              return;
            }

            const peerId = body.currentOwner || nodeBundle.libp2p?.peerId?.toString() || 'api-client';
            const result = await vnsStore.transfer(name, body.newOwner, body.signature, peerId);
            
            if (result.success) {
              sendJson({
                success: true,
                message: `Successfully transferred ${name} to ${body.newOwner}`
              });
            } else {
              sendError(result.error || 'Transfer failed', 400);
            }
          } catch (e: any) {
            sendError('Transfer error: ' + e.message, 500);
          }
          return;
        }

        // GET /api/vns/query?owner=<pubkey> - Query names by owner
        if (path === '/api/vns/query' && req.method === 'GET') {
          try {
            const owner = url.searchParams.get('owner');
            if (!owner) {
              sendError('Missing owner parameter', 400);
              return;
            }

            const names = vnsStore.getNamesByOwner(owner);
            sendJson({ names });
          } catch (e: any) {
            sendError('Query error: ' + e.message, 500);
          }
          return;
        }

        // GET /api/vns/status - VNS status and stats
        if (path === '/api/vns/status' && req.method === 'GET') {
          try {
            sendJson({
              enabled: vnsStore.isEnabled(),
              entries: vnsStore.size(),
              merkleRoot: vnsStore.getMerkleRoot(),
              config: {
                tld: '.vfs',
                powDifficulty: 3,
                rateLimit: '5/hour',
                expiration: '1 year',
                ttl: '3600s'
              }
            });
          } catch (e: any) {
            sendError('Status error: ' + e.message, 500);
          }
          return;
        }
      }

      // 404
      sendError('Not found', 404);
    } catch (e: any) {
      console.error('API error:', e);
      sendError(e.message || 'Internal server error', 500);
    }
  });

  server.listen(port, () => {
    console.log(`API server listening on http://localhost:${port}`);
  });

  return server;
}

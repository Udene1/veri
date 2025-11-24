#!/usr/bin/env node

/**
 * VerimutFS Node
 * Decentralized peer-to-peer node for the Verimut skill-sharing platform
 * 
 * Run: node dist/cli.js [options]
 * Or: npm start
 */

import { Command } from 'commander';
import { VerimutNode } from './node-manager.js';
import { loadConfig } from './config.js';
import chalk from 'chalk';
import figlet from 'figlet';
import { createVNSCommand } from './cli/vns-commands.js';

const program = new Command();

// Display banner
console.log(
  chalk.cyan(
    figlet.textSync('VerimutFS', { horizontalLayout: 'full' })
  )
);
console.log(chalk.gray('Decentralized Skill-Sharing Network\n'));

// CLI configuration
program
  .name('verimutfs')
  .description('VerimutFS P2P Node - Join the Verimut skill-sharing network')
  .version('1.0.0')
  .option('-p, --port <port>', 'Listen port (0 for random)', '0')
  .option('-b, --bootstrap <peers...>', 'Bootstrap peer multiaddrs')
  .option('--api-port <port>', 'HTTP API port', '3001')
  .option('--no-api', 'Disable HTTP API server')
  .option('--data-dir <path>', 'Data storage directory', './verimut-data')
  .option('--profile <file>', 'Profile JSON file to publish on startup')
  .option('--enable-vns', 'Enable Verimut Name Service (VNS)')
  .option('--verbose', 'Enable verbose logging');

// Add VNS subcommand
program.addCommand(createVNSCommand());

// Add default action to start the node
program.action(async (options) => {
  await main(options);
});

program.parse(process.argv);

/**
 * Main entry point
 */
async function main(options: any) {
  try {
    console.log(chalk.blue('🚀 Starting VerimutFS Node...\n'));

    // Load configuration
    const config = loadConfig({
      listenPort: parseInt(options.port),
      apiPort: options.api ? parseInt(options.apiPort) : null,
      bootstrapPeers: options.bootstrap || [],
      dataDir: options.dataDir,
      verbose: options.verbose,
      enableVNS: options.enableVns
    });

    // Initialize node
    const node = new VerimutNode(config);
    await node.start();

    console.log(chalk.green('✅ Node started successfully!\n'));
    console.log(chalk.cyan('📊 Node Information:'));
    console.log(chalk.gray(`   Peer ID: ${node.peerId}`));
    console.log(chalk.gray(`   Listen Addresses: ${node.addresses.join(', ')}`));
    
    if (config.apiPort) {
      console.log(chalk.gray(`   API Server: http://localhost:${config.apiPort}`));
    }
    
    console.log(chalk.gray(`   Data Directory: ${config.dataDir}`));
    console.log(chalk.gray(`   Bootstrap Peers: ${config.bootstrapPeers.length} configured\n`));

    // Load and publish profile if provided
    if (options.profile) {
      console.log(chalk.blue(`📝 Loading profile from ${options.profile}...`));
      await node.loadAndPublishProfile(options.profile);
      console.log(chalk.green('✅ Profile published to network\n'));
    }

    // Display connection status
    setInterval(() => {
      const peers = node.getConnectedPeers();
      console.log(chalk.cyan(`📡 Connected to ${peers.length} peers`));
    }, 30000); // Every 30 seconds

    // Graceful shutdown
    const shutdown = async () => {
      console.log(chalk.yellow('\n⏹️  Shutting down node...'));
      await node.stop();
      console.log(chalk.green('✅ Node stopped successfully'));
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    console.log(chalk.green('🌐 VerimutFS Node is running!'));
    console.log(chalk.gray('Press Ctrl+C to stop\n'));

  } catch (error) {
    console.error(chalk.red('❌ Failed to start node:'), error);
    process.exit(1);
  }
}

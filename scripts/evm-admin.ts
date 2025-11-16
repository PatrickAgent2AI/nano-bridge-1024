#!/usr/bin/env ts-node

/**
 * EVM Admin Operations Script
 * 
 * 管理员可用功能：
 * 1. initialize - 初始化合约
 * 2. configureUsdc - 配置 USDC 地址
 * 3. configurePeer - 配置对端合约
 * 4. addRelayer - 添加 Relayer
 * 5. removeRelayer - 移除 Relayer
 * 6. addLiquidity - 增加流动性
 * 7. withdrawLiquidity - 提取流动性
 */

import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
import * as path from 'path';

// 加载环境变量
dotenv.config({ path: path.resolve(__dirname, '../.env.invoke') });

// ============ ABI 定义 ============

const BRIDGE_ABI = [
  // Admin functions
  'function initialize(address vaultAddress, address adminAddress) external',
  'function configureUsdc(address usdcAddress) external',
  'function configurePeer(bytes32 peerContract, uint64 sourceChainId, uint64 targetChainId) external',
  'function addRelayer(address relayerAddress) external',
  'function removeRelayer(address relayerAddress) external',
  'function addLiquidity(uint256 amount) external',
  'function withdrawLiquidity(uint256 amount) external',
  
  // View functions
  'function senderState() external view returns (address vault, address admin, address usdcContract, uint64 nonce, bytes32 targetContract, uint64 sourceChainId, uint64 targetChainId)',
  'function receiverState() external view returns (address vault, address admin, address usdcContract, uint64 relayerCount, bytes32 sourceContract, uint64 sourceChainId, uint64 targetChainId, uint64 lastNonce)',
  'function getRelayers() external view returns (address[])',
];

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function balanceOf(address account) external view returns (uint256)',
];

// ============ 配置 ============

interface Config {
  rpcUrl: string;
  contractAddress: string;
  adminPrivateKey: string;
  vaultAddress: string;
  usdcContract: string;
  peerContract: string;
  sourceChainId: number;
  targetChainId: number;
  relayerAddresses: string[];
  liquidityAmount: string;
}

function loadConfig(): Config {
  const relayersStr = process.env.RELAYER_ADDRESSES_EVM || '';
  const relayers = relayersStr.split(',').filter(r => r.trim());

  return {
    rpcUrl: process.env.EVM_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc',
    contractAddress: process.env.EVM_CONTRACT_ADDRESS || '',
    adminPrivateKey: process.env.ADMIN_EVM_PRIVATE_KEY || '',
    vaultAddress: process.env.EVM_VAULT_ADDRESS || '',
    usdcContract: process.env.USDC_EVM_CONTRACT || '',
    peerContract: process.env.PEER_CONTRACT_ADDRESS_FOR_EVM || '',
    sourceChainId: parseInt(process.env.EVM_CHAIN_ID || '421614'),
    targetChainId: parseInt(process.env.SVM_CHAIN_ID || '91024'),
    relayerAddresses: relayers,
    liquidityAmount: process.env.INITIAL_LIQUIDITY_AMOUNT || '100000000',
  };
}

// ============ 辅助函数 ============

function printHeader(title: string) {
  console.log('\n============================================');
  console.log(title);
  console.log('============================================\n');
}

function printSuccess(message: string) {
  console.log(`✓ ${message}`);
}

function printError(message: string) {
  console.error(`✗ ${message}`);
}

async function waitForTx(tx: any, message: string) {
  console.log(`  TX Hash: ${tx.hash}`);
  console.log(`  Waiting for confirmation...`);
  const receipt = await tx.wait();
  printSuccess(message);
  console.log(`  Block: ${receipt.blockNumber}`);
  console.log(`  Gas Used: ${receipt.gasUsed.toString()}`);
  console.log('');
  return receipt;
}

// ============ 管理员操作 ============

async function initialize() {
  printHeader('初始化合约 (Initialize)');

  const config = loadConfig();
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const wallet = new ethers.Wallet(config.adminPrivateKey, provider);
  const bridge = new ethers.Contract(config.contractAddress, BRIDGE_ABI, wallet);

  console.log('配置信息:');
  console.log(`  Contract: ${config.contractAddress}`);
  console.log(`  Admin: ${wallet.address}`);
  console.log(`  Vault: ${config.vaultAddress}`);
  console.log('');

  try {
    console.log('执行初始化...');
    const tx = await bridge.initialize(config.vaultAddress, wallet.address);
    await waitForTx(tx, '初始化成功！');
    
    console.log(`Explorer: https://sepolia.arbiscan.io/tx/${tx.hash}`);

  } catch (error: any) {
    printError(`初始化失败: ${error.message}`);
    if (error.reason) console.error(`  Reason: ${error.reason}`);
    throw error;
  }
}

async function configureUsdc() {
  printHeader('配置 USDC (Configure USDC)');

  const config = loadConfig();
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const wallet = new ethers.Wallet(config.adminPrivateKey, provider);
  const bridge = new ethers.Contract(config.contractAddress, BRIDGE_ABI, wallet);

  console.log('配置信息:');
  console.log(`  Admin: ${wallet.address}`);
  console.log(`  USDC Contract: ${config.usdcContract}`);
  console.log('');

  try {
    console.log('执行配置 USDC...');
    const tx = await bridge.configureUsdc(config.usdcContract);
    await waitForTx(tx, 'USDC 配置成功！');
    
    console.log(`Explorer: https://sepolia.arbiscan.io/tx/${tx.hash}`);

  } catch (error: any) {
    printError(`配置 USDC 失败: ${error.message}`);
    if (error.reason) console.error(`  Reason: ${error.reason}`);
    throw error;
  }
}

async function configurePeer() {
  printHeader('配置对端合约 (Configure Peer)');

  const config = loadConfig();
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const wallet = new ethers.Wallet(config.adminPrivateKey, provider);
  const bridge = new ethers.Contract(config.contractAddress, BRIDGE_ABI, wallet);

  console.log('配置信息:');
  console.log(`  Admin: ${wallet.address}`);
  console.log(`  Peer Contract: ${config.peerContract}`);
  console.log(`  Source Chain ID: ${config.sourceChainId}`);
  console.log(`  Target Chain ID: ${config.targetChainId}`);
  console.log('');

  try {
    console.log('执行配置对端合约...');
    
    // Convert peer contract to bytes32 format
    // Support both EVM addresses (0x...) and Solana addresses (base58)
    let peerContractBytes32: string;
    if (config.peerContract.startsWith('0x')) {
      // EVM address: pad to 32 bytes
      peerContractBytes32 = ethers.zeroPadValue(config.peerContract, 32);
    } else {
      // Assume it's a base58 Solana address - convert to bytes32
      // For now, we'll just pad the hex representation
      // In production, you'd want to properly decode base58
      const buffer = Buffer.from(config.peerContract, 'utf-8');
      const hex = '0x' + buffer.toString('hex').padEnd(64, '0');
      peerContractBytes32 = hex.slice(0, 66); // Take first 32 bytes
    }
    
    console.log(`  Peer Contract (bytes32): ${peerContractBytes32}`);
    
    const tx = await bridge.configurePeer(
      peerContractBytes32,
      config.sourceChainId,
      config.targetChainId
    );
    await waitForTx(tx, '对端合约配置成功！');
    
    console.log(`Explorer: https://sepolia.arbiscan.io/tx/${tx.hash}`);

  } catch (error: any) {
    printError(`配置对端失败: ${error.message}`);
    if (error.reason) console.error(`  Reason: ${error.reason}`);
    throw error;
  }
}

async function addRelayer(relayerAddress?: string) {
  printHeader('添加 Relayer (Add Relayer)');

  const config = loadConfig();
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const wallet = new ethers.Wallet(config.adminPrivateKey, provider);
  const bridge = new ethers.Contract(config.contractAddress, BRIDGE_ABI, wallet);

  const relayers = relayerAddress ? [relayerAddress] : config.relayerAddresses;

  if (relayers.length === 0) {
    throw new Error('No relayer addresses provided');
  }

  console.log('配置信息:');
  console.log(`  Admin: ${wallet.address}`);
  console.log(`  Relayers to add: ${relayers.length}`);
  console.log('');

  try {
    for (const relayer of relayers) {
      console.log(`Adding relayer: ${relayer}`);
      const tx = await bridge.addRelayer(relayer);
      await waitForTx(tx, `Relayer ${relayer} 添加成功！`);
    }

    printSuccess('所有 Relayers 添加完成！');

  } catch (error: any) {
    printError(`添加 Relayer 失败: ${error.message}`);
    if (error.reason) console.error(`  Reason: ${error.reason}`);
    throw error;
  }
}

async function removeRelayer(relayerAddress: string) {
  printHeader('移除 Relayer (Remove Relayer)');

  const config = loadConfig();
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const wallet = new ethers.Wallet(config.adminPrivateKey, provider);
  const bridge = new ethers.Contract(config.contractAddress, BRIDGE_ABI, wallet);

  console.log('配置信息:');
  console.log(`  Admin: ${wallet.address}`);
  console.log(`  Relayer to remove: ${relayerAddress}`);
  console.log('');

  try {
    console.log('执行移除 Relayer...');
    const tx = await bridge.removeRelayer(relayerAddress);
    await waitForTx(tx, 'Relayer 移除成功！');
    
    console.log(`Explorer: https://sepolia.arbiscan.io/tx/${tx.hash}`);

  } catch (error: any) {
    printError(`移除 Relayer 失败: ${error.message}`);
    if (error.reason) console.error(`  Reason: ${error.reason}`);
    throw error;
  }
}

async function addLiquidity(amount?: string) {
  printHeader('增加流动性 (Add Liquidity)');

  const config = loadConfig();
  const liquidityAmount = amount || config.liquidityAmount;
  
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const wallet = new ethers.Wallet(config.adminPrivateKey, provider);
  const bridge = new ethers.Contract(config.contractAddress, BRIDGE_ABI, wallet);
  const usdc = new ethers.Contract(config.usdcContract, ERC20_ABI, wallet);

  console.log('配置信息:');
  console.log(`  Admin: ${wallet.address}`);
  console.log(`  Amount: ${liquidityAmount}`);
  console.log('');

  try {
    // 1. 批准 USDC
    console.log('步骤 1: 批准 USDC...');
    const approveTx = await usdc.approve(config.contractAddress, liquidityAmount);
    await waitForTx(approveTx, 'USDC 批准成功！');

    // 2. 添加流动性
    console.log('步骤 2: 添加流动性...');
    const addTx = await bridge.addLiquidity(liquidityAmount);
    await waitForTx(addTx, '流动性添加成功！');
    
    console.log(`Explorer: https://sepolia.arbiscan.io/tx/${addTx.hash}`);

  } catch (error: any) {
    printError(`添加流动性失败: ${error.message}`);
    if (error.reason) console.error(`  Reason: ${error.reason}`);
    throw error;
  }
}

async function withdrawLiquidity(amount: string) {
  printHeader('提取流动性 (Withdraw Liquidity)');

  const config = loadConfig();
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const wallet = new ethers.Wallet(config.adminPrivateKey, provider);
  const bridge = new ethers.Contract(config.contractAddress, BRIDGE_ABI, wallet);

  console.log('配置信息:');
  console.log(`  Admin: ${wallet.address}`);
  console.log(`  Amount: ${amount}`);
  console.log('');

  try {
    console.log('执行提取流动性...');
    const tx = await bridge.withdrawLiquidity(amount);
    await waitForTx(tx, '流动性提取成功！');
    
    console.log(`Explorer: https://sepolia.arbiscan.io/tx/${tx.hash}`);

  } catch (error: any) {
    printError(`提取流动性失败: ${error.message}`);
    if (error.reason) console.error(`  Reason: ${error.reason}`);
    throw error;
  }
}

// ============ 查询操作 ============

async function queryState() {
  printHeader('查询合约状态');

  const config = loadConfig();
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const bridge = new ethers.Contract(config.contractAddress, BRIDGE_ABI, provider);

  try {
    console.log('Sender State:');
    const senderState = await bridge.senderState();
    console.log(`  Vault: ${senderState[0]}`);
    console.log(`  Admin: ${senderState[1]}`);
    console.log(`  USDC Contract: ${senderState[2]}`);
    console.log(`  Nonce: ${senderState[3].toString()}`);
    console.log(`  Target Contract: ${senderState[4]}`);
    console.log(`  Source Chain ID: ${senderState[5].toString()}`);
    console.log(`  Target Chain ID: ${senderState[6].toString()}`);
    console.log('');

    console.log('Receiver State:');
    const receiverState = await bridge.receiverState();
    console.log(`  Vault: ${receiverState[0]}`);
    console.log(`  Admin: ${receiverState[1]}`);
    console.log(`  USDC Contract: ${receiverState[2]}`);
    console.log(`  Relayer Count: ${receiverState[3].toString()}`);
    console.log(`  Source Contract: ${receiverState[4]}`);
    console.log(`  Source Chain ID: ${receiverState[5].toString()}`);
    console.log(`  Target Chain ID: ${receiverState[6].toString()}`);
    console.log(`  Last Nonce: ${receiverState[7].toString()}`);
    console.log('');

    console.log('Relayers:');
    const relayers = await bridge.getRelayers();
    relayers.forEach((addr: string, idx: number) => {
      console.log(`  ${idx + 1}. ${addr}`);
    });

  } catch (error: any) {
    printError(`查询失败: ${error.message}`);
  }
}

// ============ 主程序 ============

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    console.log('Usage: ts-node evm-admin.ts <command> [options]');
    console.log('');
    console.log('Commands:');
    console.log('  initialize                  - 初始化合约');
    console.log('  configure_usdc              - 配置 USDC 地址');
    console.log('  configure_peer              - 配置对端合约');
    console.log('  add_relayer [address]       - 添加 Relayer');
    console.log('  remove_relayer <address>    - 移除 Relayer');
    console.log('  add_liquidity [amount]      - 增加流动性');
    console.log('  withdraw_liquidity <amount> - 提取流动性');
    console.log('  query_state                 - 查询合约状态');
    console.log('');
    console.log('Examples:');
    console.log('  ts-node evm-admin.ts initialize');
    console.log('  ts-node evm-admin.ts add_relayer');
    console.log('  ts-node evm-admin.ts add_relayer 0x1234...5678');
    console.log('  ts-node evm-admin.ts query_state');
    return;
  }

  try {
    switch (command) {
      case 'initialize':
        await initialize();
        break;

      case 'configure_usdc':
        await configureUsdc();
        break;

      case 'configure_peer':
        await configurePeer();
        break;

      case 'add_relayer':
        await addRelayer(args[1]);
        break;

      case 'remove_relayer':
        if (!args[1]) {
          printError('Relayer address required');
          process.exit(1);
        }
        await removeRelayer(args[1]);
        break;

      case 'add_liquidity':
        await addLiquidity(args[1]);
        break;

      case 'withdraw_liquidity':
        if (!args[1]) {
          printError('Amount required');
          process.exit(1);
        }
        await withdrawLiquidity(args[1]);
        break;

      case 'query_state':
        await queryState();
        break;

      default:
        printError(`Unknown command: ${command}`);
        process.exit(1);
    }

    printSuccess('操作完成！');
  } catch (error) {
    printError(`操作失败`);
    process.exit(1);
  }
}

// 运行主程序
if (require.main === module) {
  main();
}

export {
  initialize,
  configureUsdc,
  configurePeer,
  addRelayer,
  removeRelayer,
  addLiquidity,
  withdrawLiquidity,
  queryState,
};






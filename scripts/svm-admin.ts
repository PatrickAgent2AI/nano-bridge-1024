#!/usr/bin/env ts-node

/**
 * SVM Admin Operations Script
 * 
 * 管理员可用功能：
 * 1. initialize - 初始化合约
 * 2. configure_usdc - 配置 USDC 地址
 * 3. configure_peer - 配置对端合约
 * 4. add_relayer - 添加 Relayer
 * 5. remove_relayer - 移除 Relayer
 * 6. add_liquidity - 增加流动性
 * 7. withdraw_liquidity - 提取流动性
 */

import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet, BN } from '@coral-xyz/anchor';
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import * as dotenv from 'dotenv';
import * as path from 'path';

// 加载环境变量
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// ============ 配置 ============

interface Config {
  rpcUrl: string;
  programId: PublicKey;
  adminPrivateKey: number[];
  usdcMint: PublicKey;
  peerContract: string;
  sourceChainId: number;
  targetChainId: number;
  relayerAddresses: string[];
  liquidityAmount: number;
}

function loadConfig(): Config {
  const privateKeyStr = process.env.ADMIN_SVM_PRIVATE_KEY;
  if (!privateKeyStr) {
    throw new Error('ADMIN_SVM_PRIVATE_KEY not found in .env');
  }

  let privateKey: number[];
  try {
    privateKey = JSON.parse(privateKeyStr);
  } catch (e) {
    throw new Error('Invalid ADMIN_SVM_PRIVATE_KEY format. Expected JSON array.');
  }

  const relayersStr = process.env.RELAYER_ADDRESSES_SVM || '';
  const relayers = relayersStr.split(',').filter(r => r.trim());

  return {
    rpcUrl: process.env.SVM_RPC_URL || 'https://api.devnet.solana.com',
    programId: new PublicKey(process.env.SVM_PROGRAM_ID || ''),
    adminPrivateKey: privateKey,
    usdcMint: new PublicKey(process.env.USDC_SVM_MINT || ''),
    peerContract: process.env.PEER_CONTRACT_ADDRESS_FOR_SVM || '',
    sourceChainId: parseInt(process.env.SVM_CHAIN_ID || '91024'),
    targetChainId: parseInt(process.env.EVM_CHAIN_ID || '421614'),
    relayerAddresses: relayers,
    liquidityAmount: parseInt(process.env.INITIAL_LIQUIDITY_AMOUNT || '100000000'),
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

// ============ 管理员操作 ============

async function initialize() {
  printHeader('初始化合约 (Initialize)');

  const config = loadConfig();
  const connection = new Connection(config.rpcUrl, 'confirmed');
  const adminKeypair = Keypair.fromSecretKey(new Uint8Array(config.adminPrivateKey));

  console.log('配置信息:');
  console.log(`  RPC: ${config.rpcUrl}`);
  console.log(`  Program ID: ${config.programId.toBase58()}`);
  console.log(`  Admin: ${adminKeypair.publicKey.toBase58()}`);
  console.log('');

  try {
    const wallet = new Wallet(adminKeypair);
    const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });

    // 推导 PDA 地址
    const [vault] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault')],
      config.programId
    );

    const [senderState] = PublicKey.findProgramAddressSync(
      [Buffer.from('sender_state')],
      config.programId
    );

    const [receiverState] = PublicKey.findProgramAddressSync(
      [Buffer.from('receiver_state')],
      config.programId
    );

    console.log('PDA 地址:');
    console.log(`  Vault: ${vault.toBase58()}`);
    console.log(`  Sender State: ${senderState.toBase58()}`);
    console.log(`  Receiver State: ${receiverState.toBase58()}`);
    console.log('');

    console.log('⚠️  需要 IDL 文件才能执行实际交易');
    console.log('');
    console.log('示例调用代码:');
    console.log(`
const tx = await program.methods
  .initialize()
  .accounts({
    admin: adminKeypair.publicKey,
    vault: vault,
    senderState: senderState,
    receiverState: receiverState,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
    `);

  } catch (error) {
    printError(`初始化失败: ${error}`);
    throw error;
  }
}

async function configureUsdc() {
  printHeader('配置 USDC (Configure USDC)');

  const config = loadConfig();
  const connection = new Connection(config.rpcUrl, 'confirmed');
  const adminKeypair = Keypair.fromSecretKey(new Uint8Array(config.adminPrivateKey));

  console.log('配置信息:');
  console.log(`  Admin: ${adminKeypair.publicKey.toBase58()}`);
  console.log(`  USDC Mint: ${config.usdcMint.toBase58()}`);
  console.log('');

  try {
    const [senderState] = PublicKey.findProgramAddressSync(
      [Buffer.from('sender_state')],
      config.programId
    );

    const [receiverState] = PublicKey.findProgramAddressSync(
      [Buffer.from('receiver_state')],
      config.programId
    );

    console.log('⚠️  需要 IDL 文件才能执行实际交易');
    console.log('');
    console.log('示例调用代码:');
    console.log(`
const tx = await program.methods
  .configureUsdc(new PublicKey("${config.usdcMint.toBase58()}"))
  .accounts({
    admin: adminKeypair.publicKey,
    senderState: senderState,
    receiverState: receiverState,
  })
  .rpc();
    `);

  } catch (error) {
    printError(`配置 USDC 失败: ${error}`);
    throw error;
  }
}

async function configurePeer() {
  printHeader('配置对端合约 (Configure Peer)');

  const config = loadConfig();
  const adminKeypair = Keypair.fromSecretKey(new Uint8Array(config.adminPrivateKey));

  console.log('配置信息:');
  console.log(`  Admin: ${adminKeypair.publicKey.toBase58()}`);
  console.log(`  Peer Contract: ${config.peerContract}`);
  console.log(`  Source Chain ID: ${config.sourceChainId}`);
  console.log(`  Target Chain ID: ${config.targetChainId}`);
  console.log('');

  try {
    const [senderState] = PublicKey.findProgramAddressSync(
      [Buffer.from('sender_state')],
      config.programId
    );

    const [receiverState] = PublicKey.findProgramAddressSync(
      [Buffer.from('receiver_state')],
      config.programId
    );

    console.log('⚠️  需要 IDL 文件才能执行实际交易');
    console.log('');
    console.log('示例调用代码:');
    console.log(`
// 注意: peerContract 需要转换为 Pubkey 格式
const peerPubkey = new PublicKey("${config.peerContract}");

const tx = await program.methods
  .configurePeer(
    peerPubkey,
    new BN(${config.sourceChainId}),
    new BN(${config.targetChainId})
  )
  .accounts({
    admin: adminKeypair.publicKey,
    senderState: senderState,
    receiverState: receiverState,
  })
  .rpc();
    `);

  } catch (error) {
    printError(`配置对端失败: ${error}`);
    throw error;
  }
}

async function addRelayer(relayerAddress?: string) {
  printHeader('添加 Relayer (Add Relayer)');

  const config = loadConfig();
  const adminKeypair = Keypair.fromSecretKey(new Uint8Array(config.adminPrivateKey));

  const relayers = relayerAddress ? [relayerAddress] : config.relayerAddresses;

  if (relayers.length === 0) {
    throw new Error('No relayer addresses provided');
  }

  console.log('配置信息:');
  console.log(`  Admin: ${adminKeypair.publicKey.toBase58()}`);
  console.log(`  Relayers to add: ${relayers.length}`);
  console.log('');

  try {
    const [receiverState] = PublicKey.findProgramAddressSync(
      [Buffer.from('receiver_state')],
      config.programId
    );

    for (const relayer of relayers) {
      console.log(`Adding relayer: ${relayer}`);
      
      console.log('⚠️  需要 IDL 文件才能执行实际交易');
      console.log('');
      console.log('示例调用代码:');
      console.log(`
const tx = await program.methods
  .addRelayer(new PublicKey("${relayer}"))
  .accounts({
    admin: adminKeypair.publicKey,
    receiverState: receiverState,
  })
  .rpc();
      `);
      console.log('');
    }

  } catch (error) {
    printError(`添加 Relayer 失败: ${error}`);
    throw error;
  }
}

async function removeRelayer(relayerAddress: string) {
  printHeader('移除 Relayer (Remove Relayer)');

  const config = loadConfig();
  const adminKeypair = Keypair.fromSecretKey(new Uint8Array(config.adminPrivateKey));

  console.log('配置信息:');
  console.log(`  Admin: ${adminKeypair.publicKey.toBase58()}`);
  console.log(`  Relayer to remove: ${relayerAddress}`);
  console.log('');

  try {
    const [receiverState] = PublicKey.findProgramAddressSync(
      [Buffer.from('receiver_state')],
      config.programId
    );

    console.log('⚠️  需要 IDL 文件才能执行实际交易');
    console.log('');
    console.log('示例调用代码:');
    console.log(`
const tx = await program.methods
  .removeRelayer(new PublicKey("${relayerAddress}"))
  .accounts({
    admin: adminKeypair.publicKey,
    receiverState: receiverState,
  })
  .rpc();
    `);

  } catch (error) {
    printError(`移除 Relayer 失败: ${error}`);
    throw error;
  }
}

async function addLiquidity(amount?: number) {
  printHeader('增加流动性 (Add Liquidity)');

  const config = loadConfig();
  const liquidityAmount = amount || config.liquidityAmount;
  const adminKeypair = Keypair.fromSecretKey(new Uint8Array(config.adminPrivateKey));

  console.log('配置信息:');
  console.log(`  Admin: ${adminKeypair.publicKey.toBase58()}`);
  console.log(`  Amount: ${liquidityAmount}`);
  console.log('');

  try {
    const [vault] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault')],
      config.programId
    );

    const [receiverState] = PublicKey.findProgramAddressSync(
      [Buffer.from('receiver_state')],
      config.programId
    );

    const adminTokenAccount = await getAssociatedTokenAddress(
      config.usdcMint,
      adminKeypair.publicKey
    );

    const vaultTokenAccount = await getAssociatedTokenAddress(
      config.usdcMint,
      vault,
      true
    );

    console.log('账户地址:');
    console.log(`  Admin Token Account: ${adminTokenAccount.toBase58()}`);
    console.log(`  Vault Token Account: ${vaultTokenAccount.toBase58()}`);
    console.log('');

    console.log('⚠️  需要 IDL 文件才能执行实际交易');
    console.log('');
    console.log('示例调用代码:');
    console.log(`
const tx = await program.methods
  .addLiquidity(new BN(${liquidityAmount}))
  .accounts({
    admin: adminKeypair.publicKey,
    receiverState: receiverState,
    adminTokenAccount: adminTokenAccount,
    vaultTokenAccount: vaultTokenAccount,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .rpc();
    `);

  } catch (error) {
    printError(`增加流动性失败: ${error}`);
    throw error;
  }
}

async function withdrawLiquidity(amount: number) {
  printHeader('提取流动性 (Withdraw Liquidity)');

  const config = loadConfig();
  const adminKeypair = Keypair.fromSecretKey(new Uint8Array(config.adminPrivateKey));

  console.log('配置信息:');
  console.log(`  Admin: ${adminKeypair.publicKey.toBase58()}`);
  console.log(`  Amount: ${amount}`);
  console.log('');

  try {
    const [vault] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault')],
      config.programId
    );

    const [receiverState] = PublicKey.findProgramAddressSync(
      [Buffer.from('receiver_state')],
      config.programId
    );

    const adminTokenAccount = await getAssociatedTokenAddress(
      config.usdcMint,
      adminKeypair.publicKey
    );

    const vaultTokenAccount = await getAssociatedTokenAddress(
      config.usdcMint,
      vault,
      true
    );

    console.log('⚠️  需要 IDL 文件才能执行实际交易');
    console.log('');
    console.log('示例调用代码:');
    console.log(`
const tx = await program.methods
  .withdrawLiquidity(new BN(${amount}))
  .accounts({
    admin: adminKeypair.publicKey,
    receiverState: receiverState,
    vault: vault,
    adminTokenAccount: adminTokenAccount,
    vaultTokenAccount: vaultTokenAccount,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .rpc();
    `);

  } catch (error) {
    printError(`提取流动性失败: ${error}`);
    throw error;
  }
}

// ============ 主程序 ============

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    console.log('Usage: ts-node svm-admin.ts <command> [options]');
    console.log('');
    console.log('Commands:');
    console.log('  initialize                  - 初始化合约');
    console.log('  configure_usdc              - 配置 USDC 地址');
    console.log('  configure_peer              - 配置对端合约');
    console.log('  add_relayer [address]       - 添加 Relayer');
    console.log('  remove_relayer <address>    - 移除 Relayer');
    console.log('  add_liquidity [amount]      - 增加流动性');
    console.log('  withdraw_liquidity <amount> - 提取流动性');
    console.log('');
    console.log('Examples:');
    console.log('  ts-node svm-admin.ts initialize');
    console.log('  ts-node svm-admin.ts add_relayer');
    console.log('  ts-node svm-admin.ts add_relayer <pubkey>');
    console.log('  ts-node svm-admin.ts remove_relayer <pubkey>');
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
        const addAmount = args[1] ? parseInt(args[1]) : undefined;
        await addLiquidity(addAmount);
        break;

      case 'withdraw_liquidity':
        if (!args[1]) {
          printError('Amount required');
          process.exit(1);
        }
        await withdrawLiquidity(parseInt(args[1]));
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
};


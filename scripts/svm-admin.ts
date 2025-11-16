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
import * as fs from 'fs';

// 加载 IDL
const IDL_PATH = path.resolve(__dirname, '../svm/bridge1024/target/idl/bridge1024.json');
let IDL: any = null;
try {
  if (fs.existsSync(IDL_PATH)) {
    IDL = JSON.parse(fs.readFileSync(IDL_PATH, 'utf-8'));
  }
} catch (e) {
  console.warn('Warning: Could not load IDL file');
}

// 加载环境变量
dotenv.config({ path: path.resolve(__dirname, '../.env.invoke') });

// ============ 配置 ============

interface Config {
  rpcUrl: string;
  programId: PublicKey;
  adminKeypair: Keypair;
  usdcMint: PublicKey;
  peerContract: string;
  sourceChainId: number;
  targetChainId: number;
  relayerAddresses: string[];
  liquidityAmount: number;
}

function loadConfig(): Config {
  const keypairPath = process.env.ADMIN_SVM_KEYPAIR_PATH;
  if (!keypairPath) {
    throw new Error('ADMIN_SVM_KEYPAIR_PATH not found in .env.invoke');
  }

  // 读取 keypair 文件
  let keypair: Keypair;
  try {
    const keypairFile = fs.readFileSync(keypairPath, 'utf-8');
    const keypairData = JSON.parse(keypairFile);
    keypair = Keypair.fromSecretKey(new Uint8Array(keypairData));
  } catch (e: any) {
    throw new Error(`Failed to load keypair from ${keypairPath}: ${e.message}`);
  }

  const relayersStr = process.env.RELAYER_ADDRESSES_SVM || '';
  const relayers = relayersStr.split(',').filter(r => r.trim());

  return {
    rpcUrl: process.env.SVM_RPC_URL || 'https://api.devnet.solana.com',
    programId: new PublicKey(process.env.SVM_PROGRAM_ID || ''),
    adminKeypair: keypair,
    usdcMint: new PublicKey(process.env.USDC_SVM_MINT || ''),
    peerContract: process.env.PEER_CONTRACT_ADDRESS_FOR_SVM || '',
    sourceChainId: parseInt(process.env.SVM_CHAIN_ID || '91024'),
    targetChainId: parseInt(process.env.EVM_CHAIN_ID || '421614'),
    relayerAddresses: relayers,
    liquidityAmount: parseInt(process.env.INITIAL_LIQUIDITY_AMOUNT || '100000000'),
  };
}

// ============ 辅助函数 ============

/**
 * 创建 Solana Connection，禁用 WebSocket 以避免 405 错误
 */
function createConnection(rpcUrl: string): Connection {
  return new Connection(rpcUrl, {
    commitment: 'confirmed',
    wsEndpoint: undefined, // 禁用 WebSocket，避免 ws error: 405
    confirmTransactionInitialTimeout: 120000,
  });
}

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
  const connection = createConnection(config.rpcUrl);
  const adminKeypair = config.adminKeypair;

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

    if (!IDL) {
      throw new Error('IDL file not found. Please build SVM contract first');
    }

    const program = new Program(IDL, provider);

    // 构建交易
    const transaction = await program.methods
      .initialize()
      .accounts({
        admin: adminKeypair.publicKey,
        vault: vault,
        senderState: senderState,
        receiverState: receiverState,
        systemProgram: SystemProgram.programId,
      })
      .transaction();

    // 获取最新的 blockhash
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = adminKeypair.publicKey;

    // 签名交易
    transaction.sign(adminKeypair);

    // 发送交易（立即返回交易签名，不等待确认）
    const txSignature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    console.log(`📤 交易已发送: ${txSignature}`);
    console.log(`   查看交易: https://explorer.solana.com/tx/${txSignature}?cluster=custom&customUrl=${encodeURIComponent(config.rpcUrl)}`);
    console.log('⏳ 等待交易确认...');

    // 等待交易确认
    const confirmation = await connection.confirmTransaction({
      signature: txSignature,
      blockhash,
      lastValidBlockHeight,
    }, 'confirmed');

    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }

    printSuccess('合约初始化成功！');
    console.log(`  Transaction: ${txSignature}`);

  } catch (error: any) {
    printError(`初始化失败: ${error.message || error}`);
    throw error;
  }
}

async function configureUsdc() {
  printHeader('配置 USDC (Configure USDC)');

  const config = loadConfig();
  const connection = createConnection(config.rpcUrl);
  const adminKeypair = config.adminKeypair;

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

    if (!IDL) {
      throw new Error('IDL file not found. Please build SVM contract first');
    }

    const wallet = new Wallet(adminKeypair);
    const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
    const program = new Program(IDL, provider);

    // 构建交易
    const transaction = await program.methods
      .configureUsdc(config.usdcMint)
      .accounts({
        admin: adminKeypair.publicKey,
        senderState: senderState,
        receiverState: receiverState,
        systemProgram: SystemProgram.programId,
      })
      .transaction();

    // 获取最新的 blockhash
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = adminKeypair.publicKey;

    // 签名交易
    transaction.sign(adminKeypair);

    // 发送交易（立即返回交易签名，不等待确认）
    const txSignature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    console.log(`📤 交易已发送: ${txSignature}`);
    console.log(`   查看交易: https://explorer.solana.com/tx/${txSignature}?cluster=custom&customUrl=${encodeURIComponent(config.rpcUrl)}`);
    console.log('⏳ 等待交易确认...');

    // 等待交易确认
    const confirmation = await connection.confirmTransaction({
      signature: txSignature,
      blockhash,
      lastValidBlockHeight,
    }, 'confirmed');

    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }

    printSuccess('USDC 配置成功！');
    console.log(`  Transaction: ${txSignature}`);

  } catch (error: any) {
    printError(`配置 USDC 失败: ${error.message || error}`);
    throw error;
  }
}

async function configurePeer() {
  printHeader('配置对端合约 (Configure Peer)');

  const config = loadConfig();
  const adminKeypair = config.adminKeypair;

  // Convert EVM address to 32-byte hex format (matching how events are emitted)
  // If it's an EVM address (starts with 0x), left-pad it to 32 bytes
  let peerContractFormatted = config.peerContract;
  if (config.peerContract.startsWith('0x')) {
    // Remove 0x prefix, convert to lowercase, and left-pad to 64 chars (32 bytes)
    const addressWithoutPrefix = config.peerContract.slice(2).toLowerCase();
    peerContractFormatted = addressWithoutPrefix.padStart(64, '0');
  }

  console.log('配置信息:');
  console.log(`  Admin: ${adminKeypair.publicKey.toBase58()}`);
  console.log(`  Peer Contract (original): ${config.peerContract}`);
  console.log(`  Peer Contract (formatted): ${peerContractFormatted}`);
  console.log(`  Source Chain ID: ${config.sourceChainId}`);
  console.log(`  Target Chain ID: ${config.targetChainId}`);
  console.log('');

  if (!IDL) {
    throw new Error('IDL file not found. Please build SVM contract first');
  }

  try {
    const connection = createConnection(config.rpcUrl);
    const wallet = new Wallet(adminKeypair);
    const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
    const program = new Program(IDL, provider);

    const [senderState] = PublicKey.findProgramAddressSync(
      [Buffer.from('sender_state')],
      config.programId
    );

    const [receiverState] = PublicKey.findProgramAddressSync(
      [Buffer.from('receiver_state')],
      config.programId
    );

    // 构建交易（peer_contract 现在是 String 类型）
    const transaction = await program.methods
      .configurePeer(
        peerContractFormatted,  // Use formatted address (32-byte hex, lowercase)
        new BN(config.sourceChainId),
        new BN(config.targetChainId)
      )
      .accounts({
        admin: adminKeypair.publicKey,
        senderState: senderState,
        receiverState: receiverState,
      })
      .transaction();

    // 获取最新的 blockhash
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = adminKeypair.publicKey;

    // 签名交易
    transaction.sign(adminKeypair);

    // 发送交易 - Try with skipPreflight to bypass simulation error
    console.log('⚠️  尝试跳过模拟检查...');
    const txSignature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: true,  // Skip preflight to bypass simulation error
      maxRetries: 3,
    });

    console.log(`📤 交易已发送: ${txSignature}`);
    console.log(`   查看交易: https://explorer.solana.com/tx/${txSignature}?cluster=custom&customUrl=${encodeURIComponent(config.rpcUrl)}`);
    console.log('⏳ 等待交易确认...');

    // 等待交易确认
    const confirmation = await connection.confirmTransaction({
      signature: txSignature,
      blockhash,
      lastValidBlockHeight,
    }, 'confirmed');

    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }

    printSuccess('对端合约配置成功！');
    console.log(`  Transaction: ${txSignature}`);

  } catch (error: any) {
    printError(`配置对端失败: ${error.message || error}`);
    throw error;
  }
}

async function addRelayer(relayerAddress?: string) {
  printHeader('添加 Relayer (Add Relayer)');

  const config = loadConfig();
  const adminKeypair = config.adminKeypair;

  const relayers = relayerAddress ? [relayerAddress] : config.relayerAddresses;

  if (relayers.length === 0) {
    throw new Error('No relayer addresses provided');
  }

  console.log('配置信息:');
  console.log(`  Admin: ${adminKeypair.publicKey.toBase58()}`);
  console.log(`  Relayers to add: ${relayers.length}`);
  console.log('');

  if (!IDL) {
    throw new Error('IDL file not found. Please build SVM contract first: cd svm/bridge1024 && anchor build');
  }

  // 创建连接
  const connection = createConnection(config.rpcUrl);
  const wallet = new Wallet(adminKeypair);
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  const program = new Program(IDL, provider);

  try {
    const [receiverState] = PublicKey.findProgramAddressSync(
      [Buffer.from('receiver_state')],
      config.programId
    );

    for (const relayer of relayers) {
      console.log(`Adding relayer: ${relayer}`);
      const relayerPubkey = new PublicKey(relayer);
      
      // 构建交易
      const transaction = await program.methods
        .addRelayer(relayerPubkey)
        .accounts({
          admin: adminKeypair.publicKey,
          receiverState: receiverState,
          systemProgram: SystemProgram.programId,
        })
        .transaction();

      // 获取最新的 blockhash
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = adminKeypair.publicKey;

      // 签名交易
      transaction.sign(adminKeypair);

      // 发送交易（立即返回交易签名，不等待确认）
      const txSignature = await connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });

      console.log(`📤 交易已发送: ${txSignature}`);
      console.log(`   查看交易: https://explorer.solana.com/tx/${txSignature}?cluster=custom&customUrl=${encodeURIComponent(config.rpcUrl)}`);
      console.log('⏳ 等待交易确认...');

      // 等待交易确认
      const confirmation = await connection.confirmTransaction({
        signature: txSignature,
        blockhash,
        lastValidBlockHeight,
      }, 'confirmed');

      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }

      printSuccess(`Relayer ${relayer} 添加成功！`);
      console.log(`  Transaction: ${txSignature}`);
      console.log('');
    }

  } catch (error: any) {
    printError(`添加 Relayer 失败: ${error.message || error}`);
    throw error;
  }
}

async function removeRelayer(relayerAddress: string) {
  printHeader('移除 Relayer (Remove Relayer)');

  const config = loadConfig();
  const adminKeypair = config.adminKeypair;

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
  const adminKeypair = config.adminKeypair;

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

    if (!IDL) {
      throw new Error('IDL file not found. Please build SVM contract first');
    }

    // 创建连接
    const connection = createConnection(config.rpcUrl);
    const wallet = new Wallet(adminKeypair);
    const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
    const program = new Program(IDL, provider);

    // 构建交易
    const transaction = await program.methods
      .addLiquidity(new BN(liquidityAmount))
      .accounts({
        admin: adminKeypair.publicKey,
        receiverState: receiverState,
        vault: vault,
        usdcMint: config.usdcMint,
        adminTokenAccount: adminTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .transaction();

    // 获取最新的 blockhash
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = adminKeypair.publicKey;

    // 签名交易
    transaction.sign(adminKeypair);

    // 发送交易（立即返回交易签名，不等待确认）
    const txSignature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    console.log(`📤 交易已发送: ${txSignature}`);
    console.log(`   查看交易: https://explorer.solana.com/tx/${txSignature}?cluster=custom&customUrl=${encodeURIComponent(config.rpcUrl)}`);
    console.log('⏳ 等待交易确认...');

    // 等待交易确认
    const confirmation = await connection.confirmTransaction({
      signature: txSignature,
      blockhash,
      lastValidBlockHeight,
    }, 'confirmed');

    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }

    printSuccess('流动性添加成功！');
    console.log(`  Transaction: ${txSignature}`);

  } catch (error: any) {
    printError(`增加流动性失败: ${error.message || error}`);
    throw error;
  }
}

async function withdrawLiquidity(amount: number) {
  printHeader('提取流动性 (Withdraw Liquidity)');

  const config = loadConfig();
  const adminKeypair = config.adminKeypair;

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

async function configureReceiverPeer() {
  printHeader('配置接收端对端合约 (Configure Receiver Peer)');

  const config = loadConfig();
  const adminKeypair = config.adminKeypair;

  // Convert EVM address to 32-byte hex format (matching how events are emitted)
  let peerContractFormatted = config.peerContract;
  if (config.peerContract.startsWith('0x')) {
    const addressWithoutPrefix = config.peerContract.slice(2).toLowerCase();
    peerContractFormatted = addressWithoutPrefix.padStart(64, '0');
  }

  console.log('配置信息:');
  console.log(`  Admin: ${adminKeypair.publicKey.toBase58()}`);
  console.log(`  Peer Contract (original): ${config.peerContract}`);
  console.log(`  Peer Contract (formatted): ${peerContractFormatted}`);
  console.log(`  Source Chain ID (EVM): ${config.targetChainId}`);
  console.log(`  Target Chain ID (SVM): ${config.sourceChainId}`);
  console.log('');

  if (!IDL) {
    throw new Error('IDL file not found. Please build SVM contract first');
  }

  try {
    const connection = createConnection(config.rpcUrl);
    const wallet = new Wallet(adminKeypair);
    const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
    const program = new Program(IDL, provider);

    const [receiverState] = PublicKey.findProgramAddressSync(
      [Buffer.from('receiver_state')],
      config.programId
    );

    // Build transaction - note: chain IDs are swapped for receiver
    const transaction = await program.methods
      .configureReceiverPeer(
        peerContractFormatted,  // EVM contract address
        new BN(config.targetChainId),  // Source = EVM chain ID (421614)
        new BN(config.sourceChainId)   // Target = SVM chain ID (91024)
      )
      .accounts({
        admin: adminKeypair.publicKey,
        receiverState: receiverState,
      })
      .transaction();

    // Get latest blockhash
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = adminKeypair.publicKey;

    // Sign transaction
    transaction.sign(adminKeypair);

    // Send transaction
    const txSignature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    console.log(`📤 交易已发送: ${txSignature}`);
    console.log(`   查看交易: https://explorer.solana.com/tx/${txSignature}?cluster=custom&customUrl=${encodeURIComponent(config.rpcUrl)}`);
    console.log('⏳ 等待交易确认...');

    // Wait for confirmation
    const confirmation = await connection.confirmTransaction({
      signature: txSignature,
      blockhash,
      lastValidBlockHeight,
    }, 'confirmed');

    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }

    console.log('✅ 交易已确认！');
    printSuccess('接收端对端配置完成！');
  } catch (error: any) {
    printError(`配置接收端对端失败: ${error.message || error}`);
    throw error;
  }
}

async function queryState() {
  printHeader('查询合约状态 (Query State)');

  const config = loadConfig();
  
  try {
    const connection = createConnection(config.rpcUrl);
    const provider = new AnchorProvider(connection, new Wallet(config.adminKeypair), {
      commitment: 'confirmed',
    });

    const program = new Program(IDL, provider);

    const [senderState] = PublicKey.findProgramAddressSync(
      [Buffer.from('sender_state')],
      config.programId
    );

    const [receiverState] = PublicKey.findProgramAddressSync(
      [Buffer.from('receiver_state')],
      config.programId
    );

    // Try to fetch sender state
    try {
      const senderStateData: any = await (program.account as any).senderState.fetch(senderState);
      console.log('Sender State:');
      console.log(`  Address: ${senderState.toBase58()}`);
      console.log(`  Admin: ${senderStateData.admin.toBase58()}`);
      console.log(`  Vault: ${senderStateData.vault.toBase58()}`);
      console.log(`  USDC Mint: ${senderStateData.usdcMint.toBase58()}`);
      console.log(`  Target Contract: ${senderStateData.targetContract}`);
      console.log(`  Source Chain ID: ${senderStateData.sourceChainId.toString()}`);
      console.log(`  Target Chain ID: ${senderStateData.targetChainId.toString()}`);
      console.log(`  Nonce: ${senderStateData.nonce.toString()}`);
      console.log('');
    } catch (e: any) {
      console.log('Sender State:');
      console.log(`  Address: ${senderState.toBase58()}`);
      console.log(`  ✗ Not initialized: ${e.message}`);
      console.log('');
    }

    const receiverStateData: any = await (program.account as any).receiverState.fetch(receiverState);

    console.log('Receiver State:');
    console.log(`  Address: ${receiverState.toBase58()}`);
    console.log(`  Admin: ${receiverStateData.admin.toBase58()}`);
    console.log(`  Vault: ${receiverStateData.vault.toBase58()}`);
    console.log(`  USDC Mint: ${receiverStateData.usdcMint.toBase58()}`);
    console.log(`  Source Contract: ${receiverStateData.sourceContract}`);
    console.log(`  Source Chain ID: ${receiverStateData.sourceChainId.toString()}`);
    console.log(`  Target Chain ID: ${receiverStateData.targetChainId.toString()}`);
    console.log(`  Last Nonce: ${receiverStateData.lastNonce.toString()}`);
    console.log(`  Relayer Count: ${receiverStateData.relayerCount.toString()}`);
    console.log(`  Relayers:`);
    receiverStateData.relayers.forEach((relayer: any, index: number) => {
      console.log(`    [${index}] ${relayer.toBase58()}`);
    });

    printSuccess('查询完成！');
  } catch (error: any) {
    printError(`查询失败: ${error.message || error}`);
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
    console.log('  configure_receiver_peer     - 配置接收端对端合约');
    console.log('  add_relayer [address]       - 添加 Relayer');
    console.log('  remove_relayer <address>    - 移除 Relayer');
    console.log('  add_liquidity [amount]      - 增加流动性');
    console.log('  withdraw_liquidity <amount> - 提取流动性');
    console.log('  query_state                 - 查询合约状态');
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

      case 'configure_receiver_peer':
        await configureReceiverPeer();
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

      case 'query_state':
        await queryState();
        break;

      default:
        printError(`Unknown command: ${command}`);
        process.exit(1);
    }

    printSuccess('操作完成！');
  } catch (error: any) {
    printError(`操作失败: ${error?.message || error}`);
    if (error?.stack) {
      console.error(error.stack);
    }
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
  configureReceiverPeer,
  addRelayer,
  removeRelayer,
  addLiquidity,
  withdrawLiquidity,
  queryState,
};






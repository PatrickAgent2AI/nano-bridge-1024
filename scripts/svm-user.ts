#!/usr/bin/env ts-node

/**
 * SVM User Operations Script
 * 
 * 用户可用功能：
 * 1. stake - 质押 USDC 到跨链桥
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet, BN } from '@coral-xyz/anchor';
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// 加载环境变量
dotenv.config({ path: path.resolve(__dirname, '../.env.invoke') });

// IDL 类型定义（需要从实际的 IDL 文件导入）
// import { Bridge1024 } from '../target/types/bridge1024';

// ============ 配置 ============

interface Config {
  rpcUrl: string;
  programId: PublicKey;
  userKeypair: Keypair;
  usdcMint: PublicKey;
  testAmount: number;
  testReceiver: string;
}

function loadConfig(): Config {
  const keypairPath = process.env.USER_SVM_KEYPAIR_PATH;
  if (!keypairPath) {
    throw new Error('USER_SVM_KEYPAIR_PATH not found in .env.invoke');
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

  return {
    rpcUrl: process.env.SVM_RPC_URL || 'https://api.devnet.solana.com',
    programId: new PublicKey(process.env.SVM_PROGRAM_ID || ''),
    userKeypair: keypair,
    usdcMint: new PublicKey(process.env.USDC_SVM_MINT || ''),
    testAmount: parseInt(process.env.TEST_STAKE_AMOUNT || '1000000'),
    testReceiver: process.env.TEST_RECEIVER_ADDRESS_EVM || '0x0000000000000000000000000000000000000000',
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

// ============ 用户操作：质押 ============

async function stake(amount?: number, receiver?: string) {
  printHeader('用户质押 (User Stake)');

  const config = loadConfig();
  const stakeAmount = amount || config.testAmount;
  const receiverAddress = receiver || config.testReceiver;

  // 创建连接
  const connection = createConnection(config.rpcUrl);
  
  // 获取用户 keypair
  const userKeypair = config.userKeypair;
  
  console.log('配置信息:');
  console.log(`  RPC: ${config.rpcUrl}`);
  console.log(`  Program ID: ${config.programId.toBase58()}`);
  console.log(`  User: ${userKeypair.publicKey.toBase58()}`);
  console.log(`  USDC Mint: ${config.usdcMint.toBase58()}`);
  console.log(`  Amount: ${stakeAmount}`);
  console.log(`  Receiver: ${receiverAddress}`);
  console.log('');

  try {
    // 创建 Provider
    const wallet = new Wallet(userKeypair);
    const provider = new AnchorProvider(connection, wallet, {
      commitment: 'confirmed',
    });

    // 加载程序（需要 IDL）
    // const program = new Program<Bridge1024>(IDL, config.programId, provider);

    // 推导 PDA 地址
    const [senderState] = PublicKey.findProgramAddressSync(
      [Buffer.from('sender_state')],
      config.programId
    );

    const [vault] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault')],
      config.programId
    );

    // 获取用户的 USDC token account
    const userTokenAccount = await getAssociatedTokenAddress(
      config.usdcMint,
      userKeypair.publicKey
    );

    // 获取 vault 的 USDC token account
    const vaultTokenAccount = await getAssociatedTokenAddress(
      config.usdcMint,
      vault,
      true // allowOwnerOffCurve
    );

    console.log('账户地址:');
    console.log(`  Sender State: ${senderState.toBase58()}`);
    console.log(`  Vault: ${vault.toBase58()}`);
    console.log(`  User Token Account: ${userTokenAccount.toBase58()}`);
    console.log(`  Vault Token Account: ${vaultTokenAccount.toBase58()}`);
    console.log('');

    // 执行 stake
    console.log('执行质押交易...');
    
    // 实际调用（需要加载 IDL）
    /*
    const tx = await program.methods
      .stake(new BN(stakeAmount), receiverAddress)
      .accounts({
        user: userKeypair.publicKey,
        senderState: senderState,
        userTokenAccount: userTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    printSuccess(`交易成功！`);
    console.log(`  Transaction: ${tx}`);
    console.log(`  Explorer: https://explorer.solana.com/tx/${tx}?cluster=custom&customUrl=${config.rpcUrl}`);
    */

    console.log('⚠️  需要 IDL 文件才能执行实际交易');
    console.log('');
    console.log('示例调用代码:');
    console.log(`
const tx = await program.methods
  .stake(new BN(${stakeAmount}), "${receiverAddress}")
  .accounts({
    user: userKeypair.publicKey,
    senderState: senderState,
    userTokenAccount: userTokenAccount,
    vaultTokenAccount: vaultTokenAccount,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .rpc();
    `);

  } catch (error) {
    printError(`质押失败: ${error}`);
    throw error;
  }
}

// ============ 查询操作 ============

async function queryBalance() {
  printHeader('查询用户余额');

  const config = loadConfig();
  const connection = new Connection(config.rpcUrl, 'confirmed');
  const userKeypair = config.userKeypair;

  try {
    // 查询 SOL 余额
    const solBalance = await connection.getBalance(userKeypair.publicKey);
    console.log(`SOL Balance: ${solBalance / 1e9} SOL`);

    // 查询 USDC 余额
    const userTokenAccount = await getAssociatedTokenAddress(
      config.usdcMint,
      userKeypair.publicKey
    );

    try {
      const tokenAccountInfo = await connection.getTokenAccountBalance(userTokenAccount);
      console.log(`USDC Balance: ${tokenAccountInfo.value.uiAmount} USDC`);
    } catch (e) {
      console.log('USDC Token Account not found');
    }

  } catch (error) {
    printError(`查询失败: ${error}`);
  }
}

// ============ 主程序 ============

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    console.log('Usage: ts-node svm-user.ts <command> [options]');
    console.log('');
    console.log('Commands:');
    console.log('  stake [amount] [receiver]  - 质押 USDC');
    console.log('  balance                    - 查询余额');
    console.log('');
    console.log('Examples:');
    console.log('  ts-node svm-user.ts stake');
    console.log('  ts-node svm-user.ts stake 1000000 0x1234...5678');
    console.log('  ts-node svm-user.ts balance');
    return;
  }

  try {
    switch (command) {
      case 'stake':
        const amount = args[1] ? parseInt(args[1]) : undefined;
        const receiver = args[2];
        await stake(amount, receiver);
        break;

      case 'balance':
        await queryBalance();
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

export { stake, queryBalance };






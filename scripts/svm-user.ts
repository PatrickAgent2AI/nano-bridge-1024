#!/usr/bin/env ts-node

/**
 * SVM User Operations Script
 * 
 * 用户可用功能：
 * 1. stake - 质押 USDC 到跨链桥
 */

import { 
  Connection, 
  Keypair, 
  PublicKey, 
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
  TransactionInstruction
} from '@solana/web3.js';
import { Program, AnchorProvider, Wallet, BN } from '@coral-xyz/anchor';
import { 
  getAssociatedTokenAddress, 
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAccount
} from '@solana/spl-token';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// 加载 IDL
const IDL_PATH = path.resolve(__dirname, '../svm/bridge1024/target/idl/bridge1024.json');
let IDL: any = null;
try {
  if (fs.existsSync(IDL_PATH)) {
    IDL = JSON.parse(fs.readFileSync(IDL_PATH, 'utf-8'));
    console.log(`✓ IDL 文件已加载: ${IDL_PATH}`);
  } else {
    console.warn(`⚠️  IDL 文件不存在: ${IDL_PATH}`);
    console.warn('   将使用手动构建指令的方式（需要确保 discriminator 正确）');
  }
} catch (e: any) {
  console.warn(`⚠️  无法加载 IDL 文件: ${e.message}`);
  console.warn('   将使用手动构建指令的方式（需要确保 discriminator 正确）');
}

// 加载环境变量
dotenv.config({ path: path.resolve(__dirname, '../.env.invoke') });

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
    confirmTransactionInitialTimeout: 5000, // 5秒超时
  });
}

/**
 * 使用 RPC 轮询交易状态（带超时）
 */
async function pollTransactionStatus(
  connection: Connection,
  signature: string,
  maxAttempts: number = 10,
  delayMs: number = 500
): Promise<'success' | 'failed' | 'timeout'> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const status = await connection.getSignatureStatus(signature);
      
      if (status?.value?.confirmationStatus === 'confirmed' || 
          status?.value?.confirmationStatus === 'finalized') {
        if (status.value.err) {
          return 'failed';
        }
        return 'success';
      }
    } catch (e) {
      // 忽略查询错误，继续轮询
    }
    
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  
  return 'timeout';
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

/**
 * 创建 Anchor stake 指令（不需要 IDL 文件）
 */
function createStakeInstruction(
  programId: PublicKey,
  senderState: PublicKey,
  user: PublicKey,
  vault: PublicKey,
  usdcMint: PublicKey,
  userTokenAccount: PublicKey,
  vaultTokenAccount: PublicKey,
  amount: bigint,
  receiverAddress: string
): TransactionInstruction {
  // Anchor 指令格式：8 字节 discriminator + 参数
  // stake discriminator: 从 IDL 获取
  const discriminator = Buffer.from([206, 176, 202, 18, 200, 209, 179, 108]);
  
  // 序列化参数：amount (u64) + receiverAddress (String)
  const amountBuf = Buffer.alloc(8);
  amountBuf.writeBigUInt64LE(amount);
  
  // Borsh String 格式：4字节长度 + 字符串内容
  const receiverAddressBytes = Buffer.from(receiverAddress, 'utf-8');
  const receiverAddressLenBuf = Buffer.alloc(4);
  receiverAddressLenBuf.writeUInt32LE(receiverAddressBytes.length);
  
  const instructionData = Buffer.concat([
    discriminator,
    amountBuf,
    receiverAddressLenBuf,
    receiverAddressBytes
  ]);

  // 构建账户列表（顺序必须与 Anchor 程序定义一致）
  const keys = [
    { pubkey: senderState, isSigner: false, isWritable: true },
    { pubkey: user, isSigner: true, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: false },
    { pubkey: usdcMint, isSigner: false, isWritable: false },
    { pubkey: userTokenAccount, isSigner: false, isWritable: true },
    { pubkey: vaultTokenAccount, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    keys,
    programId,
    data: instructionData,
  });
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

    // 检查用户 token account 是否存在
    let userTokenAccountExists = false;
    try {
      await getAccount(connection, userTokenAccount);
      userTokenAccountExists = true;
    } catch (e: any) {
      if (e.message && e.message.includes('could not find account')) {
        console.log('⚠️  用户 USDC token account 不存在，将在交易中创建');
      } else {
        throw e;
      }
    }

    // 检查 USDC 余额
    if (userTokenAccountExists) {
      try {
        const tokenAccountInfo = await getAccount(connection, userTokenAccount);
        const balance = tokenAccountInfo.amount;
        
        if (balance < BigInt(stakeAmount)) {
          throw new Error(`USDC 余额不足: ${balance} < ${stakeAmount}`);
        }
        
        console.log(`当前 USDC 余额: ${balance.toString()} (最小单位)`);
      } catch (error: any) {
        if (!error.message.includes('余额不足')) {
          throw error;
        }
      }
    }

    // 执行 stake
    console.log('执行质押交易...');
    
    let signature: string;
    let blockhash: string;
    let lastValidBlockHeight: number;

    if (IDL) {
      // 使用 IDL 和 Anchor Program（推荐方式）
      console.log('使用 IDL 文件执行交易...');
      const program = new Program(IDL, provider);

      // 如果用户 token account 不存在，先创建它
      if (!userTokenAccountExists) {
        const createATAInstruction = createAssociatedTokenAccountInstruction(
          userKeypair.publicKey,
          userTokenAccount,
          userKeypair.publicKey,
          config.usdcMint
        );
        const createTx = new Transaction().add(createATAInstruction);
        await sendAndConfirmTransaction(connection, createTx, [userKeypair], { commitment: 'confirmed' });
        console.log('✓ 用户 USDC token account 已创建');
      }

      // 构建交易（不立即执行）
      const transaction = await program.methods
        .stake(new BN(stakeAmount), receiverAddress)
        .accounts({
          senderState: senderState,
          user: userKeypair.publicKey,
          vault: vault,
          usdcMint: config.usdcMint,
          userTokenAccount: userTokenAccount,
          vaultTokenAccount: vaultTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .transaction();

      // 获取最新的 blockhash
      const blockhashResult = await connection.getLatestBlockhash('confirmed');
      blockhash = blockhashResult.blockhash;
      lastValidBlockHeight = blockhashResult.lastValidBlockHeight;
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = userKeypair.publicKey;

      // 签名交易
      transaction.sign(userKeypair);

      // 发送交易（立即返回交易签名，不等待确认）
      signature = await connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });
    } else {
      // 使用手动构建指令（后备方案）
      console.log('使用手动构建指令执行交易...');
      
      // 构建交易
      const transaction = new Transaction();

      // 如果用户 token account 不存在，先创建它
      if (!userTokenAccountExists) {
        const createATAInstruction = createAssociatedTokenAccountInstruction(
          userKeypair.publicKey,
          userTokenAccount,
          userKeypair.publicKey,
          config.usdcMint
        );
        transaction.add(createATAInstruction);
      }

      // 创建 stake 指令
      const stakeInstruction = createStakeInstruction(
        config.programId,
        senderState,
        userKeypair.publicKey,
        vault,
        config.usdcMint,
        userTokenAccount,
        vaultTokenAccount,
        BigInt(stakeAmount),
        receiverAddress
      );
      transaction.add(stakeInstruction);

      // 获取最新的 blockhash
      const blockhashResult = await connection.getLatestBlockhash('confirmed');
      blockhash = blockhashResult.blockhash;
      lastValidBlockHeight = blockhashResult.lastValidBlockHeight;
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = userKeypair.publicKey;

      // 签名交易
      transaction.sign(userKeypair);

      // 发送交易（立即返回交易签名，不等待确认）
      signature = await connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });
    }

    // 立即输出交易ID（在确认之前）
    console.log('');
    printSuccess(`交易已发送！`);
    console.log(`  Transaction Signature: ${signature}`);
    console.log(`  Explorer: https://explorer.solana.com/tx/${signature}?cluster=custom&customUrl=${encodeURIComponent(config.rpcUrl)}`);
    console.log('⏳ 轮询交易状态 (超时: 5秒)...');

    // 使用轮询方式查询交易状态
    const status = await pollTransactionStatus(connection, signature, 10, 500);
    
    if (status === 'success') {
      console.log('✓ 交易已确认！');
    } else if (status === 'failed') {
      console.warn(`⚠️  交易失败`);
      console.warn(`   签名: ${signature}`);
    } else {
      console.warn(`⚠️  交易确认超时 (5秒)`);
      console.warn(`   交易已发送，签名: ${signature}`);
      console.warn(`   交易可能仍在处理中，请手动检查状态`);
    }

  } catch (error) {
    printError(`质押失败: ${error}`);
    throw error;
  }
}

// ============ 查询操作 ============

async function queryBalance() {
  printHeader('查询用户余额');

  const config = loadConfig();
  const connection = createConnection(config.rpcUrl);
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

    console.log(`  USDC Mint: ${config.usdcMint.toBase58()}`);
    console.log(`  User Token Account: ${userTokenAccount.toBase58()}`);
    console.log('');

    // 检查 token account 是否存在，如果不存在则尝试创建
    let tokenAccountExists = false;
    try {
      const accountInfo = await connection.getAccountInfo(userTokenAccount);
      if (accountInfo !== null) {
        tokenAccountExists = true;
      }
    } catch (e) {
      // Account doesn't exist
      tokenAccountExists = false;
    }

    // 如果账户不存在，尝试创建
    if (!tokenAccountExists) {
      console.log('⚠️  Token account 不存在，尝试创建...');
      try {
        const createATAInstruction = createAssociatedTokenAccountInstruction(
          userKeypair.publicKey,
          userTokenAccount,
          userKeypair.publicKey,
          config.usdcMint
        );
        const createTx = new Transaction().add(createATAInstruction);
        
        // 使用 sendAndConfirmTransaction
        const signature = await sendAndConfirmTransaction(
          connection,
          createTx,
          [userKeypair],
          { commitment: 'confirmed' }
        );
        
        console.log(`✓ Token account 创建成功: ${signature}`);
        tokenAccountExists = true;
      } catch (createError: any) {
        // 创建失败，但不中断查询，继续显示余额为0
        console.log(`⚠️  无法创建 token account: ${createError.message || createError}`);
        console.log(`   这可能是因为 USDC mint 地址无效或网络问题`);
      }
    }

    // 查询 USDC 余额
    try {
      if (tokenAccountExists) {
        const tokenAccountInfo = await connection.getTokenAccountBalance(userTokenAccount);
        const uiAmount = tokenAccountInfo.value.uiAmount;
        const amount = tokenAccountInfo.value.amount;
        
        if (uiAmount !== null && uiAmount > 0) {
          console.log(`USDC Balance: ${uiAmount} USDC`);
        } else {
          console.log(`USDC Balance: 0 USDC`);
        }
        console.log(`USDC Balance (最小单位): ${amount}`);
      } else {
        // 账户不存在，余额为 0
        console.log(`USDC Balance: 0 USDC`);
        console.log(`USDC Balance (最小单位): 0`);
        console.log(`  (Token account 不存在)`);
      }
    } catch (e: any) {
      console.log(`USDC Balance: 0 USDC`);
      console.log(`USDC Balance (最小单位): 0`);
      console.log(`  (查询余额时出错: ${e.message || e})`);
    }

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






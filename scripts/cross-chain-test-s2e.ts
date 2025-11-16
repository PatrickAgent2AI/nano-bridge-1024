#!/usr/bin/env ts-node

/**
 * Cross-Chain Bridge Test Script (SVM to EVM)
 * 
 * 测试流程：
 * 1. 在 SVM 链上质押 10 个最小单位的 USDC 并指定跨链到 EVM 地址
 * 2. 调用 relayer 查询状态，直到 ready（10秒超时）
 * 3. 查询 EVM 地址中是否增加了 10 个最小单位的 USDC
 * 
 * 注意：此脚本预期会执行失败，因为实际的跨链流程尚未完全实现
 */

import { ethers } from 'ethers';
import { 
  Connection, 
  PublicKey, 
  Transaction,
  SystemProgram,
  Keypair,
  sendAndConfirmTransaction,
  TransactionInstruction
} from '@solana/web3.js';
import { 
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  getAccount
} from '@solana/spl-token';
import * as dotenv from 'dotenv';
import * as path from 'path';
import axios from 'axios';
import bs58 from 'bs58';

// 加载环境变量
dotenv.config({ path: path.resolve(__dirname, '../.env.invoke') });

// ============ 类型定义 ============

interface RelayerStatus {
  service: string;
  listening: boolean;
  source_chain: {
    name: string;
    chain_id: number;
    rpc: string;
    connected: boolean;
    last_block?: number;
  };
  target_chain: {
    name: string;
    chain_id: number;
    rpc: string;
    connected: boolean;
    last_block?: number;
  };
  relayer: {
    address: string;
    whitelisted: boolean;
    balance_svm?: number;
    balance_evm?: number;
  };
}

// ============ ABI 定义 ============

const ERC20_ABI = [
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
];

// ============ 配置 ============

interface Config {
  svmRpcUrl: string;
  svmContractAddress: string;
  svmPrivateKey: string;
  svmUsdcMint: string;
  evmRpcUrl: string;
  evmUsdcContract: string;
  evmReceiverAddress: string;
  relayerApiUrl: string;
  testAmount: string; // 最小单位
}

function loadConfig(): Config {
  const missingVars: string[] = [];
  
  const checkEnv = (key: string, envVar: string | undefined): string => {
    if (!envVar) {
      missingVars.push(key);
      return '';
    }
    return envVar;
  };

  const config = {
    svmRpcUrl: checkEnv('SVM_RPC_URL', process.env.SVM_RPC_URL),
    svmContractAddress: checkEnv('SVM_CONTRACT_ADDRESS', process.env.SVM_CONTRACT_ADDRESS),
    svmPrivateKey: checkEnv('USER_SVM_PRIVATE_KEY', process.env.USER_SVM_PRIVATE_KEY),
    svmUsdcMint: checkEnv('USDC_SVM_MINT', process.env.USDC_SVM_MINT),
    evmRpcUrl: checkEnv('EVM_RPC_URL', process.env.EVM_RPC_URL),
    evmUsdcContract: checkEnv('USDC_EVM_CONTRACT', process.env.USDC_EVM_CONTRACT),
    evmReceiverAddress: checkEnv('TEST_RECEIVER_ADDRESS_EVM', process.env.TEST_RECEIVER_ADDRESS_EVM),
    relayerApiUrl: process.env.RELAYER_S2E_API_URL || 'http://localhost:8083',
    testAmount: '10', // 10 个最小单位
  };

  if (missingVars.length > 0) {
    throw new Error(`Missing environment variables: ${missingVars.join(', ')}`);
  }

  return config;
}

// ============ 辅助函数 ============

/**
 * 创建 Anchor stake 指令
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

function printStage(message: string) {
  console.log(`[${message}]`);
}

function printError(message: string) {
  console.error(`ERROR: ${message}`);
}

function printResult(message: string) {
  console.log(message);
}

// 等待函数
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============ Step 1: SVM 质押 ============

async function stakeOnSVM(config: Config): Promise<{ signature: string; nonce?: number }> {
  try {
    const connection = new Connection(config.svmRpcUrl, {
      commitment: 'confirmed',
      wsEndpoint: undefined, // 禁用 WebSocket，避免 ws error: 405
      confirmTransactionInitialTimeout: 120000,
    });
    
    // 1. 解析私钥
    let keypair: Keypair;
    try {
      const privateKeyBytes = bs58.decode(config.svmPrivateKey);
      keypair = Keypair.fromSecretKey(privateKeyBytes);
    } catch (e) {
      // 如果不是 base58，尝试解析为 JSON 数组
      const privateKeyArray = JSON.parse(config.svmPrivateKey);
      keypair = Keypair.fromSecretKey(new Uint8Array(privateKeyArray));
    }

    printResult(`SVM 发送地址: ${keypair.publicKey.toString()}`);

    // 2. 获取 USDC mint 和用户的 token account
    const usdcMint = new PublicKey(config.svmUsdcMint);
    const userTokenAccount = await getAssociatedTokenAddress(
      usdcMint,
      keypair.publicKey
    );

    // 3. 检查 USDC 余额
    try {
      const tokenAccountInfo = await getAccount(connection, userTokenAccount);
      const balance = tokenAccountInfo.amount;
      
      if (balance < BigInt(config.testAmount)) {
        throw new Error(`Insufficient USDC balance: ${balance} < ${config.testAmount}`);
      }
      
      printResult(`当前 USDC 余额: ${balance.toString()} (最小单位)`);
    } catch (error: any) {
      if (error.message && error.message.includes('could not find account')) {
        throw new Error('USDC token account does not exist');
      }
      throw error;
    }

    // 4. 构建跨链交易
    const programId = new PublicKey(config.svmContractAddress);
    
    // 推导 PDA 账户
    const [senderState] = await PublicKey.findProgramAddress(
      [Buffer.from('sender_state')],
      programId
    );

    const [vault] = await PublicKey.findProgramAddress(
      [Buffer.from('vault')],
      programId
    );

    // 获取 vault token account
    const vaultTokenAccount = await getAssociatedTokenAddress(
      usdcMint,
      vault,
      true // allowOwnerOffCurve
    );

    // 创建 stake 指令
    const stakeInstruction = createStakeInstruction(
      programId,
      senderState,
      keypair.publicKey,
      vault,
      usdcMint,
      userTokenAccount,
      vaultTokenAccount,
      BigInt(config.testAmount),
      config.evmReceiverAddress
    );

    // 创建并发送交易
    const transaction = new Transaction().add(stakeInstruction);
    
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [keypair],
      { commitment: 'confirmed' }
    );

    printResult(`SVM交易签名: ${signature}`);

    return {
      signature,
      nonce: undefined, // 可以从交易日志中解析 nonce
    };

  } catch (error: any) {
    printError(`SVM质押失败: ${error.message}`);
    throw error;
  }
}

// ============ Step 2: 查询 Relayer 状态 ============

async function queryRelayerStatus(config: Config, timeoutMs: number = 10000): Promise<boolean> {
  const startTime = Date.now();

  try {
    while (Date.now() - startTime < timeoutMs) {
      try {
        const statusResponse = await axios.get<RelayerStatus>(
          `${config.relayerApiUrl}/status`,
          { timeout: 3000 }
        );

        const status = statusResponse.data;
        
        // 检查 relayer 是否就绪
        if (status.listening && 
            status.source_chain.connected && 
            status.target_chain.connected &&
            status.relayer.whitelisted) {
          return true;
        }

      } catch (error: any) {
        // 静默处理查询失败，继续重试
      }

      await sleep(1000);
    }

    printError(`Relayer状态查询超时(${timeoutMs}ms)`);
    return false;

  } catch (error: any) {
    printError(`Relayer状态查询失败: ${error.message}`);
    return false;
  }
}

// ============ Step 3: 查询 EVM 余额变化 ============

async function checkEVMBalance(config: Config): Promise<bigint> {
  try {
    const provider = new ethers.JsonRpcProvider(config.evmRpcUrl);
    const usdc = new ethers.Contract(config.evmUsdcContract, ERC20_ABI, provider);
    
    const balance = await usdc.balanceOf(config.evmReceiverAddress);
    return balance;

  } catch (error: any) {
    printError(`EVM余额查询失败: ${error.message}`);
    throw error;
  }
}

// ============ 主程序 ============

async function main() {
  try {
    const config = loadConfig();

    // Step 0: 检查 EVM 初始余额
    printStage('阶段0: 查询EVM初始余额');
    const initialEvmBalance = await checkEVMBalance(config);
    printResult(`EVM初始余额: ${initialEvmBalance.toString()} (最小单位)`);

    // Step 1: 在 SVM 链上质押
    printStage('阶段1: SVM链质押');
    const { signature } = await stakeOnSVM(config);

    // Step 2: 查询 Relayer 状态
    printStage('阶段2: 查询Relayer状态');
    const relayerReady = await queryRelayerStatus(config, 10000);

    // Step 3: 等待一段时间后查询 EVM 余额变化
    printStage('阶段3: 查询EVM余额变化');
    await sleep(5000); // 等待跨链处理
    const finalEvmBalance = await checkEVMBalance(config);

    // 输出结果
    printStage('测试结果');
    printResult(`SVM质押金额: ${config.testAmount} (最小单位)`);
    printResult(`SVM交易签名: ${signature}`);
    printResult(`Relayer状态: ${relayerReady ? '就绪' : '未就绪'}`);
    
    const increase = finalEvmBalance - initialEvmBalance;
    const expectedIncrease = BigInt(config.testAmount);
    
    printResult(`EVM初始余额: ${initialEvmBalance.toString()} (最小单位)`);
    printResult(`EVM最终余额: ${finalEvmBalance.toString()} (最小单位)`);
    printResult(`EVM余额变化: ${increase > 0 ? '+' : ''}${increase.toString()} (最小单位)`);
    printResult(`预期变化: +${expectedIncrease.toString()} (最小单位)`);
    
    if (increase === expectedIncrease) {
      printResult(`跨链结果: 成功`);
    } else if (increase > 0) {
      printError(`跨链失败: 余额增加量不匹配 (预期${expectedIncrease}, 实际${increase})`);
    } else {
      printError(`跨链失败: EVM余额未增加`);
    }

  } catch (error: any) {
    printError(`脚本执行失败: ${error.message}`);
    process.exit(1);
  }
}

// 运行主程序
if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

export { stakeOnSVM, queryRelayerStatus, checkEVMBalance };


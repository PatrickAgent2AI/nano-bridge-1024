#!/usr/bin/env ts-node

/**
 * Cross-Chain Bridge Test Script
 * 
 * 测试流程：
 * 1. 在 EVM 链上质押 10 个最小单位的 USDC 并指定跨链到 SVM 地址
 * 2. 调用 relayer 查询状态，直到 ready（10秒超时）
 * 3. 查询 SVM 地址中是否增加了 10 个最小单位的 USDC
 * 
 * 注意：此脚本预期会执行失败，因为实际的跨链流程尚未完全实现
 */

import { ethers } from 'ethers';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { createAssociatedTokenAccount, getAssociatedTokenAddress } from '@solana/spl-token';
import { Program, AnchorProvider, Wallet, BN } from '@coral-xyz/anchor';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import axios from 'axios';

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

const BRIDGE_ABI = [
  'function stake(uint256 amount, string memory receiverAddress) external returns (uint64)',
  'function senderState() external view returns (address vault, address admin, address usdcContract, uint64 nonce, address targetContract, uint64 sourceChainId, uint64 targetChainId)',
];

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
];

// ============ 配置 ============

interface Config {
  evmRpcUrl: string;
  evmContractAddress: string;
  evmPrivateKey: string;
  evmUsdcContract: string;
  svmRpcUrl: string;
  svmUsdcMint: string;
  svmReceiverAddress: string;
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
    evmRpcUrl: checkEnv('EVM_RPC_URL', process.env.EVM_RPC_URL),
    evmContractAddress: checkEnv('EVM_CONTRACT_ADDRESS', process.env.EVM_CONTRACT_ADDRESS),
    evmPrivateKey: checkEnv('USER_EVM_PRIVATE_KEY', process.env.USER_EVM_PRIVATE_KEY),
    evmUsdcContract: checkEnv('USDC_EVM_CONTRACT', process.env.USDC_EVM_CONTRACT),
    svmRpcUrl: checkEnv('SVM_RPC_URL', process.env.SVM_RPC_URL),
    svmUsdcMint: checkEnv('USDC_SVM_MINT', process.env.USDC_SVM_MINT),
    svmReceiverAddress: checkEnv('TEST_RECEIVER_ADDRESS_SVM', process.env.TEST_RECEIVER_ADDRESS_SVM),
    relayerApiUrl: process.env.RELAYER_API_URL || 'http://localhost:8082',
    testAmount: '10', // 10 个最小单位
  };

  if (missingVars.length > 0) {
    throw new Error(`Missing environment variables: ${missingVars.join(', ')}`);
  }

  return config;
}

// ============ 辅助函数 ============

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

// ============ Step 0: 准备 SVM 环境 ============

async function prepareSVM(config: Config): Promise<void> {
  if (!IDL) {
    printError('IDL 文件未找到，跳过 SVM 准备');
    return;
  }

  try {
    const connection = new Connection(config.svmRpcUrl, { 
      commitment: 'confirmed', 
      confirmTransactionInitialTimeout: 120000,
      wsEndpoint: undefined, // 禁用 WebSocket，避免 ws error: 405
    });
    const adminKeypairData = JSON.parse(fs.readFileSync(process.env.ADMIN_SVM_KEYPAIR_PATH!, 'utf-8'));
    const adminKeypair = Keypair.fromSecretKey(new Uint8Array(adminKeypairData));
    const programId = new PublicKey(process.env.SVM_PROGRAM_ID!);
    const usdcMint = new PublicKey(config.svmUsdcMint);
    
    const [vault] = PublicKey.findProgramAddressSync([Buffer.from('vault')], programId);
    const [receiverState] = PublicKey.findProgramAddressSync([Buffer.from('receiver_state')], programId);
    
    // 1. 检查并创建 vault token account
    const vaultTokenAccount = await getAssociatedTokenAddress(usdcMint, vault, true);
    
    try {
      await connection.getTokenAccountBalance(vaultTokenAccount);
    } catch (e) {
      // Token account 不存在，创建它
      await createAssociatedTokenAccount(connection, adminKeypair, usdcMint, vault);
      await sleep(3000);
    }
    
    // 2. 添加流动性
    const wallet = new Wallet(adminKeypair);
    const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
    const program = new Program(IDL, provider);
    
    const adminTokenAccount = await getAssociatedTokenAddress(usdcMint, adminKeypair.publicKey);
    
    try {
      await program.methods
        .addLiquidity(new BN(100000000))
        .accounts({
          admin: adminKeypair.publicKey,
          receiverState: receiverState,
          vault: vault,
          usdcMint: usdcMint,
          adminTokenAccount: adminTokenAccount,
          vaultTokenAccount: vaultTokenAccount,
          tokenProgram: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
        })
        .rpc();
      
      await sleep(5000);
    } catch (e: any) {
      // 可能已经添加过流动性，忽略错误
    }
  } catch (error: any) {
    // 准备失败不影响测试继续
  }
}

// ============ Step 1: EVM 质押 ============

async function stakeOnEVM(config: Config): Promise<{ txHash: string; nonce: number }> {
  const provider = new ethers.JsonRpcProvider(config.evmRpcUrl);
  const wallet = new ethers.Wallet(config.evmPrivateKey, provider);
  const bridge = new ethers.Contract(config.evmContractAddress, BRIDGE_ABI, wallet);
  const usdc = new ethers.Contract(config.evmUsdcContract, ERC20_ABI, wallet);

  try {
    // 1. 检查 USDC 余额
    const balance = await usdc.balanceOf(wallet.address);
    if (balance < BigInt(config.testAmount)) {
      throw new Error(`Insufficient USDC balance`);
    }

    // 2. 检查并批准 USDC
    const currentAllowance = await usdc.allowance(wallet.address, config.evmContractAddress);
    if (currentAllowance < BigInt(config.testAmount)) {
      const approveTx = await usdc.approve(config.evmContractAddress, config.testAmount);
      await approveTx.wait();
    }

    // 3. 获取当前 nonce
    const senderState = await bridge.senderState();
    const currentNonce = Number(senderState[3]);
    const expectedNonce = currentNonce + 1;

    // 4. 执行 stake
    const stakeTx = await bridge.stake(config.testAmount, config.svmReceiverAddress);
    await stakeTx.wait();

    return {
      txHash: stakeTx.hash,
      nonce: expectedNonce,
    };

  } catch (error: any) {
    printError(`EVM质押失败: ${error.message}`);
    throw error;
  }
}

// ============ Step 2: 查询 Relayer 状态 ============

async function queryRelayerStatus(config: Config, nonce: number, timeoutMs: number = 10000): Promise<boolean> {
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

// ============ Step 3: 查询 SVM 余额变化 ============

async function checkSVMBalance(config: Config): Promise<{ balance: bigint | null; exists: boolean }> {
  try {
    const connection = new Connection(config.svmRpcUrl, { 
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 120000,  // 延长超时到 120 秒
      wsEndpoint: undefined, // 禁用 WebSocket，避免 ws error: 405
    });
    const receiverPubkey = new PublicKey(config.svmReceiverAddress);
    const usdcMint = new PublicKey(config.svmUsdcMint);

    const tokenAccount = await getAssociatedTokenAddress(
      usdcMint,
      receiverPubkey
    );

    try {
      const tokenAccountInfo = await connection.getTokenAccountBalance(tokenAccount);
      return {
        balance: BigInt(tokenAccountInfo.value.amount),
        exists: true,
      };
    } catch (e: any) {
      if (e.message && e.message.includes('could not find account')) {
        return { balance: null, exists: false };
      } else {
        throw e;
      }
    }

  } catch (error: any) {
    printError(`SVM余额查询失败: ${error.message}`);
    throw error;
  }
}

// ============ 主程序 ============

async function main() {
  try {
    const config = loadConfig();

    // Step 0: 准备 SVM 环境（初始化 vault，添加流动性）
    printStage('阶段0: 准备SVM环境');
    await prepareSVM(config);

    // Step 1: 在 EVM 链上质押
    printStage('阶段1: EVM链质押');
    const { txHash, nonce } = await stakeOnEVM(config);

    // Step 2: 查询 Relayer 状态
    printStage('阶段2: 查询Relayer状态');
    const relayerReady = await queryRelayerStatus(config, nonce, 10000);

    // Step 3: 查询 SVM 初始余额
    printStage('阶段3: 查询SVM余额');
    const initialSvmBalance = await checkSVMBalance(config);

    // 等待跨链完成（延长到 15 秒）
    await sleep(15000);
    const finalSvmBalance = await checkSVMBalance(config);

    // 输出结果
    printStage('测试结果');
    printResult(`EVM质押金额: ${config.testAmount} (最小单位)`);
    printResult(`EVM交易哈希: ${txHash}`);
    printResult(`Relayer状态: ${relayerReady ? '就绪' : '未就绪'}`);
    
    if (!initialSvmBalance.exists) {
      printResult(`SVM账户状态: 不存在`);
      printError(`跨链失败: SVM接收账户未创建`);
    } else if (!finalSvmBalance.exists) {
      printResult(`SVM账户状态: 消失(异常)`);
      printError(`跨链失败: SVM账户状态异常`);
    } else {
      const initialAmount = initialSvmBalance.balance || BigInt(0);
      const finalAmount = finalSvmBalance.balance || BigInt(0);
      const increase = finalAmount - initialAmount;
      const expectedIncrease = BigInt(config.testAmount);
      
      printResult(`SVM初始余额: ${initialAmount.toString()} (最小单位)`);
      printResult(`SVM最终余额: ${finalAmount.toString()} (最小单位)`);
      printResult(`SVM余额变化: ${increase > 0 ? '+' : ''}${increase.toString()} (最小单位)`);
      printResult(`预期变化: +${expectedIncrease.toString()} (最小单位)`);
      
      if (increase === expectedIncrease) {
        printResult(`跨链结果: 成功`);
      } else if (increase > 0) {
        printError(`跨链失败: 余额增加量不匹配 (预期${expectedIncrease}, 实际${increase})`);
      } else {
        printError(`跨链失败: SVM余额未增加`);
      }
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

export { stakeOnEVM, queryRelayerStatus, checkSVMBalance };


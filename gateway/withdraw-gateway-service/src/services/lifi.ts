import { createConfig, getRoutes, executeRoute, EVM } from '@lifi/sdk';
import { createWalletClient, http, Client } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrumSepolia, arbitrum } from 'viem/chains';
import { config } from '../config';
import { Mutex } from '../utils/rateLimiter';

// 创建 Viem Wallet Client
const getChain = () => {
  return config.arbitrum.chainId === 42161 ? arbitrum : arbitrumSepolia;
};

// 规范化私钥格式（确保是有效的 hex 格式）
const normalizePrivateKey = (key: string): `0x${string}` => {
  // 去除所有空白字符（包括换行符、空格等）
  let normalized = key.replace(/\s/g, '').trim();
  
  // 检查是否是 PEM 格式（通常以 BEGIN 开头）
  if (normalized.includes('BEGIN') || normalized.length > 100) {
    throw new Error(
      'Invalid private key format: PEM format is not supported. ' +
      'Please use a hex format private key (64 hex characters, with or without 0x prefix). ' +
      'Example: 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
    );
  }
  
  // 如果没有 0x 前缀，添加它
  if (!normalized.startsWith('0x')) {
    normalized = `0x${normalized}`;
  }
  
  // 验证私钥长度（64 个 hex 字符 + 0x 前缀 = 66 个字符）
  if (normalized.length !== 66) {
    throw new Error(
      `Invalid private key length: expected 66 characters (0x + 64 hex), got ${normalized.length}. ` +
      `Please check your TRANSIT_WALLET_PRIVATE_KEY in .env file. ` +
      `It should be a hex string like: 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef`
    );
  }
  
  // 验证是否为有效的 hex 字符串
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error('Invalid private key format: must be a valid hex string (0x followed by 64 hex characters)');
  }
  
  return normalized as `0x${string}`;
};

const account = privateKeyToAccount(normalizePrivateKey(config.wallet.privateKey));

const walletClient = createWalletClient({
  account,
  chain: getChain(),
  transport: http(config.arbitrum.rpcUrl),
});

// 创建 EVM Provider 用于 LiFi SDK
const evmProvider = EVM({
  getWalletClient: async (): Promise<Client> => {
    return walletClient as unknown as Client;
  },
  switchChain: async (requiredChainId: number) => {
    console.warn(`Chain switch required to ${requiredChainId}, but we're on ${config.arbitrum.chainId}`);
    return undefined;
  },
});

// 初始化 LiFi SDK
createConfig({
  integrator: 'WithdrawGatewayService',
  apiKey: config.lifi.apiKey,
  providers: [evmProvider],
});

// 交易发送锁（避免 nonce 冲突）
const txMutex = new Mutex();

export interface WithdrawRequest {
  targetChain: number;
  targetAsset: string;
  usdcAmount: string;
  recipientAddress: string;
}

export interface WithdrawResult {
  routeId: string;
  txHash?: string;
}

/**
 * 执行跨链提现
 */
export async function executeWithdraw(
  request: WithdrawRequest
): Promise<WithdrawResult> {
  // 获取锁，序列化交易发送
  const release = await txMutex.acquire();

  try {
    // 1. 获取跨链路由
    const routesResponse = await getRoutes({
      fromChainId: config.arbitrum.chainId,
      fromTokenAddress: config.arbitrum.usdcAddress,
      fromAmount: request.usdcAmount,
      toChainId: request.targetChain,
      toTokenAddress: request.targetAsset,
      fromAddress: walletClient.account.address,
      toAddress: request.recipientAddress,
      options: {
        slippage: config.defaults.slippage,
      },
    });

    if (!routesResponse.routes || routesResponse.routes.length === 0) {
      throw new Error('Failed to get routes from LiFi');
    }

    // 选择第一个路由（通常是最优的）
    const route = routesResponse.routes[0];

    // 2. 执行跨链路由
    let txHash: string | undefined;
    let lastStatus: string | undefined;
    let updateCount = 0;

    // 创建超时 Promise（5分钟超时）
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error('Route execution timeout after 5 minutes'));
      }, 5 * 60 * 1000);
    });

    // 执行路由，带超时
    await Promise.race([
      executeRoute(route, {
        updateRouteHook: (updatedRoute: any) => {
          updateCount++;
          const currentStatus = updatedRoute.status;
          
          // 只在状态变化或每10次更新时记录日志，避免日志过多
          if (currentStatus !== lastStatus || updateCount % 10 === 0) {
            console.log(`Route updated (${updateCount}):`, {
              id: updatedRoute.id,
              status: currentStatus,
              steps: updatedRoute.steps.map((s: any) => ({
                type: s.type,
                status: s.execution?.status || s.status,
                txHash: s.execution?.txHash || s.transactionRequest?.txHash,
                processStatus: s.execution?.process?.status,
              })),
            });
            lastStatus = currentStatus;
          }

          // 获取第一个交易哈希
          if (!txHash) {
            for (const step of updatedRoute.steps) {
              const stepTxHash = step.execution?.txHash || step.transactionRequest?.txHash;
              if (stepTxHash) {
                txHash = stepTxHash;
                console.log('Transaction hash obtained:', txHash);
                break;
              }
            }
          }
        },
        switchChainHook: async (requiredChainId: number) => {
          // 后端服务通常不需要切换链
          console.warn(`Chain switch required to ${requiredChainId}, but we're on ${config.arbitrum.chainId}`);
          // 返回 undefined 表示不切换链
          return undefined;
        },
        executeInBackground: false,
      }),
      timeoutPromise,
    ]);

    return {
      routeId: route.id,
      txHash,
    };
  } finally {
    release();
  }
}


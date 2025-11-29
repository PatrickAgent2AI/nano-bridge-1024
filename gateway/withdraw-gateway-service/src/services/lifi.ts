import { createConfig, getRoutes, executeRoute } from '@lifi/sdk';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrumSepolia, arbitrum } from 'viem/chains';
import { config } from '../config';
import { Mutex } from '../utils/rateLimiter';

// 初始化 LiFi SDK
createConfig({
  integrator: 'WithdrawGatewayService',
  apiKey: config.lifi.apiKey,
});

// 创建 Viem Wallet Client
const getChain = () => {
  return config.arbitrum.chainId === 42161 ? arbitrum : arbitrumSepolia;
};

const account = privateKeyToAccount(config.wallet.privateKey as `0x${string}`);

const walletClient = createWalletClient({
  account,
  chain: getChain(),
  transport: http(config.arbitrum.rpcUrl),
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

    await executeRoute(route, {
      updateRouteHook: (updatedRoute: any) => {
        // 跟踪路由执行进度
        console.log('Route updated:', {
          id: updatedRoute.id,
          status: updatedRoute.status,
          steps: updatedRoute.steps.map((s: any) => ({
            type: s.type,
            status: s.status,
            txHash: s.transactionRequest?.txHash,
          })),
        });

        // 获取第一个交易哈希
        if (!txHash) {
          const firstStep = updatedRoute.steps.find(
            (s: any) => s.transactionRequest?.txHash
          );
          if (firstStep?.transactionRequest?.txHash) {
            txHash = firstStep.transactionRequest.txHash;
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
    });

    return {
      routeId: route.id,
      txHash,
    };
  } finally {
    release();
  }
}


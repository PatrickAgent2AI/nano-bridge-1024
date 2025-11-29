import dotenv from 'dotenv';

dotenv.config();

export const config = {
  lifi: {
    apiKey: process.env.LIFI_API_KEY || undefined,
  },
  arbitrum: {
    rpcUrl: process.env.ARBITRUM_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc',
    chainId: parseInt(process.env.ARBITRUM_CHAIN_ID || '421614', 10),
    usdcAddress: process.env.ARBITRUM_USDC_ADDRESS || '',
  },
  wallet: {
    privateKey: process.env.TRANSIT_WALLET_PRIVATE_KEY || '',
  },
  defaults: {
    slippage: parseFloat(process.env.DEFAULT_SLIPPAGE || '0.03'),
  },
  server: {
    port: parseInt(process.env.PORT || '8085', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
  },
};

// 验证必需的配置
if (!config.wallet.privateKey) {
  throw new Error('TRANSIT_WALLET_PRIVATE_KEY is required');
}

if (!config.arbitrum.usdcAddress) {
  throw new Error('ARBITRUM_USDC_ADDRESS is required');
}


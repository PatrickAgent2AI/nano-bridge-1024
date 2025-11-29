import express from 'express';
import { createConfig } from '@lifi/sdk';
import withdrawRouter from './routes/withdraw';
import { config } from './config';

// 初始化 LiFi SDK
createConfig({
  integrator: 'WithdrawGatewayService',
  apiKey: config.lifi.apiKey,
});

const app = express();
const port = config.server.port;

// 中间件
app.use(express.json());

// 健康检查端点
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'withdraw-gateway-service' });
});

// 路由
app.use('/withdraw', withdrawRouter);

// 启动服务器
app.listen(port, () => {
  console.log(`Withdraw Gateway Service listening on port ${port}`);
  console.log(`Environment: ${config.server.nodeEnv}`);
  console.log(`Arbitrum Chain ID: ${config.arbitrum.chainId}`);
  console.log(`Arbitrum RPC: ${config.arbitrum.rpcUrl}`);
  console.log(`LiFi API Key: ${config.lifi.apiKey ? 'Configured' : 'Not configured'}`);
});


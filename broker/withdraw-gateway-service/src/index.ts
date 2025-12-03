import express from 'express';
import cors from 'cors';
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

// CORS 配置
const corsOptions = {
  origin: function (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
    // 允许的源列表
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001',
    ];
    
    // 开发环境允许所有源，生产环境需要配置具体的源
    if (config.server.nodeEnv === 'development' || !origin) {
      callback(null, true);
    } else if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      // 也可以从环境变量读取允许的源
      const envOrigins = process.env.CORS_ALLOWED_ORIGINS?.split(',') || [];
      if (envOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

// 中间件
app.use(cors(corsOptions));
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




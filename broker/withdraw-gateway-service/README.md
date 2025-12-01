# Withdraw Gateway Service

## 概述

Withdraw Gateway Service 是一个 TypeScript/Node.js 实现的 HTTP 服务，用于完成跨链桥的提现方向：从 1024chain 的 USDC 到任意链的任意资产。

**工作流程：**
1. 当 USDC 成功跨链到 Arbitrum 上的 USDC 后，调用本服务的 HTTP 接口
2. 本服务接收 HTTP 请求（参数：目标链、目标资产、USDC 金额）
3. 服务使用 LiFi SDK 获取跨链报价并执行跨链交易
4. 完成从 Arbitrum 上的 USDC 到目标链目标资产的跨链

## 架构说明

本服务与 `evm-gateway-service` 和 `relayer` 完全独立：
- **evm-gateway-service**：负责接收外部请求，使用中转钱包调用 EVM stake 接口（单向：Arbitrum → 1024chain）
- **relayer**：负责监听链上事件、签名验证、多签提交（双向跨链）
- **withdraw-gateway-service**：负责接收提现请求，使用 LiFi SDK 完成跨链（单向：Arbitrum → 任意链）

## 技术栈

- **运行时**：Node.js 18+
- **语言**：TypeScript
- **HTTP 框架**：Express
- **跨链 SDK**：[@lifi/sdk](https://docs.li.fi/sdk/overview)
- **EVM Provider**：Viem（LiFi SDK 内置支持）
- **日志**：Winston 或 Pino
- **配置管理**：dotenv

## 设计方案

### HTTP 接口设计

#### POST /withdraw

接收提现请求，使用 LiFi SDK 发起跨链交易。

**请求体：**
```json
{
  "target_chain": 1,
  "target_asset": "0x6B175474E89094C44Da98b954EedeAC495271d0F",
  "usdc_amount": "1000000",
  "recipient_address": "0xRecipientAddress"
}
```

**参数说明：**
- `target_chain`：目标链的链 ID（整数，例如：1 = Ethereum Mainnet, 137 = Polygon）
- `target_asset`：目标链上资产的合约地址（字符串，hex 格式）
- `usdc_amount`：要提现的 USDC 数量（字符串格式，最小单位，例如 "1000000" = 1 USDC，假设 6 位小数）
- `recipient_address`：接收资产的目标地址（字符串，hex 格式）

**响应示例：**
```json
{
  "success": true,
  "message": "Withdrawal initiated",
  "route_id": "route_id_from_lifi",
  "tx_hash": "0x..."
}
```

**错误响应：**
```json
{
  "success": false,
  "message": "错误信息",
  "route_id": null,
  "tx_hash": null
}
```

### LiFi SDK 集成

根据 [LiFi SDK 文档](https://docs.li.fi/sdk/overview)，集成步骤如下：

#### 1. 安装和配置 SDK

**安装依赖：**
```bash
npm install @lifi/sdk viem express dotenv
npm install -D typescript @types/node @types/express ts-node
```

**初始化 SDK 配置：**
```typescript
import { createConfig } from '@lifi/sdk';

createConfig({
  integrator: 'YourCompanyName',
  apiKey: process.env.LIFI_API_KEY, // 可选，用于提高速率限制
});
```

#### 2. 配置 EVM Provider

LiFi SDK 使用 Viem 作为 EVM Provider。需要配置 Viem 的 Wallet Client 来签名交易：

```typescript
import { createWalletClient, http, privateKeyToAccount } from 'viem';
import { arbitrumSepolia } from 'viem/chains';

// 从私钥创建账户
const account = privateKeyToAccount(process.env.TRANSIT_WALLET_PRIVATE_KEY as `0x${string}`);

// 创建 Wallet Client
const walletClient = createWalletClient({
  account,
  chain: arbitrumSepolia,
  transport: http(process.env.ARBITRUM_RPC_URL),
});
```

#### 3. 获取跨链报价（Quote）

使用 `getQuote` 或 `getRoutes` 方法获取跨链报价：

```typescript
import { getQuote } from '@lifi/sdk';

const quoteRequest = {
  fromChain: 421614, // Arbitrum Sepolia
  fromToken: '0xUSDC_ON_ARBITRUM', // Arbitrum 上的 USDC 地址
  fromAmount: '1000000', // USDC 数量
  toChain: targetChain, // 目标链 ID
  toToken: targetAsset, // 目标资产地址
  fromAddress: walletClient.account.address,
  toAddress: recipientAddress,
  slippage: 0.03, // 3% 滑点
};

const quote = await getQuote(quoteRequest);
```

**参数说明：**
- `fromChain`：源链 ID（Arbitrum Sepolia: 421614, Arbitrum Mainnet: 42161）
- `fromToken`：源代币地址（Arbitrum 上的 USDC 合约地址）
- `fromAmount`：USDC 数量（字符串格式）
- `toChain`：目标链 ID（从请求参数 `target_chain` 获取）
- `toToken`：目标代币地址（从请求参数 `target_asset` 获取）
- `fromAddress`：发起交易的地址（中转钱包地址）
- `toAddress`：接收资产的目标地址（从请求参数 `recipient_address` 获取）
- `slippage`：可接受的滑点（从配置文件获取，默认 0.03 表示 3%）

**返回的 Quote 对象包含：**
- `id`：路由 ID
- `fromChainId`：源链 ID
- `fromAmount`：源金额
- `fromToken`：源代币信息
- `toChainId`：目标链 ID
- `toAmount`：目标金额
- `toToken`：目标代币信息
- `steps`：跨链步骤数组
- `gasCosts`：Gas 费用信息

#### 4. 执行跨链路由（Execute Route）

使用 `executeRoute` 方法执行跨链交易：

```typescript
import { executeRoute } from '@lifi/sdk';

const route = quote; // 使用获取的 quote 作为 route

await executeRoute(walletClient, route, {
  updateCallback: (updatedRoute) => {
    // 路由状态更新回调
    console.log('Route updated:', updatedRoute);
    // 可以在这里更新数据库中的路由状态
  },
  switchChainHook: async (requiredChainId) => {
    // 如果需要切换链，这个 hook 会被调用
    // 对于后端服务，通常不需要切换链（因为已经在正确的链上）
    console.log('Chain switch required:', requiredChainId);
  },
  infiniteApproval: false, // 是否使用无限授权
  executeInBackground: false, // 是否在后台执行
});
```

**executeRoute 参数说明：**
- `walletClient`：Viem 的 Wallet Client（用于签名交易）
- `route`：要执行的路由对象（从 `getQuote` 获取）
- `options`：
  - `updateCallback`：路由状态更新时的回调函数
  - `switchChainHook`：需要切换链时的回调函数（后端服务通常不需要）
  - `infiniteApproval`：是否使用无限授权（默认 false）
  - `executeInBackground`：是否在后台执行（默认 false）

**执行流程：**
1. SDK 会自动处理路由中的每个步骤（swap、bridge 等）
2. 对于每个步骤，SDK 会：
   - 检查代币授权（如果需要）
   - 发送授权交易（如果需要）
   - 发送实际的跨链交易
   - 等待交易确认
3. `updateCallback` 会在每个步骤完成后被调用，可以用于跟踪进度

#### 5. 查询路由状态（可选）

如果需要查询路由的执行状态，可以使用 `getRouteStatus`：

```typescript
import { getRouteStatus } from '@lifi/sdk';

const status = await getRouteStatus(routeId);
```

### 配置文件设计

**配置文件：** `.env`

**配置项：**
```bash
# LiFi SDK 配置
LIFI_API_KEY=your_api_key_here  # 可选，用于提高速率限制

# Arbitrum 配置
ARBITRUM_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc
ARBITRUM_CHAIN_ID=421614  # Arbitrum Sepolia: 421614, Arbitrum Mainnet: 42161
ARBITRUM_USDC_ADDRESS=0x...  # Arbitrum 上的 USDC 合约地址

# 中转钱包配置
TRANSIT_WALLET_PRIVATE_KEY=0x...  # 私钥（hex 格式，带 0x 前缀）

# 默认配置
DEFAULT_SLIPPAGE=0.03  # 默认滑点 3%

# HTTP 服务配置
PORT=8085  # HTTP 服务端口（默认 8085，避免与 evm-gateway-service 的 8084 冲突）
NODE_ENV=production  # 环境：development 或 production
```

**配置说明：**
- `LIFI_API_KEY`：LiFi API 密钥（可选）
  - 不使用 API 密钥：每两小时最多 200 个请求
  - 使用 API 密钥：每分钟最多 200 个请求
  - 建议生产环境使用 API 密钥以提高速率限制
- `TRANSIT_WALLET_PRIVATE_KEY`：中转钱包私钥，用于签名和执行跨链交易
- `DEFAULT_SLIPPAGE`：默认滑点，如果用户请求中未指定则使用此值

### 并发访问处理

#### LiFi SDK 并发支持

根据 [LiFi API 速率限制文档](https://docs.li.fi/api-reference/rate-limits-and-api-authentication)：

1. **未认证用户（无 API 密钥）：**
   - 速率限制：每两小时最多 200 个请求
   - 基于 IP 地址计算

2. **已认证用户（使用 API 密钥）：**
   - 速率限制：每分钟最多 200 个请求
   - 基于 API 密钥计算

3. **并发支持：**
   - LiFi SDK 本身支持并发请求
   - 但受速率限制约束
   - 当超过速率限制时，会返回 `429 Too Many Requests` 错误

#### 并发控制策略

为了确保并发访问时不会触发速率限制和并发错误，建议实现以下机制：

1. **请求队列（Request Queue）**
   - 使用 `p-queue` 或类似的队列库
   - 限制并发请求数量（例如：最多 5 个并发请求）
   - 确保请求按顺序或受控并发处理

2. **速率限制控制（Rate Limiting）**
   - 使用 `bottleneck` 或 `rate-limiter-flexible` 库
   - 实现令牌桶（Token Bucket）算法
   - 控制请求发送速率，确保不超过 LiFi API 的速率限制
   - 如果使用 API 密钥：每分钟最多 200 个请求 = 每秒约 3.3 个请求
   - 如果不使用 API 密钥：每两小时 200 个请求 = 每 36 秒 1 个请求

3. **错误处理和重试机制**
   - 检测 `429 Too Many Requests` 错误
   - 实现指数退避（Exponential Backoff）重试机制
   - 记录错误日志，便于排查问题

4. **交易发送序列化**
   - 使用 `Mutex` 或锁机制序列化交易发送操作
   - 避免 nonce 冲突和余额检查竞态条件
   - 确保同一钱包的交易按顺序发送

**实现示例：**
```typescript
import PQueue from 'p-queue';
import { RateLimiter } from 'rate-limiter-flexible';

// 创建请求队列（最多 5 个并发）
const requestQueue = new PQueue({ concurrency: 5 });

// 创建速率限制器（每分钟 200 个请求）
const rateLimiter = new RateLimiter({
  points: 200, // 令牌数量
  duration: 60, // 时间窗口（秒）
});

// 交易发送锁
const txMutex = new Mutex();

// 在请求处理中使用
async function handleWithdrawRequest(req, res) {
  try {
    // 检查速率限制
    await rateLimiter.consume('lifi-api');
    
    // 加入队列
    await requestQueue.add(async () => {
      // 获取锁
      const release = await txMutex.acquire();
      try {
        // 执行跨链交易
        const result = await executeCrossChain(req.body);
        return result;
      } finally {
        release();
      }
    });
  } catch (error) {
    // 处理速率限制错误
    if (error.remainingPoints !== undefined) {
      // 速率限制错误
      return res.status(429).json({
        success: false,
        message: 'Rate limit exceeded',
      });
    }
    throw error;
  }
}
```

### 调用步骤总结

1. **接收 HTTP 请求**
   - 验证请求参数（target_chain, target_asset, usdc_amount, recipient_address）
   - 检查参数格式和有效性

2. **初始化 LiFi SDK**
   - 调用 `createConfig` 配置 SDK
   - 创建 Viem Wallet Client

3. **获取跨链报价**
   - 构造 `getQuote` 请求参数
   - 调用 `getQuote` 获取报价
   - 验证报价是否有效

4. **执行跨链交易**
   - 使用 `executeRoute` 执行路由
   - 通过 `updateCallback` 跟踪进度
   - 等待所有步骤完成

5. **返回结果**
   - 返回交易哈希和路由 ID
   - 记录日志
   - 可选：启动后台任务查询交易状态

### 错误处理

**常见错误情况：**
1. **参数验证错误**：返回 400 Bad Request
2. **LiFi SDK 错误**：
   - `429 Too Many Requests`：速率限制，需要等待后重试
   - `400 Bad Request`：参数错误，检查请求参数
   - `500 Internal Server Error`：LiFi 服务错误，记录日志并重试
3. **交易执行错误**：
   - Gas 不足：返回错误信息
   - 余额不足：返回错误信息
   - 交易失败：返回错误信息和交易哈希（如果已发送）

### 项目结构

```
withdraw-gateway-service/
├── package.json
├── tsconfig.json
├── .env.example
├── README.md          # 本文件
├── src/
│   ├── index.ts       # 服务入口
│   ├── routes/
│   │   └── withdraw.ts  # 提现路由处理
│   ├── services/
│   │   └── lifi.ts    # LiFi SDK 封装服务
│   ├── config/
│   │   └── index.ts   # 配置管理
│   └── utils/
│       └── rateLimiter.ts  # 速率限制工具
└── dist/              # 编译后的 JavaScript 文件
```

### 实现示例代码

**src/index.ts（服务入口）：**
```typescript
import express from 'express';
import dotenv from 'dotenv';
import { createConfig } from '@lifi/sdk';
import withdrawRouter from './routes/withdraw';

dotenv.config();

// 初始化 LiFi SDK
createConfig({
  integrator: 'WithdrawGatewayService',
  apiKey: process.env.LIFI_API_KEY,
});

const app = express();
const port = process.env.PORT || 8085;

app.use(express.json());
app.use('/withdraw', withdrawRouter);

app.listen(port, () => {
  console.log(`Withdraw Gateway Service listening on port ${port}`);
});
```

**src/routes/withdraw.ts（路由处理）：**
```typescript
import { Router, Request, Response } from 'express';
import { executeWithdraw } from '../services/lifi';

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  try {
    const { target_chain, target_asset, usdc_amount, recipient_address } = req.body;
    
    // 参数验证
    if (!target_chain || !target_asset || !usdc_amount || !recipient_address) {
      return res.status(400).json({
        success: false,
        message: 'Missing required parameters',
      });
    }

    // 执行跨链提现
    const result = await executeWithdraw({
      targetChain: target_chain,
      targetAsset: target_asset,
      usdcAmount: usdc_amount,
      recipientAddress: recipient_address,
    });

    res.json({
      success: true,
      message: 'Withdrawal initiated',
      route_id: result.routeId,
      tx_hash: result.txHash,
    });
  } catch (error) {
    console.error('Withdraw error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

export default router;
```

### 注意事项

1. **中转钱包资金**：
   - 确保中转钱包有足够的 ETH（用于支付 gas 费用）
   - 确保中转钱包有足够的 USDC（用于跨链）

2. **API 密钥安全**：
   - 妥善保管 `LIFI_API_KEY`，不要泄露
   - 不要在客户端代码中暴露 API 密钥
   - 使用环境变量管理密钥

3. **速率限制**：
   - 生产环境建议使用 API 密钥以提高速率限制
   - 实现合理的并发控制和重试机制
   - 监控 API 调用频率，避免超过限制

4. **网络配置**：
   - 确保 RPC_URL 可访问且稳定
   - 考虑使用多个 RPC 节点作为备选
   - 配置合理的超时时间

5. **监控和日志**：
   - 记录所有请求和响应
   - 监控交易成功率和错误率
   - 设置告警机制
   - 记录路由执行状态，便于追踪

6. **交易状态跟踪**：
   - 使用 `updateCallback` 跟踪路由执行进度
   - 将路由状态保存到数据库
   - 提供查询接口让用户查询交易状态

## 相关文档

- [LiFi SDK 文档](https://docs.li.fi/sdk/overview)
- [LiFi SDK 安装指南](https://docs.li.fi/sdk/install)
- [LiFi SDK 配置](https://docs.li.fi/sdk/configure)
- [LiFi SDK 请求路由](https://docs.li.fi/sdk/request-routes-quotes)
- [LiFi SDK 执行路由](https://docs.li.fi/sdk/execute-routes-quotes)
- [LiFi API 速率限制](https://docs.li.fi/api-reference/rate-limits-and-api-authentication)
- [主项目 README](../../README.md)
- [EVM Gateway Service 文档](../evm-gateway-service/README.md)

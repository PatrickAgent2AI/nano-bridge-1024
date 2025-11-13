# Relayer 中继服务

## 概述

Relayer 是跨链桥系统的核心中继组件，负责监听质押事件、验证签名并将签名提交到接收端合约。本项目采用**双服务架构**，分别处理两个跨链方向，使用各自原生的密码学算法。

### 设计架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         Relayer 系统                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────┐    ┌──────────────────────────┐  │
│  │   s2e (SVM → EVM)       │    │   e2s (EVM → SVM)       │  │
│  │  独立进程 | 独立密钥      │    │  独立进程 | 独立密钥      │  │
│  ├──────────────────────────┤    ├──────────────────────────┤  │
│  │ 监听: 1024chain (SVM)    │    │ 监听: Arbitrum (EVM)     │  │
│  │ 签名: ECDSA (secp256k1)  │    │ 签名: Ed25519            │  │
│  │ 序列化: JSON             │    │ 序列化: Borsh            │  │
│  │ 提交: Arbitrum (EVM)     │    │ 提交: 1024chain (SVM)    │  │
│  │ 端口: 8081               │    │ 端口: 8082               │  │
│  └──────────────────────────┘    └──────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              HTTP API (共享功能模块)                      │  │
│  │  - GET /health         - 健康检查                        │  │
│  │  - GET /status         - 运行状态                        │  │
│  │  - GET /queue          - 任务队列                        │  │
│  │  - GET /nonce          - 当前nonce                       │  │
│  │  - GET /task/:id       - 任务详情                        │  │
│  │  - GET /metrics        - 性能指标                        │  │
│  │  - GET /config         - 配置信息（脱敏）                │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## 目录结构

```
relayer/
├── README.md                    # 本文件
├── s2e/                         # SVM → EVM 中继服务
│   ├── src/
│   │   ├── main.ts              # 服务入口
│   │   ├── listener.ts          # SVM 事件监听
│   │   ├── signer.ts            # ECDSA 签名器
│   │   ├── submitter.ts         # EVM 交易提交
│   │   ├── api.ts               # HTTP API 服务
│   │   └── types.ts             # 类型定义
│   ├── config/
│   │   ├── config.ts            # 配置管理
│   │   ├── .env.example         # 环境变量模板
│   │   └── testnet.json         # 测试网配置
│   ├── tests/
│   │   └── integration.test.ts  # 集成测试
│   ├── package.json
│   └── tsconfig.json
│
├── e2s/                         # EVM → SVM 中继服务
│   ├── src/
│   │   ├── main.ts              # 服务入口
│   │   ├── listener.ts          # EVM 事件监听
│   │   ├── signer.ts            # Ed25519 签名器
│   │   ├── submitter.ts         # SVM 交易提交
│   │   ├── api.ts               # HTTP API 服务
│   │   └── types.ts             # 类型定义
│   ├── config/
│   │   ├── config.ts            # 配置管理
│   │   ├── .env.example         # 环境变量模板
│   │   └── testnet.json         # 测试网配置
│   ├── tests/
│   │   └── integration.test.ts  # 集成测试
│   ├── package.json
│   └── tsconfig.json
│
├── shared/                      # 共享库
│   ├── src/
│   │   ├── database.ts          # 数据库操作
│   │   ├── logger.ts            # 日志系统
│   │   ├── metrics.ts           # 性能监控
│   │   ├── queue.ts             # 任务队列
│   │   └── utils.ts             # 工具函数
│   ├── package.json
│   └── tsconfig.json
│
└── docs/
    ├── deployment.md            # 部署指南
    ├── monitoring.md            # 监控指南
    └── troubleshooting.md       # 故障排除
```

## 核心设计原则

### 1. 双服务架构

**为什么需要两个独立服务？**

- **密码学隔离**：SVM 和 EVM 使用完全不同的签名算法，分离可以避免混淆
- **进程隔离**：独立进程确保一个方向的故障不会影响另一个方向
- **密钥安全**：每个服务使用不同的密钥对，降低密钥泄露风险
- **独立扩展**：可以根据流量需求独立扩展每个方向的实例数量
- **简化维护**：代码逻辑清晰，便于维护和调试

### 2. 高性能异步任务处理架构

采用经典的生产者-消费者模式：

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Event       │────▶│  Task Queue  │────▶│  Worker Pool │
│  Listener    │     │  (Redis)     │     │  (Async)     │
│  (Producer)  │     │              │     │  (Consumer)  │
└──────────────┘     └──────────────┘     └──────────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │  PostgreSQL  │
                     │  (State)     │
                     └──────────────┘
```

**架构特点**：
- **事件监听器（Producer）**：异步监听区块链事件，将任务放入队列
- **任务队列（Redis）**：高性能消息队列，支持持久化和优先级
- **Worker Pool（Consumer）**：多个 worker 并发处理任务
- **状态存储（PostgreSQL）**：持久化任务状态和历史记录

**性能优势**：
- 事件监听和处理解耦，互不阻塞
- 支持水平扩展（增加 worker 数量）
- 队列缓冲应对突发流量
- 异步处理提升吞吐量

### 3. 事件去重和幂等性保证

**问题**：网络波动可能导致同一个事件被多次接收和处理。

**解决方案**：

1. **数据库去重**：
```typescript
// 检查 nonce 是否已处理
const existingTask = await db.query(
  'SELECT id FROM tasks WHERE nonce = $1 AND service = $2',
  [nonce, serviceName]
);
if (existingTask.rows.length > 0) {
  logger.info(`Nonce ${nonce} already processed, skipping`);
  return;
}
```

2. **分布式锁**（防止并发处理）：
```typescript
const lock = await redis.lock(`task:${nonce}`, 30000); // 30秒锁
try {
  // 处理事件
  await processEvent(event);
} finally {
  await lock.unlock();
}
```

3. **合约层验证**：
- 依赖合约的 nonce 递增判断机制
- 重复提交会被合约拒绝
- 不会造成资金损失

### 4. 错误重试策略

**指数退避重试**：

```typescript
const retryStrategy = {
  maxRetries: 5,
  delays: [0, 30000, 60000, 120000, 300000], // 0s, 30s, 1m, 2m, 5m
};

async function retryWithBackoff(task: Task) {
  for (let i = 0; i < retryStrategy.maxRetries; i++) {
    try {
      await processTask(task);
      return; // 成功
    } catch (error) {
      if (!isRetryableError(error)) {
        // 不可重试错误，立即失败
        throw error;
      }
      
      if (i < retryStrategy.maxRetries - 1) {
        await sleep(retryStrategy.delays[i]);
        logger.warn(`Retry ${i + 1}/${retryStrategy.maxRetries} for task ${task.id}`);
      }
    }
  }
  throw new Error('Max retries exceeded');
}
```

**错误分类**：

| 错误类型 | 是否重试 | 处理方式 |
|---------|---------|---------|
| RPC 超时 | ✅ 是 | 指数退避重试 |
| Gas 估算失败 | ✅ 是 | 重试并增加 Gas Limit |
| 网络波动 | ✅ 是 | 切换备用 RPC 节点 |
| Nonce 已使用 | ❌ 否 | 标记为已完成，跳过 |
| 签名验证失败 | ❌ 否 | 记录错误，人工介入 |
| 权限不足 | ❌ 否 | 记录错误，检查白名单 |
| 余额不足 | ❌ 否 | 发送告警，停止服务 |

### 5. 区块确认深度

**问题**：区块重组可能导致事件被回滚。

**确认策略**：

```typescript
// 配置不同链的确认深度
const confirmationConfig = {
  // EVM (Arbitrum)
  evm: {
    testnet: 6,   // 约 1.5 分钟（15秒/块）
    mainnet: 12,  // 约 3 分钟
  },
  // SVM (1024chain/Solana)
  svm: {
    testnet: 16,  // 约 6.4 秒（400ms/slot）
    mainnet: 32,  // 约 12.8 秒（finalized）
  }
};

// 监听事件时只处理已确认的区块
async function listenEvents() {
  const latestBlock = await provider.getBlockNumber();
  const safeBlock = latestBlock - confirmationConfig.evm.testnet;
  
  const events = await contract.queryFilter(
    'StakeEvent',
    safeBlock - 100, // 扫描最近100个确认块
    safeBlock
  );
  
  for (const event of events) {
    await enqueueTask(event);
  }
}
```

**SVM 确认级别**：
```typescript
// Solana 使用 commitment level
const commitment: Commitment = 'finalized'; // 32 slots, ~13秒

connection.onLogs(
  programId,
  (logs) => {
    // 处理已最终确认的日志
  },
  commitment
);
```

### 6. 密码学设计

#### s2e: SVM → EVM 签名流程

```typescript
// 1. 监听 SVM 事件（Anchor/Borsh 格式，使用 finalized commitment）
const svmEvent = await listenSvmStakeEvent();

// 2. 转换为 EVM 格式（JSON 序列化）
const jsonData = {
  sourceContract: svmEvent.sourceContract.toBase58(),
  targetContract: svmEvent.targetContract.toBase58(),
  chainId: svmEvent.sourceChainId.toString(),
  blockHeight: svmEvent.blockHeight.toString(),
  amount: svmEvent.amount.toString(),
  receiverAddress: svmEvent.receiverAddress,
  nonce: svmEvent.nonce.toString()
};
const jsonString = JSON.stringify(jsonData);

// 3. 计算哈希（SHA-256 + EIP-191）
const sha256Hash = crypto.createHash('sha256').update(jsonString).digest();
const ethSignedHash = ethers.utils.keccak256(
  ethers.utils.concat([
    ethers.utils.toUtf8Bytes('\x19Ethereum Signed Message:\n32'),
    sha256Hash
  ])
);

// 4. ECDSA 签名（secp256k1）
const signature = await ecdsaWallet.signMessage(ethers.utils.arrayify(ethSignedHash));
// 输出：65 字节 (r: 32, s: 32, v: 1)

// 5. 提交到 EVM 合约
await evmContract.submitSignature(eventData, signature);
```

#### e2s: EVM → SVM 签名流程

```typescript
// 1. 监听 EVM 事件（Web3 event logs，等待确认深度）
const evmEvent = await listenEvmStakeEvent();

// 2. 转换为 SVM 格式（构造 Anchor 类型）
const svmEventData: StakeEventData = {
  sourceContract: new PublicKey(evmEvent.sourceContract),
  targetContract: new PublicKey(evmEvent.targetContract),
  sourceChainId: new BN(evmEvent.chainId),
  targetChainId: new BN(evmEvent.targetChainId),
  blockHeight: new BN(evmEvent.blockHeight),
  amount: new BN(evmEvent.amount),
  receiverAddress: evmEvent.receiverAddress,
  nonce: new BN(evmEvent.nonce)
};

// 3. Borsh 序列化
const message = program.coder.types.encode("StakeEventData", svmEventData);

// 4. Ed25519 签名
const signature = await ed25519.sign(message, keypair.secretKey.slice(0, 32));
// 输出：64 字节

// 5. 创建 Ed25519Program 验证指令
const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
  publicKey: keypair.publicKey.toBytes(),
  message: message,
  signature: signature
});

// 6. 提交到 SVM 合约（包含验证指令）
await program.methods
  .submitSignature(svmEventData.nonce, svmEventData, Array.from(signature))
  .preInstructions([ed25519Ix])
  .rpc();
```

### 7. Gas 费用管理和余额监控

**启动时余额检查**：

```typescript
// 服务启动时检查余额
async function checkBalances() {
  const svmBalance = await connection.getBalance(svmWallet.publicKey);
  const evmBalance = await provider.getBalance(evmWallet.address);
  
  const minSvmBalance = 5 * LAMPORTS_PER_SOL; // 最低 5 SOL
  const minEvmBalance = ethers.utils.parseEther('0.1'); // 最低 0.1 ETH
  
  if (svmBalance < minSvmBalance) {
    throw new Error(`Insufficient SVM balance: ${svmBalance / LAMPORTS_PER_SOL} SOL (require ${minSvmBalance / LAMPORTS_PER_SOL} SOL)`);
  }
  
  if (evmBalance.lt(minEvmBalance)) {
    throw new Error(`Insufficient EVM balance: ${ethers.utils.formatEther(evmBalance)} ETH (require 0.1 ETH)`);
  }
  
  logger.info('Balance check passed', {
    svm: `${svmBalance / LAMPORTS_PER_SOL} SOL`,
    evm: `${ethers.utils.formatEther(evmBalance)} ETH`
  });
}

// 在 main 函数中调用
async function main() {
  await checkBalances(); // 启动前检查
  await startService();
}
```

**Gas 不足错误处理**：

```typescript
async function submitTransaction(tx: Transaction) {
  try {
    return await tx.send();
  } catch (error) {
    if (error.message.includes('insufficient funds')) {
      logger.error('Insufficient funds for gas fee', {
        error: error.message,
        balance: await getBalance()
      });
      
      // 发送告警
      await sendAlert({
        level: 'critical',
        message: 'Relayer out of gas',
        service: serviceName
      });
      
      // 停止服务，防止继续消耗资源
      process.exit(1);
    }
    throw error;
  }
}
```

**余额监控**（定时检查）：

```typescript
// 每5分钟检查一次余额
setInterval(async () => {
  const svmBalance = await connection.getBalance(svmWallet.publicKey);
  const evmBalance = await provider.getBalance(evmWallet.address);
  
  // 记录指标
  metrics.gauge('relayer_balance_svm', svmBalance / LAMPORTS_PER_SOL);
  metrics.gauge('relayer_balance_evm', parseFloat(ethers.utils.formatEther(evmBalance)));
  
  // 余额告警
  if (svmBalance < 10 * LAMPORTS_PER_SOL) {
    logger.warn('Low SVM balance', { balance: svmBalance / LAMPORTS_PER_SOL });
  }
  
  if (evmBalance.lt(ethers.utils.parseEther('0.2'))) {
    logger.warn('Low EVM balance', { balance: ethers.utils.formatEther(evmBalance) });
  }
}, 5 * 60 * 1000);
```

### 8. 密钥管理

每个 Relayer 需要维护**两对密钥**：

#### s2e 服务密钥

```bash
# ECDSA 密钥（用于签名提交到 EVM）
ECDSA_PRIVATE_KEY=0x1234567890abcdef...  # 32 字节，用于 EVM 签名

# SVM 钱包（用于监听和支付交易费用）
SVM_WALLET_PATH=/path/to/svm-wallet.json  # Solana Keypair，用于支付 gas
```

#### e2s 服务密钥

```bash
# Ed25519 密钥（用于签名提交到 SVM）
ED25519_PRIVATE_KEY=base58-encoded-key...  # 64 字节，用于 SVM 签名

# EVM 钱包（用于监听和支付交易费用）
EVM_PRIVATE_KEY=0xabcdef1234567890...  # 32 字节，用于支付 gas
```

**密钥存储建议**：
- 使用环境变量或密钥管理服务（AWS KMS、HashiCorp Vault）
- 生产环境禁止硬编码密钥
- 定期轮换密钥
- 使用不同的密钥对用于测试和生产环境

## HTTP API 接口

两个服务都暴露相同的 HTTP API，用于状态查询和监控。

### 基础接口

#### 1. 健康检查

```http
GET /health
```

**响应示例**：
```json
{
  "status": "healthy",
  "service": "s2e",
  "version": "1.0.0",
  "uptime": 3600,
  "timestamp": "2025-11-13T12:00:00Z"
}
```

**状态码**：
- `200 OK`：服务正常
- `503 Service Unavailable`：服务异常

#### 2. 运行状态

```http
GET /status
```

**响应示例**：
```json
{
  "service": "s2e",
  "listening": true,
  "sourceChain": {
    "name": "1024chain",
    "rpc": "https://testnet-rpc.1024chain.com/rpc/",
    "connected": true,
    "lastBlock": 1234567
  },
  "targetChain": {
    "name": "Arbitrum Sepolia",
    "rpc": "https://sepolia-rollup.arbitrum.io/rpc",
    "connected": true,
    "lastBlock": 7654321
  },
  "relayer": {
    "address": "0x1234...5678",
    "whitelisted": true,
    "balance": {
      "svm": 10.5,
      "evm": 0.5
    }
  }
}
```

#### 3. 任务队列状态

```http
GET /queue
```

**响应示例**：
```json
{
  "pending": 5,
  "processing": 2,
  "completed": 1234,
  "failed": 3,
  "tasks": [
    {
      "id": "task-001",
      "nonce": 100,
      "status": "pending",
      "createdAt": "2025-11-13T12:00:00Z",
      "retries": 0
    },
    {
      "id": "task-002",
      "nonce": 101,
      "status": "processing",
      "createdAt": "2025-11-13T12:01:00Z",
      "retries": 1
    }
  ]
}
```

#### 4. 当前 Nonce

```http
GET /nonce
```

**响应示例**：
```json
{
  "sourceChain": {
    "current": 105,
    "lastProcessed": 103
  },
  "targetChain": {
    "lastNonce": 103,
    "pending": [104, 105]
  }
}
```

#### 5. 任务详情

```http
GET /task/:id
```

**响应示例**：
```json
{
  "id": "task-001",
  "nonce": 100,
  "status": "completed",
  "eventData": {
    "sourceContract": "0xabc...def",
    "targetContract": "0x123...456",
    "amount": "100000000",
    "receiverAddress": "0x789...012",
    "blockHeight": 1234567
  },
  "signature": "0x1234567890abcdef...",
  "transactionHash": "0xfedcba0987654321...",
  "createdAt": "2025-11-13T12:00:00Z",
  "completedAt": "2025-11-13T12:00:30Z",
  "retries": 0,
  "logs": [
    {
      "timestamp": "2025-11-13T12:00:00Z",
      "level": "info",
      "message": "Event received"
    },
    {
      "timestamp": "2025-11-13T12:00:05Z",
      "level": "info",
      "message": "Signature generated"
    },
    {
      "timestamp": "2025-11-13T12:00:30Z",
      "level": "info",
      "message": "Transaction confirmed"
    }
  ]
}
```

#### 6. 性能指标

```http
GET /metrics
```

**响应示例**（Prometheus 格式）：
```
# HELP relayer_events_total Total number of events processed
# TYPE relayer_events_total counter
relayer_events_total{service="s2e",status="success"} 1234
relayer_events_total{service="s2e",status="failed"} 3

# HELP relayer_latency_seconds Event processing latency in seconds
# TYPE relayer_latency_seconds histogram
relayer_latency_seconds_bucket{service="s2e",le="1"} 100
relayer_latency_seconds_bucket{service="s2e",le="5"} 500
relayer_latency_seconds_bucket{service="s2e",le="10"} 800
relayer_latency_seconds_count{service="s2e"} 1234
relayer_latency_seconds_sum{service="s2e"} 4567.8

# HELP relayer_queue_size Current queue size
# TYPE relayer_queue_size gauge
relayer_queue_size{service="s2e",status="pending"} 5
relayer_queue_size{service="s2e",status="processing"} 2
```

#### 7. 配置信息（脱敏）

```http
GET /config
```

**响应示例**：
```json
{
  "service": "s2e",
  "sourceChain": {
    "name": "1024chain",
    "chainId": 91024,
    "rpc": "https://testnet-rpc.1024chain.com/rpc/",
    "contract": "abc...def"
  },
  "targetChain": {
    "name": "Arbitrum Sepolia",
    "chainId": 421614,
    "rpc": "https://sepolia-rollup.arbitrum.io/rpc",
    "contract": "0x123...456"
  },
  "relayer": {
    "address": "0x789...012"  // 脱敏，不显示私钥
  },
  "api": {
    "port": 8081,
    "cors": true
  }
}
```

### API 安全性

**认证方案**（可选）：
```bash
# 使用 API Key 认证
curl -H "X-API-Key: your-secret-key" http://localhost:8081/status
```

**限流配置**：
- 每个 IP 限制：100 请求/分钟
- 全局限制：1000 请求/分钟

**CORS 配置**：
```typescript
// 允许特定域名访问
const corsOptions = {
  origin: ['https://dashboard.1024chain.com'],
  methods: ['GET'],
  credentials: false
};
```

## 日志系统设计

### 日志框架

使用 **Winston** 或 **Pino** 等成熟的日志框架。

#### Winston 配置示例

```typescript
import winston from 'winston';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: process.env.SERVICE_NAME },
  transports: [
    // 控制台输出
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    // 文件输出（INFO 及以上）
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 10485760, // 10MB
      maxFiles: 5
    }),
    // 错误日志单独存储
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 10485760,
      maxFiles: 10
    })
  ]
});

export default logger;
```

### 日志级别和使用场景

| 级别 | 用途 | 示例 |
|-----|------|------|
| `debug` | 详细调试信息 | 事件原始数据、签名生成过程 |
| `info` | 正常流程信息 | 事件接收、交易提交、确认 |
| `warn` | 警告但不影响运行 | 重试、RPC 慢速响应、余额偏低 |
| `error` | 错误需要关注 | 交易失败、签名错误、RPC 连接失败 |

**使用示例**：

```typescript
// 事件处理流程
logger.info('Received stake event', {
  nonce: event.nonce,
  amount: event.amount,
  receiver: event.receiverAddress
});

logger.debug('Event data', { eventData: event });

// 交易提交
logger.info('Submitting signature', {
  nonce: event.nonce,
  txHash: tx.hash
});

// 重试警告
logger.warn('Transaction failed, retrying', {
  nonce: event.nonce,
  retry: attemptNumber,
  error: error.message
});

// 错误记录
logger.error('Transaction failed after max retries', {
  nonce: event.nonce,
  retries: MAX_RETRIES,
  error: error.stack
});
```

### 简单的日志告警

**余额告警**：

```typescript
if (balance < WARNING_THRESHOLD) {
  logger.warn('Low balance warning', {
    alert: true, // 标记为需要告警
    balance,
    threshold: WARNING_THRESHOLD
  });
  
  // 可选：发送到告警服务
  if (balance < CRITICAL_THRESHOLD) {
    await sendAlert({
      level: 'critical',
      message: `Critical: Balance ${balance} below ${CRITICAL_THRESHOLD}`
    });
  }
}
```

**失败率告警**：

```typescript
const failureRate = failedCount / totalCount;
if (failureRate > 0.1) { // 失败率 > 10%
  logger.error('High failure rate detected', {
    alert: true,
    failureRate: `${(failureRate * 100).toFixed(2)}%`,
    failedCount,
    totalCount
  });
}
```

**队列堆积告警**：

```typescript
const queueSize = await redis.llen('task_queue');
if (queueSize > 100) {
  logger.warn('Queue backlog detected', {
    alert: true,
    queueSize,
    threshold: 100
  });
}
```

### 日志聚合（可选）

生产环境建议使用日志聚合服务：
- **ELK Stack**（Elasticsearch + Logstash + Kibana）
- **Grafana Loki**
- **DataDog**
- **CloudWatch Logs**（AWS）

```typescript
// Winston 输出到 Elasticsearch
import { ElasticsearchTransport } from 'winston-elasticsearch';

logger.add(new ElasticsearchTransport({
  level: 'info',
  clientOpts: { node: 'http://localhost:9200' },
  index: 'relayer-logs'
}));
```

## 数据库设计

使用 PostgreSQL 存储任务状态和历史记录，Redis 作为任务队列。

### 表结构（PostgreSQL）

```sql
-- 任务表
CREATE TABLE tasks (
  id VARCHAR(64) PRIMARY KEY,
  service VARCHAR(10) NOT NULL,  -- 's2e' or 'e2s'
  nonce BIGINT NOT NULL,
  status VARCHAR(20) NOT NULL,   -- 'pending', 'processing', 'completed', 'failed'
  event_data JSONB NOT NULL,
  signature TEXT,
  transaction_hash TEXT,
  retries INT DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  INDEX idx_nonce (nonce),
  INDEX idx_status (status),
  INDEX idx_created_at (created_at)
);

-- 日志表
CREATE TABLE task_logs (
  id SERIAL PRIMARY KEY,
  task_id VARCHAR(64) REFERENCES tasks(id),
  timestamp TIMESTAMP DEFAULT NOW(),
  level VARCHAR(10),  -- 'info', 'warn', 'error'
  message TEXT,
  INDEX idx_task_id (task_id)
);

-- 性能指标表
CREATE TABLE metrics (
  id SERIAL PRIMARY KEY,
  service VARCHAR(10) NOT NULL,
  metric_name VARCHAR(50) NOT NULL,
  metric_value NUMERIC,
  timestamp TIMESTAMP DEFAULT NOW(),
  INDEX idx_service (service),
  INDEX idx_timestamp (timestamp)
);
```

### Redis 队列设计

```typescript
// 任务队列结构
interface TaskQueue {
  // 待处理队列（按 nonce 排序）
  'task_queue:pending': Task[];
  
  // 处理中队列（带超时机制）
  'task_queue:processing': Task[];
  
  // 失败队列（需要重试）
  'task_queue:failed': Task[];
  
  // 已处理的 nonce 集合（用于去重）
  'processed_nonces': Set<number>;
  
  // 分布式锁
  'lock:task:{nonce}': string; // 值为 lock ID
}

// 入队操作
async function enqueueTask(task: Task) {
  const lockKey = `lock:task:${task.nonce}`;
  const lock = await redis.set(lockKey, 'locked', 'NX', 'EX', 30);
  
  if (!lock) {
    logger.debug(`Task ${task.nonce} already in queue`);
    return;
  }
  
  await redis.lpush('task_queue:pending', JSON.stringify(task));
  logger.info(`Task ${task.nonce} enqueued`);
}

// 出队处理
async function processQueue() {
  while (true) {
    // 阻塞式获取任务（BRPOP，超时1秒）
    const result = await redis.brpop('task_queue:pending', 1);
    
    if (result) {
      const [, taskJson] = result;
      const task = JSON.parse(taskJson);
      
      try {
        await processTask(task);
        await redis.sadd('processed_nonces', task.nonce);
      } catch (error) {
        await handleTaskError(task, error);
      }
    }
  }
}
```

## 高性能异步任务处理实现

### Worker Pool 架构

```typescript
import { Worker } from 'worker_threads';
import { EventEmitter } from 'events';

class WorkerPool extends EventEmitter {
  private workers: Worker[] = [];
  private queue: Task[] = [];
  private activeWorkers: Set<Worker> = new Set();
  
  constructor(private poolSize: number = 5) {
    super();
    this.initWorkers();
  }
  
  private initWorkers() {
    for (let i = 0; i < this.poolSize; i++) {
      const worker = new Worker('./worker.js');
      
      worker.on('message', (result) => {
        this.activeWorkers.delete(worker);
        this.emit('taskComplete', result);
        this.processNext();
      });
      
      worker.on('error', (error) => {
        logger.error('Worker error', { error });
        this.activeWorkers.delete(worker);
        this.processNext();
      });
      
      this.workers.push(worker);
    }
  }
  
  async addTask(task: Task) {
    this.queue.push(task);
    this.processNext();
  }
  
  private processNext() {
    if (this.queue.length === 0) return;
    
    const availableWorker = this.workers.find(
      w => !this.activeWorkers.has(w)
    );
    
    if (availableWorker) {
      const task = this.queue.shift()!;
      this.activeWorkers.add(availableWorker);
      availableWorker.postMessage(task);
    }
  }
}

// 使用
const workerPool = new WorkerPool(5); // 5个并发 worker

workerPool.on('taskComplete', (result) => {
  logger.info('Task completed', result);
});

// 监听事件并加入队列
eventEmitter.on('StakeEvent', (event) => {
  workerPool.addTask(createTask(event));
});
```

### 服务启动流程

```typescript
async function main() {
  logger.info('Starting relayer service', { service: process.env.SERVICE_NAME });
  
  // 1. 检查余额
  logger.info('Checking account balances...');
  await checkBalances();
  
  // 2. 连接数据库
  logger.info('Connecting to database...');
  await db.connect();
  
  // 3. 连接 Redis
  logger.info('Connecting to Redis...');
  await redis.connect();
  
  // 4. 初始化 Worker Pool
  logger.info('Initializing worker pool...');
  const workerPool = new WorkerPool(5);
  
  // 5. 启动事件监听器
  logger.info('Starting event listener...');
  await startEventListener(workerPool);
  
  // 6. 启动 HTTP API
  logger.info('Starting HTTP API...');
  await startHttpServer();
  
  // 7. 启动余额监控
  logger.info('Starting balance monitor...');
  startBalanceMonitor();
  
  logger.info('Relayer service started successfully', {
    port: process.env.API_PORT
  });
}

main().catch((error) => {
  logger.error('Failed to start service', { error: error.stack });
  process.exit(1);
});
```

## 配置管理

### 环境变量示例（s2e）

```bash
# 服务配置
SERVICE_NAME=s2e
API_PORT=8081
LOG_LEVEL=info
WORKER_POOL_SIZE=5

# 源链配置（SVM）
SVM_RPC_URL=https://testnet-rpc.1024chain.com/rpc/
SVM_CONTRACT_ADDRESS=abc...def
SVM_CHAIN_ID=91024
SVM_WALLET_PATH=/path/to/svm-wallet.json

# 目标链配置（EVM）
EVM_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc
EVM_CONTRACT_ADDRESS=0x1234567890abcdef1234567890abcdef12345678
EVM_CHAIN_ID=421614
ECDSA_PRIVATE_KEY=0x1234567890abcdef...

# 数据库配置
DATABASE_URL=postgresql://user:password@localhost:5432/relayer
REDIS_URL=redis://localhost:6379

# 任务队列配置
QUEUE_MAX_SIZE=1000
QUEUE_RETRY_LIMIT=5
QUEUE_RETRY_DELAYS=0,30000,60000,120000,300000  # 0s,30s,1m,2m,5m

# Gas 费用配置
MIN_SVM_BALANCE=5.0  # SOL
MIN_EVM_BALANCE=0.1  # ETH
BALANCE_CHECK_INTERVAL=300000  # 5分钟

# 区块确认配置
EVM_CONFIRMATION_BLOCKS=12
SVM_COMMITMENT=finalized

# 监控配置
METRICS_ENABLED=true
METRICS_PORT=9090
```

### 环境变量示例（e2s）

```bash
# 服务配置
SERVICE_NAME=e2s
API_PORT=8082
LOG_LEVEL=info

# 源链配置（EVM）
EVM_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc
EVM_CONTRACT_ADDRESS=0x1234567890abcdef1234567890abcdef12345678
EVM_CHAIN_ID=421614
EVM_PRIVATE_KEY=0xabcdef1234567890...

# 目标链配置（SVM）
SVM_RPC_URL=https://testnet-rpc.1024chain.com/rpc/
SVM_CONTRACT_ADDRESS=abc...def
SVM_CHAIN_ID=91024
ED25519_PRIVATE_KEY=base58-encoded-key...

# 数据库配置
DATABASE_URL=postgresql://user:password@localhost:5432/relayer
REDIS_URL=redis://localhost:6379

# 任务队列配置
QUEUE_MAX_SIZE=1000
QUEUE_RETRY_LIMIT=5
QUEUE_RETRY_DELAYS=0,30000,60000,120000,300000

# Gas 费用配置
MIN_SVM_BALANCE=5.0
MIN_EVM_BALANCE=0.1
BALANCE_CHECK_INTERVAL=300000

# 区块确认配置
EVM_CONFIRMATION_BLOCKS=12
SVM_COMMITMENT=finalized

# 监控配置
METRICS_ENABLED=true
METRICS_PORT=9091
```

## 部署方案

### Docker 部署

```yaml
# docker-compose.yml
version: '3.8'

services:
  s2e-relayer:
    build: ./s2e
    container_name: s2e-relayer
    restart: unless-stopped
    ports:
      - "8081:8081"
      - "9090:9090"
    env_file:
      - ./s2e/.env
    volumes:
      - ./s2e/logs:/app/logs
      - ./s2e/keys:/app/keys:ro
    depends_on:
      - postgres
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8081/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  e2s-relayer:
    build: ./e2s
    container_name: e2s-relayer
    restart: unless-stopped
    ports:
      - "8082:8082"
      - "9091:9091"
    env_file:
      - ./e2s/.env
    volumes:
      - ./e2s/logs:/app/logs
      - ./e2s/keys:/app/keys:ro
    depends_on:
      - postgres
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8082/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  postgres:
    image: postgres:15-alpine
    container_name: relayer-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: relayer
      POSTGRES_USER: relayer
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    ports:
      - "5432:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data

  prometheus:
    image: prom/prometheus:latest
    container_name: relayer-prometheus
    restart: unless-stopped
    ports:
      - "9000:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus-data:/prometheus

  grafana:
    image: grafana/grafana:latest
    container_name: relayer-grafana
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_PASSWORD}
    volumes:
      - grafana-data:/var/lib/grafana

volumes:
  postgres-data:
  prometheus-data:
  grafana-data:
```

### Systemd 部署

```ini
# /etc/systemd/system/s2e-relayer.service
[Unit]
Description=S2E Relayer Service (SVM to EVM)
After=network.target

[Service]
Type=simple
User=relayer
WorkingDirectory=/opt/relayer/s2e
EnvironmentFile=/opt/relayer/s2e/.env
ExecStart=/usr/bin/node /opt/relayer/s2e/dist/main.js
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```ini
# /etc/systemd/system/e2s-relayer.service
[Unit]
Description=E2S Relayer Service (EVM to SVM)
After=network.target

[Service]
Type=simple
User=relayer
WorkingDirectory=/opt/relayer/e2s
EnvironmentFile=/opt/relayer/e2s/.env
ExecStart=/usr/bin/node /opt/relayer/e2s/dist/main.js
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

## 监控和告警

### Prometheus 指标

```yaml
# prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 's2e-relayer'
    static_configs:
      - targets: ['localhost:9090']
        labels:
          service: 's2e'

  - job_name: 'e2s-relayer'
    static_configs:
      - targets: ['localhost:9091']
        labels:
          service: 'e2s'
```

### 告警规则

```yaml
# alerts.yml
groups:
  - name: relayer_alerts
    interval: 30s
    rules:
      # 服务不可用
      - alert: RelayerDown
        expr: up{job=~".*-relayer"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Relayer service {{ $labels.service }} is down"

      # 任务队列堆积
      - alert: QueueBacklog
        expr: relayer_queue_size{status="pending"} > 50
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Relayer {{ $labels.service }} queue backlog > 50"

      # 失败率过高
      - alert: HighFailureRate
        expr: rate(relayer_events_total{status="failed"}[5m]) > 0.1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Relayer {{ $labels.service }} failure rate > 10%"

      # 延迟过高
      - alert: HighLatency
        expr: histogram_quantile(0.95, relayer_latency_seconds) > 300
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Relayer {{ $labels.service }} p95 latency > 5 minutes"
```

### Grafana 仪表盘

关键监控指标：
- 事件处理总数（成功/失败）
- 平均延迟、P95/P99 延迟
- 任务队列大小（pending/processing）
- Gas 消耗统计
- 钱包余额监控
- RPC 连接状态
- 重试次数统计

## 故障处理

### 常见问题

#### 1. RPC 连接失败

**症状**：`sourceChain.connected: false`

**解决方案**：
- 检查网络连接
- 验证 RPC URL 配置
- 检查防火墙规则
- 使用备用 RPC 节点

#### 2. 签名验证失败

**症状**：`Transaction reverted: Invalid signature`

**可能原因**：
- 密钥配置错误（混淆了 Ed25519 和 ECDSA）
- 事件数据序列化错误
- 哈希算法不匹配

**调试步骤**：
```bash
# 查看任务详情
curl http://localhost:8081/task/task-001

# 检查签名器配置
curl http://localhost:8081/config

# 查看日志
docker logs s2e-relayer
```

#### 3. Nonce 不匹配

**症状**：`Nonce must be greater than last nonce`

**解决方案**：
- 检查数据库中的 nonce 记录
- 与合约的 last_nonce 同步
- 确保没有重复处理同一个事件

#### 4. Gas 不足

**症状**：`Insufficient funds for gas`

**解决方案**：
- 检查钱包余额：`curl http://localhost:8081/status`
- 为钱包充值
- 设置告警阈值

## 安全最佳实践

### 1. 密钥管理

- ✅ 使用环境变量或密钥管理服务
- ✅ 定期轮换密钥
- ✅ 不同环境使用不同密钥
- ❌ 禁止将私钥提交到代码仓库
- ❌ 禁止在日志中打印私钥

### 2. 网络安全

- ✅ 使用 HTTPS 暴露 API
- ✅ 启用 API 认证
- ✅ 配置防火墙规则
- ✅ 启用 CORS 白名单
- ✅ 使用私有 RPC 节点

### 3. 运行时安全

- ✅ 最小权限原则
- ✅ 使用非 root 用户运行
- ✅ 定期更新依赖
- ✅ 启用安全审计日志
- ✅ 监控异常行为

### 4. 数据安全

- ✅ 加密敏感数据
- ✅ 定期备份数据库
- ✅ 脱敏 API 响应
- ✅ 限制日志保留时间

## 性能优化

### 1. 批量处理

```typescript
// 批量提交签名（如果合约支持）
const signatures = await Promise.all(
  events.map(event => generateSignature(event))
);
await contract.batchSubmitSignatures(signatures);
```

### 2. 连接池

```typescript
// RPC 连接池
const connectionPool = new ConnectionPool({
  maxConnections: 10,
  idleTimeout: 60000
});
```

### 3. 缓存

```typescript
// Redis 缓存已处理的 nonce
const processedNonces = await redis.sismember('processed_nonces', nonce);
if (processedNonces) {
  return; // 跳过已处理的事件
}
```

### 4. 并发控制

```typescript
// 限制并发数量
const queue = new PQueue({ concurrency: 5 });
events.forEach(event => {
  queue.add(() => processEvent(event));
});
```

## 核心需求总结

### ✅ 已集成的关键需求

1. **事件去重和幂等性**
   - 数据库 nonce 去重
   - Redis 分布式锁防止并发
   - 合约层 nonce 递增判断作为最后防线

2. **错误重试策略**
   - 指数退避算法（0s, 30s, 1m, 2m, 5m）
   - 错误分类（可重试 vs 不可重试）
   - 最大重试次数限制（5次）

3. **区块确认深度**
   - EVM: 12 个区块确认（约3分钟）
   - SVM: finalized commitment（32 slots，约13秒）
   - 可配置的确认深度

4. **Gas 费用管理**
   - 启动时强制检查余额充足
   - Gas 不足时记录 ERROR 日志并停止服务
   - 定时余额监控（每5分钟）
   - 余额告警（Warning 和 Critical 两级）

5. **日志系统**
   - 使用 Winston 成熟框架
   - 标准分级（debug, info, warn, error）
   - 结构化日志（JSON 格式）
   - 简单的告警功能（余额、失败率、队列堆积）

6. **高性能异步架构**
   - Producer-Consumer 模式
   - Redis 任务队列
   - Worker Pool 并发处理
   - 事件监听和处理解耦

## 开发指南

### 本地开发

```bash
# 启动依赖服务
docker-compose up -d postgres redis

# 安装依赖
cd s2e && npm install
cd ../e2s && npm install
cd ../shared && npm install

# 配置环境变量
cp s2e/.env.example s2e/.env
cp e2s/.env.example e2s/.env
# 编辑 .env 文件，填入配置

# 启动 s2e 服务
cd s2e
npm run dev

# 启动 e2s 服务（新终端）
cd e2s
npm run dev
```

### 测试

```bash
# 单元测试
npm run test

# 集成测试
npm run test:integration

# E2E 测试
npm run test:e2e
```

### 代码规范

- TypeScript 严格模式
- ESLint + Prettier
- Husky Git hooks
- Conventional Commits

## 技术栈

### 核心依赖

```json
{
  "dependencies": {
    // 区块链相关
    "@solana/web3.js": "^1.87.0",
    "@coral-xyz/anchor": "^0.29.0",
    "ethers": "^6.9.0",
    "@noble/ed25519": "^2.1.0",
    
    // 数据库和队列
    "pg": "^8.11.0",
    "ioredis": "^5.3.0",
    
    // 日志和监控
    "winston": "^3.11.0",
    "prom-client": "^15.1.0",
    
    // HTTP 服务
    "express": "^4.18.0",
    "cors": "^2.8.5",
    
    // 工具库
    "dotenv": "^16.3.0",
    "joi": "^17.11.0"
  }
}
```

## 路线图

### Phase 1: 核心功能（M4）✅ 设计完成
- [x] 架构设计
- [x] 需求整合
- [ ] s2e 服务实现
  - [ ] 事件监听器
  - [ ] ECDSA 签名器
  - [ ] EVM 交易提交
  - [ ] HTTP API
- [ ] e2s 服务实现
  - [ ] 事件监听器
  - [ ] Ed25519 签名器
  - [ ] SVM 交易提交
  - [ ] HTTP API
- [ ] 共享模块
  - [ ] 数据库操作
  - [ ] Redis 队列
  - [ ] 日志系统
  - [ ] Worker Pool
- [ ] 单元测试

### Phase 2: 生产就绪（M5）
- [ ] 集成测试
- [ ] E2E 测试
- [ ] Docker 部署
- [ ] 监控告警（Prometheus + Grafana）
- [ ] 文档完善
- [ ] 安全审计

### Phase 3: 优化增强（M6）
- [ ] 性能优化（批量处理、连接池）
- [ ] 高可用架构（主从切换）
- [ ] 自动化运维（健康检查、自动重启）
- [ ] 配置热更新
- [ ] 审计报告

## 相关文档

- [API 文档](../docs/api.md)
- [设计文档](../docs/design.md)
- [测试计划](../docs/testplan.md)
- [部署指南](./docs/deployment.md)
- [监控指南](./docs/monitoring.md)
- [故障排除](./docs/troubleshooting.md)

## 许可证

[待定]

## 联系方式

- 技术支持：[待定]
- 问题反馈：[待定]


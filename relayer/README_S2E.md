# S2E Relayer (SVM to EVM)

## 概述

S2E Relayer 是 Bridge1024 跨链桥的反向中继器，负责监听 SVM (Solana/1024chain) 链上的跨链事件，并将签名后的证明提交到 EVM (Arbitrum Sepolia) 链上。

## 架构

```
┌─────────────────┐       ┌──────────────────┐       ┌─────────────────┐
│                 │       │                  │       │                 │
│   SVM Chain     │──────▶│   S2E Relayer    │──────▶│   EVM Chain     │
│  (1024chain)    │ Events│                  │  Sigs │ (Arb Sepolia)   │
│                 │       │                  │       │                 │
└─────────────────┘       └──────────────────┘       └─────────────────┘
                                   │
                                   ▼
                           ┌──────────────┐
                           │   HTTP API   │
                           │   (port 8083)│
                           └──────────────┘
```

## 功能模块

### 1. **Listener** (`listener.rs`)
- 监听 SVM 链上的 `StakeEvent` 事件
- 使用 HTTP RPC API 查询交易
- 解析事件数据

### 2. **Signer** (`signer.rs`)
- 使用 ECDSA (secp256k1) 对事件数据生成签名
- 签名格式：EVM 兼容 (65字节: r + s + v)
- 哈希算法：JSON序列化 + SHA-256 + EIP-191

### 3. **Submitter** (`submitter.rs`)
- 将签名提交到 EVM 链上的 Bridge1024 合约
- 调用 `submitSignature` 函数
- 处理交易确认

### 4. **API** (`api.rs`)
- HTTP REST API 服务器
- 端口：8083
- 端点：
  - `GET /health` - 健康检查
  - `GET /status` - Relayer 状态
  - `GET /metrics` - 性能指标

## 密码学标准

### SVM → EVM 跨链

1. **事件数据序列化**：JSON 格式
2. **哈希算法**：SHA-256
3. **签名算法**：ECDSA (secp256k1)
4. **签名格式**：EIP-191 + recoverable (65 bytes)

### 签名流程

```rust
// 1. 序列化事件数据为 JSON
let json = serialize_event_to_json(event);

// 2. 计算 SHA-256 哈希
let hash = SHA256(json);

// 3. 应用 EIP-191 前缀
let eth_hash = Keccak256("\x19Ethereum Signed Message:\n32" + hash);

// 4. ECDSA 签名
let signature = sign_ecdsa_recoverable(eth_hash, private_key);

// 5. 返回 65 字节签名 (r + s + v)
```

## 配置

通过环境变量配置（支持 `.env` 文件）：

```bash
# 服务配置
SERVICE__NAME=s2e
SERVICE__VERSION=0.1.0

# SVM 源链（1024chain）
SOURCE_CHAIN__NAME=1024chain
SOURCE_CHAIN__CHAIN_ID=91024
SOURCE_CHAIN__RPC_URL=https://testnet-rpc.1024chain.com/rpc/
SOURCE_CHAIN__CONTRACT_ADDRESS=<SVM程序ID>

# EVM 目标链（Arbitrum Sepolia）
TARGET_CHAIN__NAME="Arbitrum Sepolia"
TARGET_CHAIN__CHAIN_ID=421614
TARGET_CHAIN__RPC_URL=https://sepolia-rollup.arbitrum.io/rpc
TARGET_CHAIN__CONTRACT_ADDRESS=<EVM合约地址>

# Relayer 配置
RELAYER__ECDSA_PRIVATE_KEY=<ECDSA私钥>

# API 配置
API__HOST=0.0.0.0
API__PORT=8083

# 日志配置
LOGGING__LEVEL=info
LOGGING__FORMAT=json
```

## 编译和运行

### 编译

```bash
cd relayer/s2e
cargo build --release
```

### 运行

```bash
# 设置环境变量或使用 .env 文件
export SOURCE_CHAIN__RPC_URL="https://testnet-rpc.1024chain.com/rpc/"
export TARGET_CHAIN__RPC_URL="https://sepolia-rollup.arbitrum.io/rpc"
# ... 其他配置 ...

# 运行 relayer
./target/release/s2e-relayer
```

## 测试

使用提供的测试脚本测试 S2E 跨链流程：

```bash
cd scripts
ts-node cross-chain-test-s2e.ts
```

测试脚本会：
1. 在 SVM 链上质押 USDC
2. 等待 relayer 处理
3. 验证 EVM 链上的余额变化

## 当前状态

### ✅ 已实现
- [x] 基础架构和配置管理
- [x] ECDSA 签名器 (EVM 兼容)
- [x] EVM 提交器（submitSignature）
- [x] HTTP API 服务器
- [x] 编译成功

### 🚧 部分实现
- [ ] SVM 事件监听器（框架已就绪，需要完整实现）
- [ ] 事件解析和处理逻辑

### 📋 待实现
- [ ] 完整的 SVM RPC 轮询逻辑
- [ ] 事件数据解析（从 Anchor 日志）
- [ ] Nonce 跟踪和去重
- [ ] 错误处理和重试机制
- [ ] 性能指标收集

## 依赖

主要依赖：
- **ethers** (2.0.14): EVM 交互
- **secp256k1** (0.28): ECDSA 签名
- **tokio**: 异步运行时
- **axum**: HTTP 服务器
- **reqwest**: HTTP 客户端（用于 SVM RPC）

## 与 E2S Relayer 的差异

| 特性 | E2S (EVM→SVM) | S2E (SVM→EVM) |
|------|--------------|--------------|
| 源链 | Arbitrum Sepolia | 1024chain |
| 目标链 | 1024chain | Arbitrum Sepolia |
| 签名算法 | Ed25519 | ECDSA (secp256k1) |
| 事件监听 | ethers event filter | HTTP RPC 轮询 |
| 签名提交 | Solana transaction | EVM transaction |
| 端口 | 8082 | 8083 |

## 故障排查

### Relayer 无法启动
- 检查环境变量是否正确配置
- 确保 RPC URLs 可访问
- 验证私钥格式正确

### 无法监听事件
- 检查 SVM RPC 连接
- 验证程序 ID 正确
- 查看日志获取详细错误信息

### 签名提交失败
- 检查 EVM RPC 连接
- 确保 relayer 地址有足够的 gas
- 验证合约地址正确
- 确认 relayer 已在合约中注册为白名单

## 许可证

MIT


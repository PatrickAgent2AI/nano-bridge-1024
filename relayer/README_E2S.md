# E2S Relayer 架构说明

## 概述

E2S (EVM to SVM) Relayer 采用**分离式架构**，分为两个独立的服务：

```
┌─────────────────┐      ┌──────────────┐      ┌─────────────────┐
│  EVM Chain      │──────│  e2s-listener │──────│   Event Queue   │
│  (Arbitrum)     │      │   (监听器)    │      │  (文件系统)     │
└─────────────────┘      └──────────────┘      └─────────────────┘
                                                        │
                                                        ▼
                                                 ┌──────────────┐
                                                 │e2s-submitter │
                                                 │  (提交器)    │
                                                 └──────────────┘
                                                        │
                                                        ▼
                                                 ┌─────────────────┐
                                                 │   SVM Chain     │
                                                 │  (1024chain)    │
                                                 └─────────────────┘
```

## 为什么采用分离架构？

**问题**：Rust 依赖冲突
- `ethers` (EVM 库) 和 `solana-sdk` (SVM 库) 有不可调和的依赖冲突
- 它们依赖不同版本的加密库 (`curve25519-dalek`, `zeroize`)

**解决方案**：分离为两个独立的二进制文件
- ✅ 避免依赖冲突
- ✅ 可以独立扩展和部署
- ✅ 更清晰的职责分离
- ✅ 更容易维护和测试

## 服务架构

### 1. e2s-listener (EVM 事件监听器)

**职责**：
- 监听 EVM 链上的 `StakeEvent` 事件
- 解析事件数据
- 保存到事件队列（文件系统）

**依赖**：
- `ethers` - EVM 交互
- `shared` - 共享类型

**位置**：`relayer/e2s-listener/`

### 2. e2s-submitter (SVM 交易提交器)

**职责**：
- 从事件队列读取事件
- 使用 Ed25519 签名事件数据
- 提交签名到 SVM 链
- 提供 HTTP API (状态查询)

**依赖**：
- `solana-sdk` - SVM 交互
- `shared` - 共享类型

**位置**：`relayer/e2s-submitter/`

## 密钥管理

E2S Relayer **只需要一个 Ed25519 密钥对**：

- **用途1**：签名事件数据（Ed25519 签名）
- **用途2**：签署 SVM 交易（交易签名者）
- **用途3**：支付 SVM 交易 gas 费

**不需要 EVM 私钥**，因为 relayer 只监听 EVM 事件，不在 EVM 上执行任何操作。

## 注册流程

### 使用脚本注册

```bash
# 运行注册脚本
cd /workspace/newlife2/scripts
./04-register-relayer.sh
```

脚本会：
1. 生成 Ed25519 密钥对
2. 注册到 SVM 链的 relayer 白名单
3. 生成配置文件 `.relayer/e2s-relayer.env`

### 手动注册

如果脚本失败，手动执行：

```bash
# 1. 生成密钥对
solana-keygen new --outfile .relayer/e2s-relayer-keypair.json

# 2. 获取公钥
RELAYER_PUBKEY=$(solana-keygen pubkey .relayer/e2s-relayer-keypair.json)

# 3. 注册到 SVM
cd scripts
npx ts-node svm-admin.ts add_relayer $RELAYER_PUBKEY
```

## 运行 Relayer

### 方式1：使用配置文件

```bash
# 1. 加载配置
export $(cat .relayer/e2s-relayer.env | xargs)

# 2. 启动 listener
cd relayer/e2s-listener
cargo run --release &

# 3. 启动 submitter (包含 API 服务)
cd relayer/e2s-submitter
cargo run --release
```

### 方式2：使用环境变量

```bash
# 设置必要的环境变量
export SOURCE_CHAIN__RPC_URL=https://sepolia-rollup.arbitrum.io/rpc
export SOURCE_CHAIN__CONTRACT_ADDRESS=0x...
export TARGET_CHAIN__RPC_URL=https://testnet-rpc.1024chain.com/rpc/
export TARGET_CHAIN__CONTRACT_ADDRESS=...
export RELAYER__ED25519_PRIVATE_KEY=...

# 启动服务
cargo run --release
```

## API 接口

e2s-submitter 提供 HTTP API（默认端口 8082）：

### 健康检查
```bash
curl http://localhost:8082/health
```

### 状态查询
```bash
curl http://localhost:8082/status
```

响应示例：
```json
{
  "service": "e2s-submitter",
  "listening": true,
  "source_chain": {
    "name": "Arbitrum Sepolia",
    "connected": true
  },
  "target_chain": {
    "name": "1024chain",
    "connected": true
  },
  "relayer": {
    "whitelisted": true
  }
}
```

## 事件队列

事件通过文件系统队列传递：

- **位置**：`.relayer/queue/`
- **格式**：`event_{nonce}.json`
- **处理**：FIFO，处理后自动删除

### 队列文件示例

```json
{
  "source_contract": "0x...",
  "target_contract": "...",
  "source_chain_id": 421614,
  "target_chain_id": 91024,
  "block_height": 12345,
  "amount": 1000000,
  "receiver_address": "...",
  "nonce": 1
}
```

## 监控和调试

### 查看日志

```bash
# Listener 日志
cd relayer/e2s-listener
RUST_LOG=info cargo run

# Submitter 日志
cd relayer/e2s-submitter
RUST_LOG=info cargo run
```

### 查看队列

```bash
# 查看待处理事件
ls -lh .relayer/queue/
```

### 测试 relayer

```bash
# 运行测试脚本
cd scripts
npx ts-node cross-chain-test.ts
```

## 故障排查

### Listener 无法连接 EVM
- 检查 `SOURCE_CHAIN__RPC_URL`
- 检查网络连接
- 检查合约地址是否正确

### Submitter 无法提交交易
- 检查 relayer 是否已注册：`npx ts-node svm-admin.ts query_relayers`
- 检查 relayer 余额：`solana balance <pubkey>`
- 检查私钥配置是否正确

### 事件未被处理
- 检查 `.relayer/queue/` 目录中的文件
- 查看 submitter 日志
- 检查 SVM RPC 连接状态

## 升级和维护

### 重新编译

```bash
cd relayer/e2s-listener && cargo build --release
cd relayer/e2s-submitter && cargo build --release
```

### 清理队列

```bash
# 慎用：删除所有待处理事件
rm -f .relayer/queue/*.json
```

## 性能优化

- **Listener**：调整轮询间隔（默认 5秒）
- **Submitter**：调整处理间隔（默认 2秒）
- **并发**：可以运行多个 submitter 实例（使用不同的 relayer 密钥）

## 安全注意事项

1. **保护私钥**：`ed25519_private_key` 必须保密
2. **文件权限**：确保配置文件只有所有者可读
3. **网络隔离**：生产环境建议使用私有 RPC 端点
4. **监控余额**：定期检查 relayer 账户余额

## 架构优势

✅ **无依赖冲突**：每个服务使用独立的依赖
✅ **可独立扩展**：可以运行多个 listener 或 submitter
✅ **故障隔离**：一个服务崩溃不影响另一个
✅ **易于维护**：清晰的职责分离
✅ **灵活部署**：可以部署在不同的机器上


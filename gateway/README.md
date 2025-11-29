# EVM Gateway Service

## 概述

EVM Gateway Service 是一个 Rust 实现的 HTTP 服务，用于完成跨链桥的第二步：从 Arbitrum 到 1024chain。

**工作流程：**
1. 用户使用成熟的跨链桥（如 LiFi）将资产从任意链跨链到 Arbitrum，USDC 转入中转钱包地址
2. 本服务接收 HTTP 请求（参数：USDC 金额、目标地址）
3. 服务使用中转钱包调用 EVM stake 合约接口，完成第二步跨链到 1024chain

## 架构说明

本服务与 `relayer` 完全独立，没有任何交集：
- **relayer**: 负责监听链上事件、签名验证、多签提交（双向跨链）
- **evm-gateway**: 负责接收外部 HTTP 请求，使用中转钱包调用 EVM stake 接口（单向：Arbitrum → 1024chain）

## 功能特性

- ✅ HTTP API 接收跨链请求（参数：USDC 金额、目标地址）
- ✅ 使用中转钱包调用 EVM stake 合约接口
- ✅ 自动检查 USDC 余额
- ✅ 自动处理 USDC 授权（approve）
- ✅ 返回交易哈希

## 快速开始

### 前置条件

- Rust 1.70+
- Arbitrum RPC 节点访问权限
- 中转钱包的私钥（hex 格式）
- 中转钱包需要有足够的 ETH（用于支付 gas）和 USDC（用于跨链）

### 配置

1. 复制示例配置文件：
```bash
cd evm-gateway-service
cp .env.example .env
```

2. 编辑 `.env` 文件：
```bash
# Arbitrum RPC 地址
RPC_URL=https://sepolia-rollup.arbitrum.io/rpc

# 中转钱包私钥（hex 格式，带或不带 0x 前缀）
PRIVATE_KEY=your_private_key_hex_here

# Bridge 合约地址
BRIDGE_CONTRACT_ADDRESS=0x...

# USDC 合约地址
USDC_CONTRACT_ADDRESS=0x...

# 链 ID（默认 Arbitrum Sepolia: 421614）
CHAIN_ID=421614

# HTTP 服务端口（默认 8084）
PORT=8084
```

### 运行

```bash
cd evm-gateway-service
cargo run --release
```

服务将在 `http://0.0.0.0:8080` 启动。

**日志级别配置：**
- 默认日志级别：`info`
- 查看详细调试信息：`RUST_LOG=debug cargo run --release`
- 查看所有日志：`RUST_LOG=trace cargo run --release`
- 只查看错误：`RUST_LOG=error cargo run --release`

## 使用 CLI 工具

项目提供了 CLI 工具 `gateway-cli.sh` 来方便地调用 gateway 服务：

### 查看帮助

```bash
./gateway-cli.sh help
```

### 质押 USDC

```bash
# 质押 1 USDC (1000000 最小单位) 到 1024chain
./gateway-cli.sh stake 1000000 "1024chain_receiver_address"

# 使用自定义服务地址
GATEWAY_URL=http://localhost:8084 ./gateway-cli.sh stake 1000000 "address"
```

CLI 工具会：
- 显示请求的详细信息（URL、端点、请求体）
- 执行请求并显示响应
- 格式化 JSON 响应（如果安装了 jq）
- 显示成功/失败状态和交易哈希

## API 文档

### POST /stake

调用 EVM stake 合约接口，完成从 Arbitrum 到 1024chain 的跨链。

**请求体：**
```json
{
  "amount": "1000000",
  "target_address": "1024chain接收地址"
}
```

**参数说明：**
- `amount`: USDC 金额（字符串格式，最小单位，例如 "1000000" = 1 USDC，假设 6 位小数）
- `target_address`: 1024chain 上的接收地址（字符串格式）

**响应示例：**
```json
{
  "success": true,
  "message": "Stake successful",
  "tx_hash": "0x..."
}
```

**错误响应：**
```json
{
  "success": false,
  "message": "错误信息",
  "tx_hash": null
}
```

**示例请求：**
```bash
curl -X POST http://localhost:8080/stake \
  -H "Content-Type: application/json" \
  -d '{
    "amount": "1000000",
    "target_address": "1024chain接收地址"
  }'
```

## 项目结构

```
evm-gateway/
├── README.md                    # 本文件
├── evm-gateway-service/         # 主服务
│   ├── src/
│   │   └── main.rs              # 服务入口
│   ├── Cargo.toml               # 依赖配置
│   └── .env.example             # 配置示例
```

## 注意事项

1. **中转钱包资金**：确保中转钱包有足够的 ETH（用于支付 gas）和 USDC（用于跨链）
2. **密钥安全**：妥善保管 `PRIVATE_KEY`，不要泄露
3. **网络配置**：确保 RPC_URL 可访问且稳定
4. **合约配置**：确保 BRIDGE_CONTRACT_ADDRESS 和 USDC_CONTRACT_ADDRESS 配置正确
5. **Gas 费用**：中转钱包需要有足够的 ETH 支付交易 gas 费用

## 相关文档

- [主项目 README](../README.md)
- [Relayer 文档](../relayer/README.md)
- [API 文档](../docs/api.md)


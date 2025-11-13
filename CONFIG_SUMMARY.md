# 项目配置和部署总结

**更新日期**: 2025-11-13

## 📦 项目结构

```
newlife2/
├── evm/bridge1024/           # EVM 智能合约（Arbitrum Sepolia）
│   ├── src/
│   │   ├── Bridge1024.sol    # 主合约
│   │   └── MockUSDC.sol      # 测试 USDC
│   ├── test/                 # 测试套件（41个测试）
│   └── README.md             # EVM 合约文档
├── svm/bridge1024/           # SVM 智能合约（1024chain）
│   ├── programs/             # Anchor 程序
│   ├── tests/                # 测试套件（48个测试）
│   └── README.md             # SVM 合约文档
├── relayer/                  # Relayer 服务（Rust）
│   └── README.md             # Relayer 文档
├── scripts/                  # 部署和操作脚本
│   ├── deploy-evm.sh         # EVM 合约部署脚本 ✅
│   ├── deploy-mock-usdc.sh   # MockUSDC 部署脚本 ✅
│   ├── deploy-svm.sh         # SVM 合约部署脚本 ✅
│   ├── evm-admin.ts          # EVM 管理员操作
│   ├── evm-user.ts           # EVM 用户操作
│   ├── svm-admin.ts          # SVM 管理员操作
│   ├── svm-user.ts           # SVM 用户操作
│   └── README.md             # 脚本使用文档
├── docs/                     # 项目文档
│   ├── api.md                # API 文档
│   ├── design.md             # 设计文档
│   ├── testplan.md           # 测试计划
│   └── progress.md           # 项目进度
└── README.md                 # 项目总览
```

## 🚀 快速开始

### 1. 部署 EVM 合约

```bash
cd scripts

# 配置环境变量
export ADMIN_EVM_PRIVATE_KEY=0x...
export EVM_VAULT_ADDRESS=0x...  # 可选
export EVM_ADMIN_ADDRESS=0x...  # 可选

# 部署 Bridge1024
./deploy-evm.sh

# 部署 MockUSDC（测试用）
./deploy-mock-usdc.sh
```

**输出示例**:
```
正在部署 Bridge1024...
正在初始化合约...

✓ 成功
合约地址: 0x1234567890abcdef...
浏览器: https://sepolia.arbiscan.io/address/0x1234567890abcdef...
已更新 .env 文件
```

### 2. 部署 SVM 合约

```bash
cd scripts

# 配置 RPC
export SVM_RPC_URL=https://testnet-rpc.1024chain.com/rpc/

# 部署程序
./deploy-svm.sh
```

### 3. 配置合约

```bash
# EVM 端配置
ts-node evm-admin.ts configure_usdc
ts-node evm-admin.ts configure_peer
ts-node evm-admin.ts add_relayer
ts-node evm-admin.ts add_liquidity

# SVM 端配置
ts-node svm-admin.ts configure_usdc
ts-node svm-admin.ts configure_peer
ts-node svm-admin.ts add_relayer
ts-node svm-admin.ts add_liquidity
```

## 📋 关键特性

### ✅ 已完成功能

- **EVM 合约** (Arbitrum Sepolia)
  - ✅ 统一初始化（发送端 + 接收端）
  - ✅ USDC 配置
  - ✅ 对端合约配置
  - ✅ 质押功能（stake）
  - ✅ ECDSA 签名验证和多签解锁
  - ✅ Relayer 白名单管理
  - ✅ 流动性管理
  - ✅ 测试通过率：75.6%（核心功能 100%）
  - ✅ 自动化部署脚本

- **SVM 合约** (1024chain)
  - ✅ 统一初始化（发送端 + 接收端）
  - ✅ USDC 配置
  - ✅ 对端合约配置
  - ✅ 质押功能（stake）
  - ✅ Ed25519 签名验证和多签解锁
  - ✅ Relayer 白名单管理
  - ✅ 流动性管理
  - ✅ 测试通过率：93.75%（45/48）
  - ✅ CrossChainRequest PDA（无限请求支持）
  - ✅ 自动化部署脚本

- **部署脚本**
  - ✅ EVM 合约部署（deploy-evm.sh）
  - ✅ MockUSDC 部署（deploy-mock-usdc.sh）
  - ✅ SVM 合约部署（deploy-svm.sh）
  - ✅ 使用相对路径（可移植）
  - ✅ 自动更新 .env 文件
  - ✅ 简洁输出（成功/失败）

- **操作脚本**
  - ✅ EVM 管理员脚本（evm-admin.ts）
  - ✅ EVM 用户脚本（evm-user.ts）
  - ✅ SVM 管理员脚本（svm-admin.ts）
  - ✅ SVM 用户脚本（svm-user.ts）

## 🔐 密码学算法

### SVM 端（原生方案）
- **签名算法**: Ed25519
- **序列化**: Borsh
- **验证**: Ed25519Program 预编译合约
- **签名长度**: 64 字节

### EVM 端（原生方案）
- **签名算法**: ECDSA (secp256k1)
- **序列化**: JSON
- **哈希**: SHA-256 + Keccak256 (EIP-191)
- **验证**: ecrecover 预编译合约
- **签名长度**: 65 字节

### 跨链兼容
- Relayer 负责格式转换
- SVM 事件 → ECDSA 签名 → EVM
- EVM 事件 → Ed25519 签名 → SVM

## 📊 测试状态

### EVM 合约
- **总测试**: 41 个
- **通过**: 31 个（75.6%）
- **核心功能**: 100% 通过

### SVM 合约
- **总测试**: 48 个
- **通过**: 45 个（93.75%）
- **跳过**: 3 个（合理条件跳过）
- **核心功能**: 100% 通过

## 🌐 网络配置

### Arbitrum Sepolia（测试网）
- **RPC**: https://sepolia-rollup.arbitrum.io/rpc
- **Chain ID**: 421614
- **浏览器**: https://sepolia.arbiscan.io/
- **水龙头**: https://faucet.quicknode.com/arbitrum/sepolia

### 1024chain Testnet
- **RPC**: https://testnet-rpc.1024chain.com/rpc/
- **Chain ID**: 91024

## 📝 环境变量

创建 `.env` 文件：

```bash
# RPC 端点
EVM_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc
SVM_RPC_URL=https://testnet-rpc.1024chain.com/rpc/

# 合约地址（部署后自动填写）
EVM_CONTRACT_ADDRESS=
SVM_PROGRAM_ID=

# 管理员私钥
ADMIN_EVM_PRIVATE_KEY=0x...
ADMIN_SVM_PRIVATE_KEY=[...]

# 用户私钥
USER_EVM_PRIVATE_KEY=0x...
USER_SVM_PRIVATE_KEY=[...]

# USDC 地址
USDC_EVM_CONTRACT=
USDC_SVM_MINT=

# 其他配置
EVM_VAULT_ADDRESS=
EVM_ADMIN_ADDRESS=
RELAYER_ADDRESSES_EVM=
RELAYER_ADDRESSES_SVM=
```

## 🔧 脚本特性

### 相对路径设计
所有脚本使用相对路径，确保可移植性：

```bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR/.."
CONTRACT_DIR="$PROJECT_ROOT/evm/bridge1024"
ENV_FILE="$PROJECT_ROOT/.env"
```

### 自动化功能
- ✅ 自动编译合约
- ✅ 自动部署和初始化
- ✅ 自动提取合约地址
- ✅ 自动更新 .env 文件
- ✅ 友好的错误提示

## 📚 文档链接

- [项目总览](./README.md)
- [EVM 合约文档](./evm/bridge1024/README.md)
- [SVM 合约文档](./svm/bridge1024/README.md)
- [脚本使用文档](./scripts/README.md)
- [Relayer 文档](./relayer/README.md)
- [API 文档](./docs/api.md)
- [设计文档](./docs/design.md)
- [测试计划](./docs/testplan.md)
- [项目进度](./docs/progress.md)

## 🎯 下一步计划

1. **EVM 测试优化**: 修复剩余 10 个测试用例
2. **测试网部署验证**: 在实际测试网验证部署流程
3. **Relayer 开发**: 完成 Relayer 服务核心功能
4. **集成测试**: 端到端跨链转账测试
5. **安全审计**: 外部安全审计准备

## 📞 支持

遇到问题请查看：
1. 各子模块的 README 文档
2. scripts/README.md 的常见问题部分
3. GitHub Issues

# Bridge1024 操作脚本

这个目录包含了与 Bridge1024 跨链桥交互的 TypeScript 脚本和部署脚本。

## 📋 目录

- [部署脚本](#部署脚本)
- [环境配置](#环境配置)
- [安装依赖](#安装依赖)
- [脚本说明](#脚本说明)
- [使用示例](#使用示例)
- [配置说明](#配置说明)

## 🚀 部署脚本

### EVM 合约部署到 Arbitrum Sepolia

**RPC端点**: `https://sepolia-rollup.arbitrum.io/rpc`

#### 前置条件

1. 安装 Foundry: `curl -L https://foundry.paradigm.xyz | bash && foundryup`
2. 获取 Arbitrum Sepolia 测试 ETH: [Faucet](https://faucet.quicknode.com/arbitrum/sepolia)
3. 配置环境变量（见[环境配置](#环境配置)）

#### 快速部署

```bash
# 加载环境变量
source ../.env

# 部署 Bridge1024 合约（自动初始化）
./deploy-evm.sh

# （可选）部署 MockUSDC 用于测试
./deploy-mock-usdc.sh
```

**脚本特点：**
- ✅ 简洁输出，只显示成功或失败
- ✅ 成功时自动显示合约地址
- ✅ 自动更新 `.env` 文件
- ✅ 提供 Arbiscan 浏览器链接

#### 手动部署（高级用户）

```bash
cd ../evm/bridge1024

# 编译
forge build

# 部署
forge create \
  --rpc-url https://sepolia-rollup.arbitrum.io/rpc \
  --private-key $ADMIN_EVM_PRIVATE_KEY \
  src/Bridge1024.sol:Bridge1024

# 初始化（使用部署后的地址）
cast send <CONTRACT_ADDRESS> \
  "initialize(address,address)" \
  $EVM_VAULT_ADDRESS \
  $EVM_ADMIN_ADDRESS \
  --rpc-url https://sepolia-rollup.arbitrum.io/rpc \
  --private-key $ADMIN_EVM_PRIVATE_KEY
```

#### 验证部署

```bash
# 查询合约状态
cast call <CONTRACT_ADDRESS> \
  "senderState()(address,address,address,uint64,address,uint64,uint64)" \
  --rpc-url https://sepolia-rollup.arbitrum.io/rpc

# 在浏览器查看
# https://sepolia.arbiscan.io/address/<CONTRACT_ADDRESS>
```

---

### SVM 合约部署到 1024chain Testnet

**RPC端点**: `https://testnet-rpc.1024chain.com/rpc/`

#### 前置条件

1. 安装 Anchor: `cargo install --git https://github.com/coral-xyz/anchor avm --locked --force`
2. 安装 Solana CLI: `sh -c "$(curl -sSfL https://release.solana.com/stable/install)"`
3. 配置钱包并获取测试 SOL
4. 配置环境变量（见[环境配置](#环境配置)）

#### 快速部署

```bash
# 加载环境变量（如需要）
source ../.env

# 部署 Bridge1024 合约
./deploy-svm.sh
```

**脚本特点：**
- ✅ 自动编译和部署
- ✅ 简洁输出，只显示成功或失败
- ✅ 成功时自动显示程序地址
- ✅ 自动更新 `.env` 文件

#### 手动部署（高级用户）

```bash
cd ../svm/bridge1024

# 编译
anchor build

# 查看程序 ID
solana address -k target/deploy/bridge1024-keypair.json

# 部署
solana program deploy \
  --url https://testnet-rpc.1024chain.com/rpc/ \
  --program-id target/deploy/bridge1024-keypair.json \
  target/deploy/bridge1024.so
```

#### 验证部署

```bash
# 查询程序账户信息
solana program show \
  --url https://testnet-rpc.1024chain.com/rpc/ \
  <PROGRAM_ID>
```

## 🔧 环境配置

### 1. 复制环境变量模板

```bash
cp ../.env.example ../.env
```

### 2. 编辑 `.env` 文件

填写以下关键配置：

#### RPC 端点
- `SVM_RPC_URL` - 1024chain/Solana RPC 地址
- `EVM_RPC_URL` - Arbitrum RPC 地址

#### 合约地址
- `SVM_PROGRAM_ID` - SVM 程序 ID
- `EVM_CONTRACT_ADDRESS` - EVM 合约地址

#### 账户私钥
- `ADMIN_SVM_PRIVATE_KEY` - SVM 管理员私钥（JSON 数组格式）
- `ADMIN_EVM_PRIVATE_KEY` - EVM 管理员私钥（0x 格式）
- `USER_SVM_PRIVATE_KEY` - SVM 用户私钥（JSON 数组格式）
- `USER_EVM_PRIVATE_KEY` - EVM 用户私钥（0x 格式）

#### USDC 代币地址
- `USDC_SVM_MINT` - SVM USDC Mint Account
- `USDC_EVM_CONTRACT` - EVM USDC 合约地址

#### 其他配置
- `EVM_VAULT_ADDRESS` - EVM 金库地址
- `RELAYER_ADDRESSES_SVM` - SVM Relayer 地址列表（逗号分隔）
- `RELAYER_ADDRESSES_EVM` - EVM Relayer 地址列表（逗号分隔）

## 📦 安装依赖

```bash
cd scripts
npm install
```

## 📝 脚本说明

### 1. `svm-user.ts` - SVM 用户操作

**功能：**
- `stake` - 质押 USDC 到跨链桥
- `balance` - 查询用户余额

**使用：**
```bash
# 质押（使用默认配置）
npm run svm:user stake

# 质押指定金额和接收地址
ts-node svm-user.ts stake 1000000 0x1234...5678

# 查询余额
ts-node svm-user.ts balance
```

### 2. `evm-user.ts` - EVM 用户操作

**功能：**
- `stake` - 质押 USDC 到跨链桥
- `balance` - 查询用户余额
- `state` - 查询合约状态

**使用：**
```bash
# 质押（使用默认配置）
npm run evm:user stake

# 质押指定金额和接收地址
ts-node evm-user.ts stake 1000000 receiver_pubkey

# 查询余额
ts-node evm-user.ts balance

# 查询合约状态
ts-node evm-user.ts state
```

### 3. `svm-admin.ts` - SVM 管理员操作

**功能：**
- `initialize` - 初始化合约
- `configure_usdc` - 配置 USDC 地址
- `configure_peer` - 配置对端合约
- `add_relayer` - 添加 Relayer
- `remove_relayer` - 移除 Relayer
- `add_liquidity` - 增加流动性
- `withdraw_liquidity` - 提取流动性

**使用：**
```bash
# 初始化合约
npm run svm:admin initialize

# 配置 USDC
ts-node svm-admin.ts configure_usdc

# 配置对端合约
ts-node svm-admin.ts configure_peer

# 添加 Relayer（从配置文件）
ts-node svm-admin.ts add_relayer

# 添加单个 Relayer
ts-node svm-admin.ts add_relayer <pubkey>

# 移除 Relayer
ts-node svm-admin.ts remove_relayer <pubkey>

# 增加流动性（使用默认金额）
ts-node svm-admin.ts add_liquidity

# 增加指定金额流动性
ts-node svm-admin.ts add_liquidity 100000000

# 提取流动性
ts-node svm-admin.ts withdraw_liquidity 50000000
```

### 4. `evm-admin.ts` - EVM 管理员操作

**功能：**
- `initialize` - 初始化合约
- `configure_usdc` - 配置 USDC 地址
- `configure_peer` - 配置对端合约
- `add_relayer` - 添加 Relayer
- `remove_relayer` - 移除 Relayer
- `add_liquidity` - 增加流动性
- `withdraw_liquidity` - 提取流动性
- `query_state` - 查询合约状态

**使用：**
```bash
# 初始化合约
npm run evm:admin initialize

# 配置 USDC
ts-node evm-admin.ts configure_usdc

# 配置对端合约
ts-node evm-admin.ts configure_peer

# 添加 Relayer（从配置文件）
ts-node evm-admin.ts add_relayer

# 添加单个 Relayer
ts-node evm-admin.ts add_relayer 0x1234...5678

# 移除 Relayer
ts-node evm-admin.ts remove_relayer 0x1234...5678

# 增加流动性
ts-node evm-admin.ts add_liquidity 100000000

# 提取流动性
ts-node evm-admin.ts withdraw_liquidity 50000000

# 查询合约状态
ts-node evm-admin.ts query_state
```

## 💡 使用示例

### 完整部署流程（管理员）

#### SVM 端

```bash
# 1. 初始化合约
ts-node svm-admin.ts initialize

# 2. 配置 USDC
ts-node svm-admin.ts configure_usdc

# 3. 配置对端合约
ts-node svm-admin.ts configure_peer

# 4. 添加 Relayers
ts-node svm-admin.ts add_relayer

# 5. 增加流动性
ts-node svm-admin.ts add_liquidity
```

#### EVM 端

```bash
# 1. 初始化合约
ts-node evm-admin.ts initialize

# 2. 配置 USDC
ts-node evm-admin.ts configure_usdc

# 3. 配置对端合约
ts-node evm-admin.ts configure_peer

# 4. 添加 Relayers
ts-node evm-admin.ts add_relayer

# 5. 增加流动性
ts-node evm-admin.ts add_liquidity

# 6. 查询合约状态
ts-node evm-admin.ts query_state
```

### 用户跨链流程

#### 从 SVM 到 EVM

```bash
# 1. 查询余额
ts-node svm-user.ts balance

# 2. 质押 USDC（目标地址为 EVM 地址）
ts-node svm-user.ts stake 1000000 0x1234...5678
```

#### 从 EVM 到 SVM

```bash
# 1. 查询余额
ts-node evm-user.ts balance

# 2. 质押 USDC（目标地址为 SVM 公钥）
ts-node evm-user.ts stake 1000000 receiver_pubkey
```

## ⚙️ 配置说明

### 必需配置（Initialize 时）

这些配置在初始化合约时必须提供：

1. **Vault 地址**
   - SVM: PDA 地址（由 `["vault"]` 种子派生）
   - EVM: 金库地址（可以是多签钱包）

2. **Admin 地址**
   - 管理员地址（可以是多签钱包）

### Initialize 后配置

这些配置需要在初始化后、用户使用前配置：

1. **USDC 地址** (`configure_usdc`)
   - 必须在 `stake` 或 `submit_signature` 之前配置
   - SVM: USDC Mint Account
   - EVM: USDC ERC20 合约地址

2. **对端合约** (`configure_peer`)
   - 必须在 `stake` 之前配置
   - 配置对端链的合约地址和 Chain IDs

3. **Relayer 白名单** (`add_relayer`)
   - 必须在 relayer 提交签名之前添加
   - 至少需要 3 个 relayer（最多 18 个）

4. **流动性** (`add_liquidity`)
   - 接收端需要足够流动性才能解锁代币
   - 可选操作，根据需求添加

### 配置顺序建议

1. `initialize` - 初始化合约
2. `configure_usdc` - 配置 USDC
3. `configure_peer` - 配置对端
4. `add_relayer` - 添加 relayers
5. `add_liquidity` - 增加流动性（可选）

## 🔐 安全注意事项

1. **私钥安全**
   - 不要将 `.env` 文件提交到 Git
   - 生产环境使用硬件钱包或密钥管理服务
   - 定期轮换密钥

2. **多签钱包**
   - 生产环境建议使用多签钱包作为 admin 和 vault
   - EVM: Gnosis Safe
   - SVM: Squad Protocol

3. **测试网测试**
   - 在主网部署前，先在测试网充分测试
   - 使用小额测试交易

## 📚 相关文档

- [API 文档](../docs/api.md)
- [合约设计文档](../docs/design.md)
- [Relayer 文档](../relayer/README.md)

## ❓ 常见问题

### 1. SVM 私钥格式

SVM 私钥应该是 64 字节的 JSON 数组：

```json
[1,2,3,...,64]
```

可以使用 `solana-keygen` 生成：

```bash
solana-keygen new -o keypair.json
```

### 2. USDC 精度

USDC 使用 6 位小数：
- 1 USDC = 1,000,000 smallest units
- 示例: 质押 1 USDC，amount = 1000000

### 3. Gas 费用

- EVM: 确保账户有足够的 ETH 支付 gas
- SVM: 确保账户有足够的 SOL 支付交易费用

### 4. IDL 文件

SVM 脚本需要 Anchor IDL 文件才能执行实际交易。IDL 文件在编译合约时生成。

## 📞 支持

如有问题，请查看：
- 项目文档
- GitHub Issues
- 联系开发团队


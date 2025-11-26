# 部署和配置脚本使用指南

本目录包含用于部署和配置跨链桥合约的脚本。请按照以下顺序执行：

## 部署流程

### 步骤 1: 部署 EVM 合约

```bash
./01-deploy-evm.sh
```

**说明：**
- 部署 Bridge1024 合约到 Arbitrum Sepolia 测试网
- 自动初始化合约
- 将合约地址保存到 `.env.evm.deploy` 文件中

**配置文件：** `.env.evm.deploy`

**需要的环境变量：**
- `EVM_RPC_URL`: EVM RPC 地址
- `ADMIN_EVM_PRIVATE_KEY`: 管理员私钥
- `EVM_ADMIN_ADDRESS`: 管理员地址（可选，默认使用私钥对应地址）

**输出：**
- `EVM_CONTRACT_ADDRESS`: 部署的合约地址

---

### 步骤 2: 部署 SVM 合约

```bash
./02-deploy-svm.sh
```

**说明：**
- 部署 Bridge1024 程序到 1024Chain 测试网
- 自动编译和部署合约
- **支持两种部署模式**：
  - **升级部署**：使用现有 Program ID 升级合约（默认）
  - **全新部署**：生成新的 Program ID 并部署（会自动备份旧密钥对）
- 将程序 ID 保存到 `.env.svm.deploy` 和 `.env.invoke` 文件中

**配置文件：** `.env.svm.deploy`

**需要的环境变量：**
- `SVM_RPC_URL`: SVM RPC 地址
- `SVM_KEYPAIR_PATH`: 管理员密钥文件路径

**交互式选择：**
如果检测到已存在的程序密钥对，会提示：
1. 使用现有程序ID（升级部署）
2. 生成新的程序ID（全新部署，自动备份旧密钥对）

**输出：**
- `SVM_PROGRAM_ID`: 部署的程序 ID
- `SVM_ADMIN_ADDRESS`: 管理员地址

**备份机制：**
选择全新部署时，旧密钥对会自动备份到 `.backup_YYYYMMDD_HHMMSS/` 目录

---

### 步骤 3: 配置 USDC 和对端地址

```bash
./03-config-usdc-peer.sh
```

**说明：**
- 自动从 `.env.evm.deploy` 和 `.env.svm.deploy` 读取部署信息
- 在 EVM 合约上配置 USDC 地址和 SVM 对端合约地址
- 在 SVM 合约上配置 USDC Mint 和 EVM 对端合约地址

**配置文件：** `.env.config-usdc-peer`

在运行此脚本之前，需要创建配置文件：

```bash
cp .env.config-usdc-peer.example .env.config-usdc-peer
```

然后编辑 `.env.config-usdc-peer`，**只需填写以下信息**（其他配置会自动读取）：

```env
# USDC 合约地址 (必需)
USDC_EVM_CONTRACT=0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d
USDC_SVM_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v

# Chain ID (可选，有默认值)
EVM_CHAIN_ID=421614
SVM_CHAIN_ID=91024
```

**自动读取的配置：**
- 从 `.env.evm.deploy` 读取：RPC URL、合约地址、私钥等
- 从 `.env.svm.deploy` 读取：RPC URL、程序 ID、私钥路径等
- SVM 私钥会自动从 keypair 文件读取
- 对端合约地址自动配置（互相引用）

**执行操作：**
1. 配置 EVM 合约的 USDC 地址
2. 配置 EVM 合约的对端地址（SVM 程序 ID）
3. 配置 SVM 合约的 USDC Mint
4. 配置 SVM 合约的对端地址（EVM 合约地址）

---

### 步骤 4: 注册 Relayer（可选）

```bash
./04-register-relayer.sh
```

**说明：**
- 自动生成 E2S 和 S2E Relayer 的密钥对
- 将 E2S Relayer（Ed25519）注册到 SVM 合约
- 将 S2E Relayer（ECDSA）注册到 EVM 合约
- 更新 relayer 配置文件中的私钥

**交互式流程：**
- 如果密钥对已存在，会询问是否覆盖
- 自动执行注册到两条链的操作

**输出：**
- E2S Relayer 公钥和私钥（保存到 `.relayer/e2s-relayer.env`）
- S2E Relayer 地址和私钥（保存到 `.relayer/s2e-relayer.env`）

---

### 步骤 5: 充值 Relayer 账户（可选）

```bash
./05-fund-relayer.sh
```

**说明：**
- 从 EVM 管理员账户转账 0.001 ETH 到 S2E Relayer 账户（用于支付 EVM gas 费用）
- 为 E2S Relayer 账户申请 Solana airdrop（用于支付 SVM 交易费用）

**前置条件：**
- 已完成步骤 4（注册 Relayer）
- EVM 管理员账户有足够的 ETH
- SVM 测试网支持 airdrop（主网不支持）

---

### 步骤 6: 启动 Relayer 服务

```bash
./06-start-relayer.sh [start|stop|status]
```

**说明：**
- 启动三个 relayer 组件：
  - `s2e`: SVM → EVM 中继服务
  - `e2s-listener`: EVM → SVM 事件监听器
  - `e2s-submitter`: EVM → SVM 交易提交器
- 所有输出重定向到 `relayer/logs/` 文件夹下的同名加时间戳的 log 文件
- 三个进程的 PID 保存在 `relayer/` 文件夹下（`s2e.pid`, `e2s-listener.pid`, `e2s-submitter.pid`）

**命令：**
- `./06-start-relayer.sh` 或 `./06-start-relayer.sh start` - 启动所有服务
- `./06-start-relayer.sh stop` - 停止所有服务
- `./06-start-relayer.sh status` - 查看服务状态

**日志文件：**
- 日志保存在 `relayer/logs/` 目录
- 文件名格式：`{component}_{YYYYMMDD_HHMMSS}.log`
- 例如：`s2e_20251116_143022.log`

**PID 文件：**
- `relayer/s2e.pid`
- `relayer/e2s-listener.pid`
- `relayer/e2s-submitter.pid`

**注意事项：**
- 启动前确保已配置 relayer 的 `.env` 文件
- 如果服务已在运行，启动命令会提示并跳过
- 停止服务时会先尝试正常终止，必要时使用强制终止

---

## 环境变量配置

**重要：** 所有管理员和用户操作脚本都需要 `.env.invoke` 配置文件。

请参考 [ENV_VARIABLES.md](./ENV_VARIABLES.md) 了解详细的环境变量配置说明。

快速开始：

1. 在项目根目录创建 `.env.invoke` 文件
2. 从部署脚本生成的 `.env.evm.deploy` 和 `.env.svm.deploy` 中获取合约地址
3. 填写私钥和其他必需的配置项

---

## 管理员操作脚本

部署和配置完成后，可以使用以下脚本进行合约管理：

### EVM 管理脚本

```bash
# 查询合约状态
npx ts-node evm-admin.ts query_state

# 添加 Relayer
npx ts-node evm-admin.ts add_relayer <relayer_address>

# 移除 Relayer
npx ts-node evm-admin.ts remove_relayer <relayer_address>

# 添加流动性
npx ts-node evm-admin.ts add_liquidity <amount>

# 提取流动性
npx ts-node evm-admin.ts withdraw_liquidity <amount>
```

### SVM 管理脚本

```bash
# 添加 Relayer
npx ts-node svm-admin.ts add_relayer <relayer_pubkey>

# 移除 Relayer
npx ts-node svm-admin.ts remove_relayer <relayer_pubkey>

# 添加流动性
npx ts-node svm-admin.ts add_liquidity <amount>

# 提取流动性
npx ts-node svm-admin.ts withdraw_liquidity <amount>
```

---

## 用户操作脚本

### EVM 用户操作

```bash
# 质押 USDC（从 EVM 到 SVM）
npx ts-node evm-user.ts stake [amount] [receiver_address]

# 查询余额
npx ts-node evm-user.ts balance

# 查询合约状态
npx ts-node evm-user.ts state
```

### SVM 用户操作

```bash
# 质押 USDC（从 SVM 到 EVM）
npx ts-node svm-user.ts stake [amount] [receiver_address]

# 查询余额
npx ts-node svm-user.ts balance
```

---

## 测试脚本

### 端到端跨链测试

```bash
# EVM → SVM 跨链测试
npx ts-node cross-chain-test.ts

# SVM → EVM 跨链测试
npx ts-node cross-chain-test-s2e.ts
```

这些测试脚本会自动执行完整的跨链流程：质押 → 等待 relayer 处理 → 验证接收端余额变化。

---

## 故障排查

### EVM 部署失败

1. 检查 RPC URL 是否正确
2. 确认管理员账户有足够的 ETH
3. 检查私钥格式是否正确

### SVM 部署失败

1. 检查 Solana CLI 是否正确安装
2. 检查 Anchor 是否正确安装
3. 确认管理员账户有足够的 SOL
4. 如果余额不足，脚本会自动尝试空投

### 配置失败

1. 确认合约已正确部署
2. 检查 USDC 地址是否正确
3. 确认管理员私钥与部署时使用的一致
4. 验证对端合约地址格式是否正确

---

## 完整部署示例

```bash
# 1. 部署 EVM 合约
./01-deploy-evm.sh

# 2. 部署 SVM 合约
./02-deploy-svm.sh
# 如果已有程序，选择：1=升级部署, 2=全新部署

# 3. 准备配置文件（只需配置 USDC 地址）
cp .env.config-usdc-peer.example .env.config-usdc-peer
vim .env.config-usdc-peer  # 只需填写 USDC_EVM_CONTRACT 和 USDC_SVM_MINT

# 4. 配置 USDC 和对端地址（自动读取部署配置）
./03-config-usdc-peer.sh

# 5. 验证配置
npx ts-node evm-admin.ts query_state
npx ts-node svm-admin.ts query_state

# 6. 注册 Relayer（自动生成密钥并注册）
./04-register-relayer.sh

# 7. 充值 Relayer 账户（可选，用于支付 gas 费用）
./05-fund-relayer.sh

# 8. 启动 Relayer 服务
./06-start-relayer.sh start

# 9. 添加流动性
npx ts-node evm-admin.ts add_liquidity 100000000
npx ts-node svm-admin.ts add_liquidity 100000000

# 10. 测试跨链转账
npx ts-node evm-user.ts stake 1000000 <SVM_RECEIVER_PUBKEY>
npx ts-node svm-user.ts stake 1000000 <EVM_RECEIVER_ADDRESS>

# 查看 Relayer 服务状态
./06-start-relayer.sh status

# 停止 Relayer 服务
./06-start-relayer.sh stop
```

---

## 注意事项

1. **私钥安全**: 
   - 所有 `.env*` 文件都不应该提交到版本控制系统
   - 生产环境请使用硬件钱包或密钥管理服务

2. **网络配置**:
   - 确保 RPC URL 可访问
   - 测试网和主网的配置要分开管理

3. **USDC 地址**:
   - 测试网可以使用 Mock USDC
   - 主网必须使用官方 USDC 地址

4. **Chain ID**:
   - Arbitrum Sepolia: 421614
   - 1024Chain: 91024
   - 确保 Chain ID 与实际网络匹配

5. **部署顺序**:
   - 必须先完成部署（步骤 1-2）才能配置（步骤 3）
   - 配置步骤会自动读取部署脚本生成的合约地址
   - 配置脚本会自动从部署配置文件加载大部分变量

6. **配置简化**:
   - 配置脚本会自动从 `.env.evm.deploy` 和 `.env.svm.deploy` 读取配置
   - `.env.config-usdc-peer` 只需配置 USDC 地址
   - SVM 私钥会自动从 keypair 文件读取
   - 对端合约地址会自动配置（互相引用）

---

## 环境变量总览

### `.env.evm.deploy` (步骤 1 生成 - 自动)
由 `01-deploy-evm.sh` 自动创建和更新：
- `EVM_RPC_URL` - EVM RPC 地址
- `EVM_ADMIN_ADDRESS` - 管理员地址
- `ADMIN_EVM_PRIVATE_KEY` - 管理员私钥
- `EVM_CONTRACT_ADDRESS` ← 部署后自动写入
  
**注意：** 从 v2.0 开始，合约本身作为金库（vault），不需要单独配置金库地址。

### `.env.svm.deploy` (步骤 2 生成 - 自动)
由 `02-deploy-svm.sh` 自动创建和更新：
- `SVM_RPC_URL` - SVM RPC 地址
- `SVM_KEYPAIR_PATH` - 管理员密钥文件路径
- `SVM_PROGRAM_ID` ← 部署后自动写入
- `SVM_ADMIN_ADDRESS` ← 部署后自动写入

### `.env.config-usdc-peer` (步骤 3 需要 - 手动创建)
需要手动创建并配置以下变量：
- `USDC_EVM_CONTRACT` ← **必需：EVM USDC 合约地址**
- `USDC_SVM_MINT` ← **必需：SVM USDC Mint 地址**
- `EVM_CHAIN_ID` ← 可选（默认：421614）
- `SVM_CHAIN_ID` ← 可选（默认：91024）

**注意：** 步骤 3 会自动从前两个配置文件读取所有其他需要的变量，无需重复配置。

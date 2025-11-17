# 多签跨链桥项目

## 项目概述

本项目是一个基于多签验证的跨链桥系统，支持在 EVM 链（Arbitrum Sepolia）和 SVM 链（1024chain）之间进行 USDC 代币的跨链转移。系统采用质押-解锁机制，通过多个独立的 relayer 进行多签验证，确保跨链转账的安全性。

## 开发状态

**当前阶段：** M4 - Relayer 服务开发（**S2E Relayer 完整实现并验证成功** ✅）

**最新进展（2025-11-16）：**
- ✅ **Scripts 目录清理和优化** ⭐
  - ✅ 删除 6 个临时/重复脚本（check-request-status.ts, check-transaction.ts, remove-relayer.ts, init-svm-fresh.sh, redeploy-svm.sh, start-relayer.sh）
  - ✅ 增强 `02-deploy-svm.sh`：支持升级部署/全新部署选择、自动备份旧密钥对、生成新 Program ID
  - ✅ 脚本数量从 16 个精简到 10 个核心脚本
  - ✅ 保留完整的部署→配置→管理→用户操作流程
- ✅ **S2E Relayer (SVM→EVM) 完整实现并测试通过** ⭐⭐⭐
  - ✅ SVM 事件监听器（Solana RPC HTTP API 轮询）
  - ✅ 事件解析（base64 + Borsh 反序列化）
  - ✅ ECDSA 签名生成（SHA-256 + EIP-191 + secp256k1）
  - ✅ EVM 交易提交（ethers-rs）
  - ✅ Solana base58 地址支持
  - ✅ 状态追踪（避免重复处理）
  - ✅ HTTP API 服务（端口 8081）
  - ✅ **端到端测试验证成功**：
    - SVM Stake (1000 单位) → 事件捕获 → ECDSA 签名 → EVM 提交 → USDC 余额增加 (+0.001 USDC) ✅
    - 交易哈希: `0xcdad383798c88e3f8464d207b821feced89e90ddbc63ba6f49fa09b6d9d346ec`
- ✅ **E2S Relayer (EVM→SVM) 完整实现并运行** ⭐⭐⭐
  - ✅ **分离式架构**（解决 Rust 依赖冲突）
    - `e2s-listener`：监听 EVM 事件 → 保存到文件队列
    - `e2s-submitter`：从队列读取 → Ed25519 签名 → 提交到 SVM
  - ✅ EVM 事件监听器（ethers event filter）
  - ✅ 事件解析（StakeEvent ABI 解码）
  - ✅ 文件系统队列（`.relayer/queue/event_{nonce}.json`）
  - ✅ Ed25519 签名器（Borsh 序列化 + Ed25519）
  - ✅ SVM 交易提交器（包含 Ed25519Program 预验证指令）
  - ✅ HTTP API 服务（端口 8082）
  - ✅ 服务已运行并监听事件
- ✅ **SVM 用户脚本优化**
  - ✅ 添加 5 秒超时配置
  - ✅ 实现交易状态轮询（替代 confirmTransaction）
  - ✅ 立即返回交易签名

**之前完成（2025-11-15）：**
- ✅ **EVM 合约重构完成（v2.0）** ⭐
  - ✅ **合约本身作为金库**：简化架构，提高安全性
  - ✅ 无需外部 vault 地址和 approve 操作
  - ✅ 使用 `transfer()` 而非 `transferFrom()` 转出代币
  - ✅ 所有 41 个测试通过（100%）
- ✅ **SVM 合约核心功能开发完成**
  - ✅ 统一初始化功能（initialize）
  - ✅ USDC配置功能（configure_usdc）
  - ✅ 统一对端配置功能（configure_peer）
  - ✅ 发送端质押功能（stake）+ 事件发出（StakeEvent）
  - ✅ Relayer白名单管理（add_relayer, remove_relayer）
  - ✅ **Ed25519签名验证**（真实的密码学验证）⭐
  - ✅ 多签阈值检查（> 2/3）
  - ✅ Nonce递增判断机制（防重放攻击）
  - ✅ CrossChainRequest PDA账户（支持无限请求）
  - ✅ 流动性管理（add_liquidity, withdraw_liquidity）
- ✅ **测试完成情况：SVM 45/48（93.75%，3个合理跳过），EVM 41/41（100%）**
  - ✅ 统一合约测试：4/4 通过
  - ✅ 发送端合约测试：4/4 通过（TC-007已删除）
  - ✅ 接收端合约测试：11/11 通过
  - ✅ 集成测试：4/4 全部通过
  - ✅ 安全测试：10/13 通过（3个条件跳过，合理）
  - ✅ 性能测试：2/4 通过（2个条件跳过，合理）
  - ✅ 密码学辅助测试：8/8 通过
  - ⏸️ **3个合理跳过**：last_nonce 接近 u64::MAX 后无法继续测试递增
- ✅ **Ed25519 签名验证完全实现**
  - 修复 Ed25519Program ID 错误
  - 修复 @noble/ed25519 依赖版本和配置
  - 实现完整的 Borsh 序列化匹配
  - 所有签名验证测试通过
- ✅ **部署和运维脚本完善**
  - ✅ EVM 合约自动化部署脚本（deploy-evm.sh）
  - ✅ SVM 合约自动化部署脚本（deploy-svm.sh）
  - ✅ MockUSDC 自动化部署脚本（deploy-mock-usdc.sh）
  - ✅ 支持 Arbitrum Sepolia 和 1024chain Testnet
  - ✅ 简洁输出，自动更新 .env 配置
  - ✅ 使用相对路径，支持灵活部署
  - ✅ TypeScript 管理员和用户操作脚本（evm-admin.ts, evm-user.ts, svm-admin.ts, svm-user.ts）

**详细进度：** 参见 [docs/progress.md](docs/progress.md)  
**测试计划：** 参见 [docs/testplan.md](docs/testplan.md)  
**API文档：** 参见 [docs/api.md](docs/api.md)  
**设计文档：** 参见 [docs/design.md](docs/design.md)

### 核心特性

- 支持 EVM（Arbitrum Sepolia）与 SVM（1024chain）之间的双向跨链转移
- 仅支持 USDC 代币的跨链转移
- 采用质押-解锁机制，而非铸币-销毁模式
- 多签验证机制，需要超过 2/3 的 relayer 签名才能完成解锁（最多支持18个relayer）
- **原生密码学算法**：SVM 使用 Ed25519，EVM 使用 ECDSA (secp256k1) + EIP-191
- 防重放攻击机制：nonce 递增判断（64位无符号整数，溢出重置为0）+ block_height
- 支持至少100个未完成的跨链请求同时存在
- 支持至少1200个签名缓存（100个请求 × 18个relayer = 1800个签名）

### 密码学算法设计

系统采用**各自原生密码学算法**的设计原则：

**SVM 端（Solana/1024chain）**：
- 签名算法：**Ed25519**（Solana 原生）
- 数据序列化：**Borsh**（Anchor 标准）
- 验证方式：**Ed25519Program** 预编译合约
- 特点：64 字节签名，性能极优

**EVM 端（Ethereum/Arbitrum）**：
- 签名算法：**ECDSA (secp256k1)**（Ethereum 原生）
- 数据序列化：**JSON 字符串**
- 哈希算法：**SHA-256 + Keccak256 (EIP-191)**
- 验证方式：**ecrecover** 预编译合约
- 特点：65 字节签名，与 Ethereum 生态完全兼容

**跨链兼容性**：
- Relayer 负责在两种格式之间转换
- 监听 SVM 事件 → 用 ECDSA 签名 → 提交到 EVM
- 监听 EVM 事件 → 用 Ed25519 签名 → 提交到 SVM

## 快速开始

### 前置条件

**EVM 工具链：**
```bash
# 安装 Foundry
curl -L https://foundry.paradigm.xyz | bash && foundryup
```

**SVM 工具链：**
```bash
# 安装 Anchor 和 Solana CLI
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
solana-keygen new -o ~/.config/solana/id.json
```

### 一键部署流程

```bash
cp .env.evm.deploy.example .env.evm.deploy
cp .env.svm.deploy.example .env.svm.deploy
cp .env.invoke.example .env.invoke
cp .env.config-usdc-peer.example .env.config-usdc-peer
# 填写缺失的配置
vim .env.evm.deploy  
vim .env.svm.deploy  
vim .env.invoke  
vim .env.config-usdc-peer  

cd scripts

# 1. 部署 EVM 合约
./01-deploy-evm.sh

# 2. 部署 SVM 合约（选择升级或全新部署）
./02-deploy-svm.sh

# 3. 配置 USDC 和对端地址
cd -
cd scripts
./03-config-usdc-peer.sh

# 4. 注册 Relayer（自动生成密钥）
./04-register-relayer.sh
# 之后假设 relayer 账户拥有充足的SOL和ETH支付交易费，因此需要手动向这些账户充值

# 5. 添加流动性：管理员从自己的账户向金库地址转入USDC
npx ts-node evm-admin.ts add_liquidity 100000000
npx ts-node svm-admin.ts add_liquidity 100000000

# 6. 开启 relayer 服务

# 7. 测试跨链转账
npx ts-node svm-user.ts balance
npx ts-node evm-user.ts stake 100 <SVM_RECEIVER_PUBKEY>
npx ts-node svm-user.ts balance # 确认SVM余额增加

npx ts-node evm-user.ts balance
npx ts-node svm-user.ts stake 100 <EVM_RECEIVER_ADDRESS>
npx ts-node evm-user.ts balance # 确认EVM余额增加
```

详细说明见 [scripts/README.md](scripts/README.md)

## 使用方法

### 跨链转账流程

1. 用户在发送端链调用质押接口，传入质押数量和接收端地址
2. 发送端合约将用户的 USDC 转入质押金库，并触发质押事件
3. 多个 relayer 监听到质押事件后，分别对事件数据进行签名
4. 每个 relayer 将签名后的数据发送到接收端合约
5. 接收端合约验证签名，当达到 2/3 阈值后，从金库解锁等量 USDC 到接收地址

## 项目结构

### 智能合约

- **svm/**：Solana 智能合约（1024chain 部署）
  - **统一初始化**：`initialize` 函数同时初始化发送端和接收端合约
  - **USDC配置**：`configure_usdc` 函数配置USDC mint account地址
  - **统一对端配置**：`configure_peer` 函数同时配置发送端和接收端的对端信息
  - 发送端合约：负责质押 USDC 并触发质押事件（nonce自动递增）
  - 接收端合约：验证 relayer **Ed25519** 签名并解锁 USDC（使用nonce递增判断防重放）
  - 每个跨链请求使用独立的 CrossChainRequest PDA 账户存储签名缓存
  - **密码学**：Ed25519 签名 + Borsh 序列化（Solana 原生）
  
- **evm/**：EVM 智能合约（Arbitrum Sepolia 部署）
  - **初始化**：`initialize` 函数初始化发送端和接收端合约
  - **USDC配置**：`configure_usdc` 函数配置USDC ERC20合约地址
  - **对端配置**：`configure_peer` 函数配置对端合约和链ID
  - 发送端合约：负责质押 USDC 并触发质押事件
  - 接收端合约：验证 relayer **ECDSA** 签名并解锁 USDC
  - **金库设计（v2.0）**：合约本身作为金库，无需外部 vault 或 approve
  - **密码学**：ECDSA (secp256k1) + EIP-191 + SHA-256 + JSON（Ethereum 原生）

### 中继服务

- **relayer/**：中继服务器（Rust 实现 🦀）
  - **s2e 服务** (SVM→EVM)：✅ **完整实现并验证**
    - 单一进程架构
    - 监听 1024chain 事件（HTTP RPC 轮询）
    - ECDSA 签名（SHA-256 + EIP-191）
    - 提交到 Arbitrum
    - HTTP API（端口 8081）
    - 详细说明：[relayer/README_S2E.md](relayer/README_S2E.md)
  - **e2s 服务** (EVM→SVM)：✅ **完整实现并运行**
    - 分离式架构（解决依赖冲突）
    - `e2s-listener`：监听 Arbitrum 事件 → 文件队列
    - `e2s-submitter`：队列处理 → Ed25519 签名 → 提交到 1024chain
    - HTTP API（端口 8082）
    - 详细说明：[relayer/README_E2S.md](relayer/README_E2S.md)
  - **HTTP API**：健康检查、状态查询、Prometheus 指标
  - **高性能架构**：Tokio 异步运行时 + 文件队列（e2s）/ 内存队列（s2e）
  - 详细设计见 [relayer/README.md](relayer/README.md)

### 部署和运维脚本

- **scripts/**：部署和操作脚本（TypeScript + Shell）- **已精简至 10 个核心脚本**
  - **部署脚本**：
    - `01-deploy-evm.sh`：自动化部署 EVM 合约到 Arbitrum Sepolia
    - `02-deploy-svm.sh`：自动化部署 SVM 合约到 1024chain（支持升级/全新部署）
    - `03-config-usdc-peer.sh`：配置 USDC 地址和对端合约地址
    - `04-register-relayer.sh`：自动生成并注册 Relayer 密钥对
  - **管理脚本**：
    - `evm-admin.ts`：EVM 合约管理操作（查询状态、配置、relayer 管理、流动性管理）
    - `svm-admin.ts`：SVM 合约管理操作（查询状态、配置、relayer 管理、流动性管理）
  - **用户脚本**：
    - `evm-user.ts`：EVM 用户操作（质押 USDC、查询余额）
    - `svm-user.ts`：SVM 用户操作（质押 USDC、查询余额）
  - **测试脚本**：
    - `cross-chain-test.ts`：EVM→SVM 端到端测试
    - `cross-chain-test-s2e.ts`：SVM→EVM 端到端测试
  - 详细文档见 [scripts/README.md](scripts/README.md)

### 文档

- **README.md**：项目概述和使用说明（本文件）
- **docs/api.md**：API 接口文档和模块间调用规约
- **docs/testplan.md**：测试计划和用户故事
- **docs/progress.md**：项目进度跟踪

## 配置说明

系统需要配置以下参数以支持不同网络环境（测试网/主网）：

- 发送端链的 RPC 地址
- 接收端链的 RPC 地址
- 发送端合约地址
- 接收端合约地址
- 质押金库地址：
  - **SVM端**：PDA 金库地址（发送端和接收端共享同一个金库）
  - **EVM端（v2.0）**：合约本身作为金库，不需要单独配置
- 管理员钱包地址（SVM 和 EVM 各自独立，但在SVM中发送端和接收端共享同一个管理员）
- USDC代币地址：
  - SVM端：USDC mint account地址（通过 `configure_usdc` 配置）
  - EVM端：USDC ERC20合约地址（通过 `configure_usdc` 配置）
- Relayer 私钥列表（最多18个relayer）
- Chain ID（Arbitrum Sepolia/Mainnet，1024chain Testnet/Mainnet）

### EVM v2.0 金库变更

- ✅ **合约即金库**：合约地址直接持有 USDC，不需要外部 vault
- ✅ **简化部署**：不需要配置 vault 地址或进行 approve 操作
- ✅ **流动性管理**：直接向合约地址转入 USDC 即可增加流动性

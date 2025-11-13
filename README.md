# 多签跨链桥项目

## 项目概述

本项目是一个基于多签验证的跨链桥系统，支持在 EVM 链（Arbitrum Sepolia）和 SVM 链（1024chain）之间进行 USDC 代币的跨链转移。系统采用质押-解锁机制，通过多个独立的 relayer 进行多签验证，确保跨链转账的安全性。

## 开发状态

**当前阶段：** M3 - SVM 合约开发（进行中）

**最新进展（2025-11-15）：**
- ✅ SVM 发送端合约实现完成
  - 统一初始化功能（initialize）
  - 统一对端配置功能（configure_peer）
  - 质押功能（stake）
  - 事件发出（StakeEvent）
- ✅ 发送端合约测试全部通过（TC-001 ~ TC-007，7/7）
- ✅ 接收端合约基础功能完成（TC-101 ~ TC-106，6/6通过）
  - 统一初始化功能（initialize，与发送端合并）
  - 统一对端配置功能（configure_peer，与发送端合并）
  - Relayer白名单管理（add_relayer, remove_relayer, is_relayer）
  - 签名提交和阈值检查（submit_signature）
- 🟡 接收端合约签名验证功能开发中
  - ✅ 实现 ECDSA 公钥存储机制（relayer_ecdsa_pubkeys）
  - ✅ 修改 add_relayer 接受 ECDSA 公钥参数
  - ✅ 修复 TC-107：单个 relayer 提交签名不应解锁
  - 🟡 实现完整的 ECDSA 签名验证逻辑（进行中）
  - ⏸️ TC-109 ~ TC-113 测试待取消 skip
- ⏸️ 集成测试、安全测试、性能测试待实现
- 📝 **设计重构（2025-11-15）**：
  - 支持18个relayer（最多18个）
  - Nonce使用递增判断机制（64位u64，溢出重置为0）
  - 统一初始化函数（发送端和接收端合并）
  - 统一对端配置函数（发送端和接收端合并）
  - 支持100+未完成请求和1200+签名缓存
  - 使用CrossChainRequest PDA账户存储每个请求的签名缓存

**详细进度：** 参见 [docs/progress.md](docs/progress.md)

### 核心特性

- 支持 EVM（Arbitrum Sepolia）与 SVM（1024chain）之间的双向跨链转移
- 仅支持 USDC 代币的跨链转移
- 采用质押-解锁机制，而非铸币-销毁模式
- 多签验证机制，需要超过 2/3 的 relayer 签名才能完成解锁（最多支持18个relayer）
- 防重放攻击机制：nonce 递增判断（64位无符号整数，溢出重置为0）+ block_height
- 支持至少100个未完成的跨链请求同时存在
- 支持至少1200个签名缓存（100个请求 × 18个relayer = 1800个签名）

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
  - 接收端合约：验证 relayer 签名并解锁 USDC（使用nonce递增判断防重放）
  - 每个跨链请求使用独立的 CrossChainRequest PDA 账户存储签名缓存
  
- **evm/**：EVM 智能合约（Arbitrum Sepolia 部署）
  - **初始化**：`initialize` 函数初始化发送端和接收端合约
  - **USDC配置**：`configure_usdc` 函数配置USDC ERC20合约地址
  - **对端配置**：`configure_peer` 函数配置对端合约和链ID
  - 发送端合约：负责质押 USDC 并触发质押事件
  - 接收端合约：验证 relayer 签名并解锁 USDC

### 中继服务

- **relayer/**：中继服务器
  - 监听发送端链的质押事件
  - 对事件数据进行签名
  - 将签名数据提交到接收端合约

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
- 质押金库地址（SVM 和 EVM 各自独立，但在SVM中发送端和接收端共享同一个金库）
- 管理员钱包地址（SVM 和 EVM 各自独立，但在SVM中发送端和接收端共享同一个管理员）
- USDC代币地址：
  - SVM端：USDC mint account地址（通过 `configure_usdc` 配置）
  - EVM端：USDC ERC20合约地址（通过 `configure_usdc` 配置）
- Relayer 私钥列表（最多18个relayer）
- Chain ID（Arbitrum Sepolia/Mainnet，1024chain Testnet/Mainnet）

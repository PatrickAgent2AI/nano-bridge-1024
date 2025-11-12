# 多签跨链桥项目

## 项目概述

本项目是一个基于多签验证的跨链桥系统，支持在 EVM 链（Arbitrum Sepolia）和 SVM 链（1024chain）之间进行 USDC 代币的跨链转移。系统采用质押-解锁机制，通过多个独立的 relayer 进行多签验证，确保跨链转账的安全性。

### 核心特性

- 支持 EVM（Arbitrum Sepolia）与 SVM（1024chain）之间的双向跨链转移
- 仅支持 USDC 代币的跨链转移
- 采用质押-解锁机制，而非铸币-销毁模式
- 多签验证机制，需要超过 2/3 的 relayer 签名才能完成解锁
- 防重放攻击机制（nonce + block_height）

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
  - 发送端合约：负责质押 USDC 并触发质押事件
  - 接收端合约：验证 relayer 签名并解锁 USDC
  
- **evm/**：EVM 智能合约（Arbitrum Sepolia 部署）
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
- 质押金库地址（SVM 和 EVM 各自独立）
- 管理员钱包地址（SVM 和 EVM 各自独立）
- Relayer 私钥列表
- Chain ID（Arbitrum Sepolia/Mainnet，1024chain Testnet/Mainnet）

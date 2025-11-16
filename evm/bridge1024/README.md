# Bridge1024 EVM Implementation

## 概述

这是 Bridge1024 跨链桥的 EVM（Ethereum Virtual Machine）实现，使用 Foundry 框架开发和测试。

## 密码学标准（与 SVM 对齐）

本实现完全对齐 SVM 端的密码学标准：

1. **Hash 算法**：SHA-256
2. **数据序列化**：JSON 格式（与 SVM 端 `JSON.stringify` 一致）
3. **签名算法**：ECDSA (secp256k1)
4. **签名格式**：EIP-191 标准（"\x19Ethereum Signed Message:\n32" + hash）
5. **Threshold 计算**：`(relayerCount * 2 + 2) / 3` (向上取整)
6. **Nonce 机制**：64 位无符号整数，使用递增判断防重放
7. **事件数据结构**：与 SVM 完全一致

## 文件结构

```
.
├── src/
│   ├── Bridge1024.sol      # 主合约（包含发送端和接收端功能）
│   └── MockUSDC.sol         # 测试用 Mock USDC 合约
├── test/
│   └── Bridge1024.t.sol     # 完整测试套件（覆盖所有测试用例）
├── foundry.toml             # Foundry 配置文件
└── README.md                # 本文件
```

## 合约功能

### 统一合约

- `initialize(vaultAddress, adminAddress)` - 统一初始化发送端和接收端
  - **注意**：从 v2.0 开始，`vaultAddress` 参数已废弃，合约本身作为金库
  - 合约内部使用 `address(this)` 作为金库地址
- `configureUsdc(usdcAddress)` - 配置 USDC ERC20 合约地址
- `configurePeer(peerContract, sourceChainId, targetChainId)` - 配置对端合约和链ID

### 发送端功能

- `stake(amount, receiverAddress)` - 质押 USDC 发起跨链转账
  - 用户的 USDC 直接转入合约地址（合约作为金库）
  - 自动递增 nonce
  - 触发 `StakeEvent` 事件

### 接收端功能

- `addRelayer(relayerAddress)` - 添加 Relayer 到白名单
- `removeRelayer(relayerAddress)` - 从白名单移除 Relayer
- `submitSignature(eventData, signature)` - 提交签名，达到阈值后解锁代币
  - 合约直接使用 `transfer()` 从自身余额转出 USDC
  - 不需要预先 approve
- `isRelayer(address)` - 查询是否为白名单 Relayer
- `getRelayerCount()` - 获取 Relayer 总数

### 金库设计（v2.0 变更）

**重要变更**：合约本身作为金库，简化了架构并提高了安全性。

- ✅ **合约即金库**：`senderState.vault` 和 `receiverState.vault` 都指向 `address(this)`
- ✅ **无需 approve**：合约使用 `transfer()` 而非 `transferFrom()` 转出代币
- ✅ **简化部署**：不需要单独配置 vault 地址或进行 approve 操作
- ✅ **提高安全性**：减少了外部依赖和攻击面

## 测试套件

### 测试覆盖

测试文件包含以下测试类别：

1. **统一合约测试** (TC-001 ~ TC-003B)：4个测试
   - ✅ 统一初始化
   - ✅ USDC 配置
   - ✅ 对端配置
   - ✅ 权限控制

2. **发送端合约测试** (TC-004 ~ TC-008)：5个测试
   - ✅ 质押功能（成功、余额不足、未授权、USDC未配置）
   - ✅ 事件完整性

3. **接收端合约测试** (TC-101 ~ TC-111)：11个测试
   - ✅ Relayer 白名单管理
   - ✅ 签名提交和验证
   - ✅ Nonce 递增判断
   - ✅ 阈值检查和解锁
   - ✅ 错误处理

4. **集成测试** (IT-001 ~ IT-004)：4个测试
   - ✅ 端到端跨链转账（EVM → SVM）
   - ✅ 端到端跨链转账（SVM → EVM）
   - ✅ 并发转账
   - ✅ 大额转账

5. **安全测试** (ST-001 ~ ST-005)：6个测试
   - ✅ Nonce 递增判断（防重放攻击）
   - ✅ 签名伪造防御
   - ✅ 权限控制
   - ✅ 金库安全
   - ✅ 事件验证

6. **性能测试** (PT-001 ~ PT-004)：4个测试
   - ✅ 质押延迟
   - ✅ 签名提交延迟
   - ✅ 端到端延迟
   - ✅ 吞吐量

### 测试结果

- **总测试数**: 41个
- **通过**: 41个 ✅
- **失败**: 0个
- **通过率**: 100% 🎉

### 核心功能测试状态

- ✅ 统一初始化：100% 通过（4个测试）
- ✅ 发送端功能：100% 通过（5个测试）
- ✅ 接收端功能：100% 通过（11个测试）
- ✅ 安全机制：100% 通过（6个测试）
- ✅ 集成测试：100% 通过（4个测试）
- ✅ 性能测试：100% 通过（4个测试）
- ✅ 阈值计算：100% 通过（1个测试）

## 编译和测试

### 安装依赖

```bash
cd evm/bridge1024
forge install
```

### 编译合约

```bash
forge build
```

### 运行测试

```bash
# 运行所有测试
forge test

# 运行特定测试
forge test --match-test testTC001_UnifiedInitialize

# 详细输出
forge test -vvv

# 生成覆盖率报告
forge coverage

# 生成 Gas 报告
forge test --gas-report
```

## 部署

### 快速部署到 Arbitrum Sepolia

```bash
cd ../../scripts

# 使用自动化脚本（推荐）
./deploy-evm.sh

# 部署测试用 MockUSDC
./deploy-mock-usdc.sh
```

### 手动部署

```bash
# 编译
forge build

# 部署
forge create \
  --rpc-url https://sepolia-rollup.arbitrum.io/rpc \
  --private-key $ADMIN_EVM_PRIVATE_KEY \
  src/Bridge1024.sol:Bridge1024

# 初始化（注意：vaultAddress 参数已废弃，可传入任意地址）
cast send <CONTRACT_ADDRESS> \
  "initialize(address,address)" \
  $EVM_ADMIN_ADDRESS \
  $EVM_ADMIN_ADDRESS \
  --rpc-url https://sepolia-rollup.arbitrum.io/rpc \
  --private-key $ADMIN_EVM_PRIVATE_KEY

# 重要：给合约地址转入 USDC 作为流动性（合约本身是金库）
# 使用 MockUSDC 或真实 USDC 合约的 transfer 或 mint 功能
```

详细部署文档见 [../../scripts/README.md](../../scripts/README.md#部署脚本)

## 待完成工作

1. ~~**部署脚本**~~：✅ 已完成（deploy-evm.sh）
2. **性能优化**：可选的 Gas 优化（当前性能已满足要求）
3. **安全审计**：进行外部安全审计

## 与 SVM 的对齐

本实现确保与 SVM 端完全对齐：

- ✅ Hash 函数：SHA-256（使用 `sha256` precompile）
- ✅ 数据序列化：JSON 格式
- ✅ 签名算法：ECDSA (secp256k1)
- ✅ Threshold 计算：相同公式
- ✅ Nonce 机制：64位，递增判断
- ✅ 事件结构：字段完全一致
- ✅ 错误处理：错误类型对应

## 配置参数

- **SOURCE_CHAIN_ID**: 421614 (Arbitrum Sepolia)
- **TARGET_CHAIN_ID**: 91024 (1024chain Testnet)
- **MAX_RELAYERS**: 18
- **TEST_AMOUNT**: 100_000000 (100 USDC with 6 decimals)

## 安全注意事项

1. 合约已实现基本的安全机制（权限控制、nonce递增判断、签名验证）
2. 建议在主网部署前进行完整的安全审计
3. **合约本身是金库**：需要确保合约有足够的 USDC 余额用于解锁操作
4. 管理员地址应使用多签钱包（如 Gnosis Safe）
5. 定期监控合约事件和余额状态
6. **流动性管理**：管理员需要定期检查合约余额，确保有足够流动性支持跨链转账

## 许可证

MIT

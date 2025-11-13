# 系统设计文档

## 目录

- [系统架构](#系统架构)
- [数据存储设计](#数据存储设计)
- [SVM 合约设计](#svm-合约设计)
- [EVM 合约设计](#evm-合约设计)
- [Relayer 服务设计](#relayer-服务设计)
- [安全考虑](#安全考虑)

---

## 系统架构

### 整体架构

系统由三个主要组件组成：

1. **SVM 智能合约**（1024chain）：发送端和接收端合约
2. **EVM 智能合约**（Arbitrum Sepolia）：发送端和接收端合约
3. **Relayer 中继服务**：监听事件、签名验证、交易提交

### 跨链转账流程

```
用户 → 发送端合约（质押） → 触发事件 → Relayer监听 → 签名验证 → 接收端合约（解锁）
```

---

## 数据存储设计

### Solana (SVM) 账户设计

由于 Solana 账户大小限制（最大 10MB，但实际使用中建议不超过 10KB），需要采用 PDA（Program Derived Address）来支持无限请求和最多 18 个 relayer。

#### ReceiverState 主账户

存储固定大小的配置数据：

```rust
pub struct ReceiverState {
    pub vault: Pubkey,              // 32 bytes
    pub admin: Pubkey,              // 32 bytes
    pub relayer_count: u64,         // 8 bytes
    pub source_contract: Pubkey,     // 32 bytes
    pub source_chain_id: u64,       // 8 bytes
    pub target_chain_id: u64,       // 8 bytes
    pub relayers: Vec<Pubkey>,      // 4 + 32 * 18 = 580 bytes (最多18个relayer)
    pub last_nonce: u64,            // 8 bytes (用于nonce递增判断)
}
```

**账户大小计算：**
- Base: 120 bytes
- Relayers (18个): 580 bytes
- Last nonce: 8 bytes
- **总计: ~708 bytes** (在 10KB 限制内)

**设计说明：**
- `relayers`: 最多支持 18 个 relayer
- `last_nonce`: 记录最后一个已使用的 nonce，用于判断新 nonce 是否递增
- Nonce 使用 64 位无符号整数（u64），通过递增判断来防止重放攻击
- 当 nonce 溢出时（达到 u64::MAX），重置为 0

#### CrossChainRequest PDA 账户

为每个跨链请求（nonce）创建独立的 PDA 账户来存储 relayer 签名缓存：

```rust
pub struct CrossChainRequest {
    pub nonce: u64,                    // 8 bytes
    pub signed_relayers: Vec<Pubkey>,   // 4 + 32 * 18 = 580 bytes (最多18个relayer)
    pub signature_count: u8,            // 1 byte
    pub is_unlocked: bool,              // 1 byte
    pub event_data: StakeEventData,     // 事件数据（用于验证和转账）
}
```

**PDA 种子：** `[b"cross_chain_request", nonce.to_le_bytes()]`

**账户大小：** ~600+ bytes（固定大小，支持最多 18 个 relayer）

**设计优势：**
- **支持至少 100 个未完成的请求**：每个请求独立账户，可同时存在 100+ 个未完成的请求
- **支持 1200 个签名缓存**：100 个请求 × 18 个 relayer = 1800 个签名（超过要求的 1200 个）
- 每个请求独立账户，支持无限 nonce
- 固定大小，易于管理
- 解锁后可以关闭账户回收租金

**Nonce 递增判断逻辑：**
1. 新 nonce 必须大于 `last_nonce`（递增）
2. 如果新 nonce <= `last_nonce`，则视为重放攻击，拒绝处理
3. 当 nonce 达到 `u64::MAX` 时，重置为 0（溢出处理）
4. 解锁成功后，更新 `last_nonce = nonce`

#### 设计权衡

| 方案 | 优点 | 缺点 |
|------|------|------|
| **当前方案（PDA）** | 支持无限 nonce，固定大小 | 需要为每个 nonce 创建账户 |
| Vec 存储所有记录 | 简单直接 | 账户大小会无限增长 |
| 位图跟踪 | 空间效率高 | 实现复杂，需要压缩算法 |

**选择 PDA 方案的原因：**
1. Solana 账户大小限制严格（10KB）
2. 需要支持理论上无限次请求
3. 每个 nonce 的签名记录是独立的，适合分离存储
4. 解锁后可以关闭账户，回收租金

### EVM 合约存储设计

EVM 合约使用映射（mapping）存储，无大小限制：

```solidity
struct NonceSignature {
    mapping(address => bool) signedRelayers;
    uint8 signatureCount;
    bool isUnlocked;
}

mapping(uint256 => NonceSignature) public nonceSignatures;
mapping(uint256 => bool) public usedNonces;
```

---

## SVM 合约设计

### 统一初始化设计

**重要变更：** 一个平台的接收端和发送端初始化函数合并为一个 `initialize` 指令。

在初始化时，同时创建 `SenderState` 和 `ReceiverState` 账户，共享相同的配置（vault、admin、chain_id 等）。

#### 初始化账户结构

```rust
// 发送端状态
pub struct SenderState {
    pub vault: Pubkey,
    pub admin: Pubkey,
    pub usdc_mint: Pubkey,              // USDC mint account地址（SVM）或合约地址（EVM）
    pub nonce: u64,                     // 64位无符号整数，初始为0
    pub target_contract: Pubkey,
    pub source_chain_id: u64,
    pub target_chain_id: u64,
}

// 接收端状态
pub struct ReceiverState {
    pub vault: Pubkey,                  // 与发送端共享
    pub admin: Pubkey,                  // 与发送端共享
    pub usdc_mint: Pubkey,              // USDC mint account地址（SVM）或合约地址（EVM），与发送端共享
    pub relayer_count: u64,
    pub source_contract: Pubkey,
    pub source_chain_id: u64,
    pub target_chain_id: u64,
    pub relayers: Vec<Pubkey>,          // 最多18个
    pub last_nonce: u64,                // 用于nonce递增判断
}
```

#### 主要功能

1. **initialize**: 统一初始化发送端和接收端合约
   - 创建 `SenderState` 账户
   - 创建 `ReceiverState` 账户
   - 设置共享的 vault 和 admin
   - 初始化 nonce 为 0
   - 初始化 last_nonce 为 0

2. **configure_usdc**: 配置USDC代币地址
   - 同时配置发送端和接收端的 `usdc_mint` 字段
   - **SVM端**：传入USDC的SPL Token mint account地址
   - **EVM端**：传入USDC的ERC20合约地址
   - 因为两端使用同一个USDC代币，所以共享相同的地址

3. **configure_peer**: 统一配置对端合约和链ID
   - 同时配置发送端的 `target_contract`、`source_chain_id`、`target_chain_id`
   - 同时配置接收端的 `source_contract`、`source_chain_id`、`target_chain_id`
   - 因为对端是同一个，所以两个配置共享相同的参数

4. **stake** (发送端): 质押代币并触发事件
   - **验证USDC地址已配置**：如果 `sender_state.usdc_mint` 为无效地址（如 `Pubkey::default()`），返回错误
   - Nonce 递增逻辑：
     - 当前 nonce = `sender_state.nonce`
     - 新 nonce = `current_nonce + 1`
     - 如果 `new_nonce == 0`（溢出），重置为 0
     - 更新 `sender_state.nonce = new_nonce`

5. **add_relayer** / **remove_relayer** / **is_relayer** (接收端): Relayer 白名单管理

6. **submit_signature** (接收端): 提交签名并检查阈值
   - **验证USDC地址已配置**：如果 `receiver_state.usdc_mint` 为无效地址（如 `Pubkey::default()`），返回错误

#### submit_signature 流程

```
1. 验证 relayer 在白名单中
2. 验证USDC地址已配置：如果 usdc_mint 为无效地址，返回错误 "USDC address not configured"
3. 验证源链合约地址和 chain ID
4. 检查 nonce 是否递增：
   - 如果 nonce <= last_nonce，拒绝（重放攻击）
   - 如果 nonce > last_nonce，继续处理
5. 获取或创建 CrossChainRequest PDA 账户
6. 检查该 relayer 是否已为此 nonce 签名
7. 记录签名到 CrossChainRequest.signed_relayers
8. 计算签名数量，检查是否达到阈值（> 2/3 relayer_count）
9. 如果达到阈值：
   - 从金库转账到接收地址（使用配置的 usdc_mint）
   - 更新 last_nonce = nonce（标记为已使用）
   - 标记 CrossChainRequest.is_unlocked = true
   - 可选：关闭 CrossChainRequest 账户回收租金
```

#### Nonce 溢出处理

当 nonce 达到 `u64::MAX` (18,446,744,073,709,551,615) 时：
- 下一次 `stake` 调用时，nonce 会溢出并重置为 0
- 此时需要特殊处理：如果 `last_nonce` 接近 `u64::MAX`，允许 nonce 从 0 开始
- 实现逻辑：
  ```rust
  let new_nonce = sender_state.nonce.wrapping_add(1);
  if new_nonce == 0 && sender_state.nonce != u64::MAX {
      // 异常情况，不应该发生
      return Err(Error::NonceOverflow);
  }
  sender_state.nonce = new_nonce;
  ```

---

## EVM 合约设计

### 发送端合约

与 SVM 发送端合约功能相同，使用 Solidity 实现。

**账户结构：**
```solidity
struct SenderState {
    address vault;
    address admin;
    address usdcContract;        // USDC ERC20合约地址（未配置时为address(0)）
    uint64 nonce;
    address targetContract;
    uint64 sourceChainId;
    uint64 targetChainId;
}
```

**stake 函数验证：**
- 检查 `usdcContract != address(0)`，否则返回错误 "USDC address not configured"

### 接收端合约

使用 mapping 存储签名记录，无大小限制。

**账户结构：**
```solidity
struct ReceiverState {
    address vault;
    address admin;
    address usdcContract;        // USDC ERC20合约地址（未配置时为address(0)）
    uint64 relayerCount;
    address sourceContract;
    uint64 sourceChainId;
    uint64 targetChainId;
    address[] relayers;         // 最多18个
    uint64 lastNonce;
}
```

**submit_signature 函数验证：**
- 检查 `usdcContract != address(0)`，否则返回错误 "USDC address not configured"

### 配置接口

1. **initialize**: 初始化合约（设置vault和admin）
2. **configure_usdc**: 配置USDC ERC20合约地址（必须在使用前配置）
3. **configure_peer**: 配置对端合约和链ID

---

## Relayer 服务设计

### 功能模块

1. **事件监听模块**
   - 监听 EVM 链的 `StakeEvent` 事件
   - 监听 SVM 链的 `StakeEvent` 事件

2. **签名模块**
   - 使用 ECDSA (secp256k1) 对事件数据进行签名
   - 签名数据：`SHA256(serialize(eventData))`

3. **交易提交模块**
   - 提交签名到接收端合约
   - 处理交易失败和重试

### 配置要求

- 支持最多 18 个 relayer
- 每个 relayer 独立运行
- 阈值：`Math.ceil(relayer_count * 2 / 3)`
- 支持至少 100 个未完成的跨链请求（每个请求独立 PDA 账户）
- 支持至少 1200 个签名缓存（100 个请求 × 18 个 relayer = 1800 个签名）

---

## 安全考虑

### 防重放攻击

1. **Nonce 递增判断机制**：
   - 每个质押请求有唯一的 nonce（64 位无符号整数）
   - 新 nonce 必须大于 `last_nonce`（递增判断）
   - 如果 nonce <= `last_nonce`，视为重放攻击，拒绝处理
   - Nonce 溢出处理：当达到 `u64::MAX` 时，重置为 0
2. **区块高度验证**：事件中包含 block_height，可用于额外验证

### 多签阈值

- 阈值计算：`Math.ceil(relayer_count * 2 / 3)`
- 需要超过 2/3 的 relayer 签名才能解锁
- 最多支持 18 个 relayer，阈值范围：2-13

### 权限控制

- 管理员权限：初始化、配置、relayer 管理
- Relayer 权限：只能提交签名
- 用户权限：只能调用质押接口

### 账户安全

- 使用 PDA 确保账户所有权
- 解锁后可以关闭 CrossChainRequest 账户回收租金
- Nonce 递增判断确保不会重放已处理的请求

---

## 性能考虑

### Solana 账户大小优化

- ReceiverState 主账户：~708 bytes（固定大小）
- CrossChainRequest PDA：~600+ bytes（固定大小，每个请求独立账户）
- 支持无限 nonce（每个 nonce 独立账户）
- 支持至少 100 个未完成的请求同时存在

### 查询优化

- `last_nonce` 使用单值存储，O(1) 查找
- Nonce 递增判断：O(1) 比较操作
- `signed_relayers` 使用 Vec 存储，O(n) 查找（n <= 18）

### 成本考虑

- 每个 CrossChainRequest PDA 账户需要租金（约 0.001 SOL）
- 解锁后可以关闭账户回收租金
- 建议定期清理已解锁的账户

---

## 扩展性

### 未来优化方向

1. **使用位图压缩**：如果 relayer 数量固定，可以使用位图跟踪签名状态
2. **批量清理**：定期批量关闭已解锁的 CrossChainRequest 账户
3. **Nonce 递增判断**：通过 `last_nonce` 实现 O(1) 的重放检查，无需存储历史记录

### 限制说明

- **Relayer 数量**：最多 18 个（由 ReceiverState.relayers Vec 大小决定）
- **Nonce 数量**：理论上无限（每个 nonce 使用独立 PDA）
- **未完成请求数量**：至少支持 100 个（每个请求独立 PDA 账户）
- **签名缓存容量**：至少 1200 个签名（100 个请求 × 18 个 relayer = 1800 个签名）
- **Nonce 类型**：64 位无符号整数（u64），溢出时重置为 0

---

## 变更记录

| 日期 | 变更内容 |
|------|----------|
| 2025-11-14 | 初始设计文档，采用 PDA 方案支持无限请求和 21 个 relayer |
| 2025-11-15 | 重构设计：支持 18 个 relayer；nonce 使用递增判断机制；统一初始化函数；支持 100+ 未完成请求和 1200+ 签名缓存 |


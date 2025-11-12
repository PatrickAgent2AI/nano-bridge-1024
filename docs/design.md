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

由于 Solana 账户大小限制（最大 10MB，但实际使用中建议不超过 10KB），需要采用 PDA（Program Derived Address）来支持无限请求和最多 21 个 relayer。

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
    pub relayers: Vec<Pubkey>,      // 4 + 32 * 21 = 676 bytes (最多21个relayer)
    pub used_nonces: Vec<u64>,      // 4 + 8 * 1000 = 8004 bytes (最近1000个已使用的nonce)
}
```

**账户大小计算：**
- Base: 120 bytes
- Relayers (21个): 676 bytes
- Used nonces (1000个): 8004 bytes
- **总计: ~8800 bytes** (在 10KB 限制内)

**设计说明：**
- `relayers`: 最多支持 21 个 relayer
- `used_nonces`: 只存储最近 1000 个已使用的 nonce，用于快速重放检查
- 更早的 nonce 可以通过链上历史记录验证

#### NonceSignature PDA 账户

为每个 nonce 创建独立的 PDA 账户来存储签名记录：

```rust
pub struct NonceSignature {
    pub nonce: u64,                    // 8 bytes
    pub signed_relayers: Vec<Pubkey>,   // 4 + 32 * 21 = 676 bytes (最多21个relayer)
    pub signature_count: u8,            // 1 byte
    pub is_unlocked: bool,              // 1 byte
}
```

**PDA 种子：** `[b"nonce_signature", nonce.to_le_bytes()]`

**账户大小：** ~690 bytes（固定大小，支持最多 21 个 relayer）

**优势：**
- 每个 nonce 独立账户，支持无限 nonce
- 固定大小，易于管理
- 解锁后可以关闭账户回收租金

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

### 发送端合约（Sender Contract）

#### 账户结构

```rust
pub struct SenderState {
    pub vault: Pubkey,
    pub admin: Pubkey,
    pub nonce: u64,
    pub target_contract: Pubkey,
    pub source_chain_id: u64,
    pub target_chain_id: u64,
}
```

#### 主要功能

1. **initialize_sender**: 初始化合约
2. **configure_target**: 配置目标合约和链ID
3. **stake**: 质押代币并触发事件

### 接收端合约（Receiver Contract）

#### 主账户结构

```rust
pub struct ReceiverState {
    pub vault: Pubkey,
    pub admin: Pubkey,
    pub relayer_count: u64,
    pub source_contract: Pubkey,
    pub source_chain_id: u64,
    pub target_chain_id: u64,
    pub relayers: Vec<Pubkey>,      // 最多21个
    pub used_nonces: Vec<u64>,      // 最近1000个
}
```

#### PDA 账户结构

```rust
pub struct NonceSignature {
    pub nonce: u64,
    pub signed_relayers: Vec<Pubkey>,  // 最多21个
    pub signature_count: u8,
    pub is_unlocked: bool,
}
```

#### 主要功能

1. **initialize_receiver**: 初始化合约
2. **configure_source**: 配置源链合约和链ID
3. **add_relayer** / **remove_relayer** / **is_relayer**: Relayer 白名单管理
4. **submit_signature**: 提交签名并检查阈值

#### submit_signature 流程

```
1. 验证 relayer 在白名单中
2. 验证源链合约地址和 chain ID
3. 检查 nonce 是否已使用（查询 ReceiverState.used_nonces）
4. 获取或创建 NonceSignature PDA 账户
5. 检查该 relayer 是否已为此 nonce 签名
6. 记录签名到 NonceSignature.signed_relayers
7. 计算签名数量，检查是否达到阈值（> 2/3 relayer_count）
8. 如果达到阈值：
   - 从金库转账到接收地址
   - 标记 nonce 为已使用（添加到 ReceiverState.used_nonces）
   - 标记 NonceSignature.is_unlocked = true
   - 可选：关闭 NonceSignature 账户回收租金
```

---

## EVM 合约设计

### 发送端合约

与 SVM 发送端合约功能相同，使用 Solidity 实现。

### 接收端合约

使用 mapping 存储签名记录，无大小限制。

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

- 支持最多 21 个 relayer
- 每个 relayer 独立运行
- 阈值：`Math.ceil(relayer_count * 2 / 3)`

---

## 安全考虑

### 防重放攻击

1. **Nonce 机制**：每个质押请求有唯一的 nonce
2. **已使用 nonce 检查**：ReceiverState 存储最近 1000 个已使用的 nonce
3. **区块高度验证**：事件中包含 block_height，可用于额外验证

### 多签阈值

- 阈值计算：`Math.ceil(relayer_count * 2 / 3)`
- 需要超过 2/3 的 relayer 签名才能解锁
- 最多支持 21 个 relayer，阈值范围：2-15

### 权限控制

- 管理员权限：初始化、配置、relayer 管理
- Relayer 权限：只能提交签名
- 用户权限：只能调用质押接口

### 账户安全

- 使用 PDA 确保账户所有权
- 解锁后可以关闭 NonceSignature 账户回收租金
- 定期清理旧的 used_nonces（保留最近 1000 个）

---

## 性能考虑

### Solana 账户大小优化

- ReceiverState 主账户：~8800 bytes（固定大小）
- NonceSignature PDA：~690 bytes（固定大小）
- 支持无限 nonce（每个 nonce 独立账户）

### 查询优化

- `used_nonces` 使用 Vec 存储，O(n) 查找（n <= 1000）
- 对于更早的 nonce，可以通过链上历史记录验证
- `signed_relayers` 使用 Vec 存储，O(n) 查找（n <= 21）

### 成本考虑

- 每个 NonceSignature PDA 账户需要租金（约 0.001 SOL）
- 解锁后可以关闭账户回收租金
- 建议定期清理已解锁的账户

---

## 扩展性

### 未来优化方向

1. **使用位图压缩**：如果 relayer 数量固定，可以使用位图跟踪签名状态
2. **批量清理**：定期批量关闭已解锁的 NonceSignature 账户
3. **历史记录验证**：对于超过 1000 个的 nonce，通过链上历史记录验证

### 限制说明

- **Relayer 数量**：最多 21 个（由 ReceiverState.relayers Vec 大小决定）
- **Nonce 数量**：理论上无限（每个 nonce 使用独立 PDA）
- **已使用 nonce 跟踪**：最近 1000 个（由 ReceiverState.used_nonces Vec 大小决定）

---

## 变更记录

| 日期 | 变更内容 |
|------|----------|
| 2025-11-14 | 初始设计文档，采用 PDA 方案支持无限请求和 21 个 relayer |


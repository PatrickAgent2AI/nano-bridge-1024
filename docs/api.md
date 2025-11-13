# API 文档

## 目录

- [API 概览](#api-概览)
- [智能合约 API](#智能合约-api)
  - [发送端合约 API](#发送端合约-api)
  - [接收端合约 API](#接收端合约-api)
- [Relayer 服务 API](#relayer-服务-api)
- [模块间调用规约](#模块间调用规约)
- [数据结构](#数据结构)
- [配置参数](#配置参数)

---

## API 概览

### 智能合约 API 总览表

| 模块 | 类别 | 接口名称 | 权限 | 主要参数 | 返回值/输出 | 功能效果 |
|------|------|----------|------|----------|-------------|----------|
| 统一合约 | 初始化 | `initialize` | `onlyAdmin` | `vaultAddress`(PDA), `adminAddress`(多签) | 无 | 统一初始化发送端和接收端合约，设置共享PDA金库和多签管理员地址 |
| 统一合约 | 配置 | `configure_usdc` | `onlyAdmin` | `usdcAddress` | 无 | 配置USDC代币地址（SVM为mint account，EVM为合约地址） |
| 统一合约 | 配置 | `configure_peer` | `onlyAdmin` | `peerContract`, `sourceChainId`, `targetChainId` | 无 | 统一配置对端合约和链ID（同时配置发送端和接收端） |
| 发送端合约 | 质押 | `stake` | 公开 | `amount`, `receiverAddress` | `nonce` | 质押USDC，触发`StakeEvent`事件，nonce自动递增 |
| 接收端合约 | 白名单管理 | `addRelayer` | `onlyAdmin` | `relayerAddress` | 无 | 添加Relayer到白名单 |
| 接收端合约 | 白名单管理 | `removeRelayer` | `onlyAdmin` | `relayerAddress` | 无 | 从白名单移除Relayer |
| 接收端合约 | 白名单查询 | `isRelayer` | 公开（view） | `relayerAddress` | `bool` | 查询地址是否为Relayer |
| 接收端合约 | 白名单查询 | `getRelayerCount` | 公开（view） | 无 | `uint256` | 查询当前Relayer数量 |
| 接收端合约 | 签名验证 | `submitSignature` | `onlyWhitelistedRelayer` | `eventData`, `signature` | 无 | 提交签名，达到阈值后解锁代币 |
| 接收端合约 | 流动性管理 | `addLiquidity` | `onlyAdmin` | `amount` | 无 | 从多签钱包向PDA金库增加流动性 |
| 接收端合约 | 流动性管理 | `withdrawLiquidity` | `onlyAdmin` | `amount` | 无 | 从PDA金库向多签钱包提取流动性 |

### Relayer 服务 API 总览表

| 模块 | 类别 | 功能名称 | 权限 | 主要参数 | 输出 | 功能效果 |
|------|------|----------|------|----------|------|----------|
| Relayer服务 | 事件监听 | 监听`StakeEvent` | 无 | 无 | 事件数据 | 监听发送端链的质押事件 |
| Relayer服务 | 签名转发 | `processEvent` | 内部 | `eventData` | 交易哈希 | 验证事件、生成签名并提交到接收端合约 |

### 事件总览表

| 模块 | 事件名称 | 触发条件 | 事件参数 | 用途 |
|------|----------|----------|----------|------|
| 发送端合约 | `StakeEvent` | 用户调用`stake` | `sourceContract`, `targetContract`, `chainId`, `blockHeight`, `amount`, `receiverAddress`, `nonce` | 通知Relayer处理跨链转账 |

### 数据结构总览表

| 数据结构 | 用途 | 字段 | 说明 |
|----------|------|------|------|
| `StakeEventData` | 质押事件数据 | `sourceContract`, `targetContract`, `chainId`, `blockHeight`, `amount`, `receiverAddress`, `nonce` | 跨链转账的完整事件数据 |

### 配置参数总览表

| 配置项 | 测试网 | 主网 | 说明 |
|--------|--------|------|------|
| Arbitrum RPC | `https://sepolia-rollup.arbitrum.io/rpc` | `https://arb1.arbitrum.io/rpc` | Arbitrum网络RPC端点 |
| 1024chain RPC | `https://testnet-rpc.1024chain.com/rpc/` | 待配置 | 1024chain网络RPC端点 |
| Arbitrum Chain ID | 421614 | 42161 | 链标识符 |
| 1024chain Chain ID | 91024 | 待确认 | 链标识符 |
| Relayer数量 | ≥ 3，最多18个 | ≥ 3，最多18个 | 中继节点数量 |
| 签名阈值 | > 2/3 * relayer总数 | > 2/3 * relayer总数 | 解锁所需签名比例 |
| 未完成请求 | 至少100个 | 至少100个 | 同时支持的未完成跨链请求数量 |
| 签名缓存 | 至少1200个 | 至少1200个 | 同时缓存的relayer签名数量（100请求×18relayer） |

---

## 智能合约 API

### 统一初始化 API（SVM）

**重要变更：** 在 Solana (SVM) 平台上，发送端和接收端合约的初始化合并为一个 `initialize` 指令。

#### 统一初始化

```
function initialize(
    address vaultAddress,      // 质押金库地址（发送端和接收端共享）
    address adminAddress       // 管理员钱包地址（发送端和接收端共享）
) onlyAdmin
```

**参数说明：**
- `vaultAddress`：PDA 金库地址（发送端和接收端共享同一个金库），由程序控制，支持自动转账
- `adminAddress`：多签钱包地址（发送端和接收端共享同一个管理员），用于管理操作

**权限：** 仅管理员可调用

**功能描述：**
1. 同时创建 `SenderState` 和 `ReceiverState` 账户
2. 创建 PDA 金库（vault）和对应的 token account
3. 初始化发送端 nonce 为 0
4. 初始化接收端 last_nonce 为 0
5. 设置共享的 vault（PDA）和 admin（多签钱包）地址

**注意事项：**
- `vaultAddress` 必须是 PDA 地址，种子为 `[b"vault"]`
- `adminAddress` 可以是多签钱包地址，合约只验证签名
- 多签投票在外部（Squad 程序）处理，合约不关心多签逻辑

#### 配置USDC代币地址

```
function configure_usdc(
    address usdcAddress        // USDC代币地址
) onlyAdmin
```

**参数说明：**
- `usdcAddress`：USDC代币地址
  - **SVM端**：USDC的SPL Token mint account地址（Pubkey）
  - **EVM端**：USDC的ERC20合约地址（address）

**权限：** 仅管理员可调用

**功能描述：**
1. 同时配置发送端和接收端的 `usdc_mint` 字段
2. 因为两端使用同一个USDC代币，所以共享相同的地址
3. 必须在调用 `stake` 或 `submit_signature` 之前配置

**注意事项：**
- 不同网络（测试网/主网）的USDC地址不同，需要根据部署网络正确配置
- 配置后，所有质押和解锁操作都将使用该USDC地址
- **必须在调用 `stake` 或 `submit_signature` 之前配置，否则这些函数会返回错误**

**错误处理：**
- 如果未配置USDC地址，`stake` 和 `submit_signature` 函数会返回错误 "USDC address not configured"
- 可以通过检查 `usdc_mint` 是否为无效地址（如 `Pubkey::default()` 或 `address(0)`）来判断是否已配置

#### 统一对端配置

```
function configure_peer(
    address peerContract,      // 对端合约地址（发送端和接收端共享同一个对端）
    uint256 sourceChainId,     // 自己的 chain id
    uint256 targetChainId      // 对端的 chain id
) onlyAdmin
```

**参数说明：**
- `peerContract`：对端合约地址（发送端和接收端共享同一个对端，所以只需要一个地址）
- `sourceChainId`：当前链的 chain id
- `targetChainId`：对端链的 chain id

**权限：** 仅管理员可调用

**功能描述：**
1. 同时配置发送端的 `target_contract`、`source_chain_id`、`target_chain_id`
2. 同时配置接收端的 `source_contract`、`source_chain_id`、`target_chain_id`
3. 因为对端是同一个，所以两个配置共享相同的参数

### 发送端合约 API

#### 质押接口

```
function stake(
    uint256 amount,            // 质押数量
    string memory receiverAddress  // 接收端地址
) returns (uint256 nonce)
```

**参数说明：**
- `amount`：质押的 USDC 数量
- `receiverAddress`：接收端链上的接收地址

**返回值：**
- `nonce`：本次质押的唯一序号

**功能描述：**
1. **验证USDC地址已配置**：如果 `usdc_mint` 未配置（为无效地址），返回错误 "USDC address not configured"
2. 将用户的 USDC 转入质押金库地址（使用配置的 `usdc_mint` 地址）
3. 生成单调递增的 nonce（64位无符号整数）：
   - 当前 nonce = `sender_state.nonce`
   - 新 nonce = `current_nonce + 1`
   - 如果 `new_nonce == 0`（溢出），重置为 0
   - 更新 `sender_state.nonce = new_nonce`
4. 触发质押事件

**错误情况：**
- `USDC address not configured`：USDC地址未配置，需要先调用 `configure_usdc` 函数

#### 质押事件

```
event StakeEvent(
    address indexed sourceContract,    // 发送端合约地址
    address indexed targetContract,    // 接收端合约地址
    uint256 chainId,                   // chain id
    uint256 blockHeight,               // 区块高度
    uint256 amount,                    // 质押数量
    string receiverAddress,            // 接收地址
    uint256 nonce                      // 防重放序号
)
```

**字段说明：**
- `sourceContract`：发送端合约地址（防止伪造事件）
- `targetContract`：接收端合约地址（防止伪造事件）
- `chainId`：链 ID
- `blockHeight`：交易发生时的区块高度（防止重放）
- `amount`：质押的代币数量
- `receiverAddress`：接收端的地址
- `nonce`：单调递增的序号（64位无符号整数），防止重放攻击。当达到最大值时自动重置为0

---

### 接收端合约 API

**注意：** 在 SVM 平台上：
- 接收端合约的初始化已合并到统一的 `initialize` 指令中（见上方"统一初始化 API"）
- 接收端合约的对端配置已合并到统一的 `configure_peer` 指令中（见上方"统一对端配置"）

在 EVM 平台上，接收端合约仍使用独立的 `initialize` 和 `configureSource` 函数。

#### Relayer 白名单管理

##### 添加 Relayer

```
function addRelayer(address relayerAddress) onlyAdmin
```

**参数说明：**
- `relayerAddress`：要添加的 relayer 公钥地址

**权限：** 仅管理员可调用

##### 移除 Relayer

```
function removeRelayer(address relayerAddress) onlyAdmin
```

**参数说明：**
- `relayerAddress`：要移除的 relayer 公钥地址

**权限：** 仅管理员可调用

##### 查询 Relayer

```
function isRelayer(address relayerAddress) view returns (bool)
```

**参数说明：**
- `relayerAddress`：要查询的地址

**返回值：**
- `bool`：该地址是否在白名单中

```
function getRelayerCount() view returns (uint256)
```

**返回值：**
- `uint256`：当前白名单中的 relayer 数量

#### 接收 Relayer 消息

```
function submitSignature(
    StakeEventData memory eventData,  // 质押事件数据
    bytes memory signature            // relayer 对事件 hash 的签名
) onlyWhitelistedRelayer
```

**参数说明：**

`StakeEventData` 结构：
```
struct StakeEventData {
    address sourceContract;
    address targetContract;
    uint256 chainId;
    uint256 blockHeight;
    uint256 amount;
    string receiverAddress;
    uint256 nonce;
}
```

- `eventData`：质押事件的完整数据
- `signature`：relayer 使用私钥对事件数据 hash 的签名

**权限：** 仅白名单中的 relayer 可调用

**功能描述：**
1. 验证调用者在 relayer 白名单中
2. **验证USDC地址已配置**：如果 `usdc_mint` 未配置（为无效地址），返回错误 "USDC address not configured"
3. **验证源链合约地址正确**（与配置的 sourceContract 匹配）
4. **验证 chain id 正确**（与配置的 sourceChainId 匹配）
5. 验证签名的合法性
6. **检查 nonce 是否递增**：
   - 如果 `nonce <= last_nonce`，拒绝（重放攻击）
   - 如果 `nonce > last_nonce`，继续处理
7. 获取或创建 `CrossChainRequest` PDA 账户（为每个请求创建独立账户）
8. 检查该 relayer 是否已为此 nonce 签名
9. 记录该 relayer 的签名到 `CrossChainRequest.signed_relayers`
10. 如果合法签名数量达到阈值（> 2/3 白名单大小），则执行解锁操作
11. 解锁操作：从金库向接收地址转账等量 USDC（使用配置的 `usdc_mint` 地址）
12. 更新 `last_nonce = nonce`（标记为已使用），防止重放

**错误情况：**
- `USDC address not configured`：USDC地址未配置，需要先调用 `configure_usdc` 函数

#### 流动性管理

##### 增加流动性

```
function addLiquidity(uint256 amount) onlyAdmin
```

**参数说明：**
- `amount`：要增加的 USDC 数量

**权限：** 仅管理员（多签钱包）可调用

**功能描述：**
1. 从多签钱包（admin）的 token account 转账到 PDA 金库的 token account
2. 增加金库的流动性，用于支持跨链解锁操作
3. 需要多签钱包签名（外部处理多签逻辑）

**注意事项：**
- 多签钱包需要先有足够的 USDC 余额
- 多签钱包需要创建对应的 token account
- 合约层面只验证 admin 签名，不关心多签逻辑

##### 提取流动性

```
function withdrawLiquidity(uint256 amount) onlyAdmin
```

**参数说明：**
- `amount`：要提取的 USDC 数量

**权限：** 仅管理员（多签钱包）可调用

**功能描述：**
1. 从 PDA 金库的 token account 转账到多签钱包（admin）的 token account
2. 使用 PDA 作为 authority，无需外部签名
3. 提取金库的流动性，用于资金管理
4. 需要多签钱包签名（外部处理多签逻辑）

**注意事项：**
- 确保金库有足够的余额
- 提取后可能影响跨链解锁能力
- 合约层面只验证 admin 签名，不关心多签逻辑

**使用示例：**

```typescript
// 1. 创建 Squad 多签账户
const squad = new Squad(provider);
const multisig = await squad.createMultisig({
  threshold: 2,
  members: [admin1, admin2, admin3],
});

// 2. 初始化合约（使用多签钱包作为 admin）
await program.methods
  .initialize()
  .accounts({
    admin: multisig.publicKey,  // 多签钱包地址
    vault: vaultPda,  // PDA 金库地址
    // ...
  })
  .rpc();  // 需要多签成员签名（外部处理）

// 3. 增加流动性（从多签钱包到 PDA 金库）
await program.methods
  .addLiquidity(amount)
  .accounts({
    admin: multisig.publicKey,
    adminTokenAccount: multisigTokenAccount,
    vaultTokenAccount: vaultTokenAccountPda,
    // ...
  })
  .rpc();  // 需要多签成员签名（外部处理）

// 4. 提取流动性（从 PDA 金库到多签钱包）
await program.methods
  .withdrawLiquidity(amount)
  .accounts({
    admin: multisig.publicKey,
    adminTokenAccount: multisigTokenAccount,
    vaultTokenAccount: vaultTokenAccountPda,
    // ...
  })
  .rpc();  // 需要多签成员签名（外部处理）

// 5. 解锁操作（使用 PDA，自动执行）
// 当达到阈值后，合约自动从 PDA 金库转账
// 无需多签投票，快速执行
```

**Squad 多签程序信息：**
- 程序地址：`SMPLecH534NA9acB4bMolv7X6RBpK4rjn3LkN1gZXYjy`
- 主要功能：创建多签账户、提案和投票、执行提案
- 多签投票在外部处理，合约不关心多签逻辑

---

## Relayer 服务 API

### 监听功能

Relayer 需要监听发送端链的质押事件：

```
监听事件: StakeEvent
来源: 发送端合约
```

**监听逻辑：**
- 连接到发送端链的 RPC 节点
- 订阅发送端合约的 `StakeEvent` 事件
- 获取事件的完整数据

### 签名转发功能

```
function processEvent(eventData: StakeEventData)
```

**处理流程：**
1. 接收到 `StakeEvent` 事件数据
2. **验证消息正确性：**
   - 验证来自正确的发送端合约地址
   - 验证 chain id 正确
   - 验证 nonce 未被使用
3. 对事件数据进行 hash 计算
4. 使用 relayer 的私钥对 hash 进行签名
5. 调用接收端合约的 `submitSignature` 接口
6. 传入事件数据和签名

**验证规则：**
- `sourceContract`：必须匹配配置中的发送端合约地址
- `chainId`：必须匹配配置中的发送端链 ID
- `nonce`：检查本地缓存，确保 nonce 大于已处理的最大 nonce（可选，接收端合约也会通过递增判断验证）

---

## 模块间调用规约

### 用户 → 发送端合约

```
用户调用: stake(amount, receiverAddress)
触发事件: StakeEvent
```

### 发送端合约 → Relayer（事件监听）

```
发送端合约触发: StakeEvent
Relayer 监听: 获取事件数据
```

### Relayer → 接收端合约

```
Relayer 调用: submitSignature(eventData, signature)
接收端验证: 签名合法性、nonce 有效性
接收端执行: 达到阈值后解锁代币
```

### 管理员 → 接收端合约

```
管理员（多签钱包）调用: addRelayer(relayerAddress)
管理员（多签钱包）调用: removeRelayer(relayerAddress)
管理员（多签钱包）调用: addLiquidity(amount)
管理员（多签钱包）调用: withdrawLiquidity(amount)
管理员查询: isRelayer(relayerAddress)
管理员查询: getRelayerCount()
```

**注意：** 所有管理接口使用多签钱包（Squad）调用，合约层面只验证签名，不关心多签逻辑。多签投票在外部处理。

---

## 数据结构

### Solana 账户设计

#### ReceiverState 主账户

存储固定大小的配置数据，支持最多 18 个 relayer：

```rust
pub struct ReceiverState {
    pub vault: Pubkey,              // 32 bytes
    pub admin: Pubkey,              // 32 bytes
    pub relayer_count: u64,         // 8 bytes
    pub source_contract: Pubkey,    // 32 bytes
    pub source_chain_id: u64,       // 8 bytes
    pub target_chain_id: u64,       // 8 bytes
    pub relayers: Vec<Pubkey>,      // 4 + 32 * 18 = 580 bytes
    pub last_nonce: u64,            // 8 bytes (用于nonce递增判断)
}
```

**账户大小：** ~708 bytes（在 10KB 限制内）

**设计说明：**
- `relayers`: 最多支持 18 个 relayer
- `last_nonce`: 记录最后一个已使用的 nonce，用于判断新 nonce 是否递增
- Nonce 使用 64 位无符号整数（u64），通过递增判断来防止重放攻击

#### CrossChainRequest PDA 账户

为每个跨链请求（nonce）创建独立的 PDA 账户来存储 relayer 签名缓存：

```rust
pub struct CrossChainRequest {
    pub nonce: u64,                    // 8 bytes
    pub signed_relayers: Vec<Pubkey>,   // 4 + 32 * 18 = 580 bytes
    pub signature_count: u8,            // 1 byte
    pub is_unlocked: bool,              // 1 byte
    pub event_data: StakeEventData,     // 事件数据（用于验证和转账）
}
```

**PDA 种子：** `[b"cross_chain_request", nonce.to_le_bytes()]`  
**账户大小：** ~600+ bytes（固定大小）

**设计优势：**
- **支持至少 100 个未完成的请求**：每个请求独立账户，可同时存在 100+ 个未完成的请求
- **支持 1200 个签名缓存**：100 个请求 × 18 个 relayer = 1800 个签名（超过要求的 1200 个）
- 支持理论上无限次请求（每个 nonce 独立账户）
- 支持最多 18 个 relayer
- 固定大小，易于管理
- 解锁后可以关闭账户回收租金

### 质押事件 Hash 计算

```
hash = keccak256(abi.encodePacked(
    sourceContract,
    targetContract,
    chainId,
    blockHeight,
    amount,
    receiverAddress,
    nonce
))
```

### 签名验证

使用标准的 ECDSA 签名验证：

```
recoveredAddress = ecrecover(hash, signature)
require(isRelayer(recoveredAddress), "Invalid signature")
```

---

## 配置参数

### 网络配置

- **Arbitrum Sepolia RPC**: `https://sepolia-rollup.arbitrum.io/rpc`
- **1024chain Testnet RPC**: https://testnet-rpc.1024chain.com/rpc/

- **Arbitrum Mainnet RPC**: `https://arb1.arbitrum.io/rpc`
- **1024chain Mainnet RPC**: （待配置）

### Chain ID

- **Arbitrum Sepolia**: 421614
- **Arbitrum Mainnet**: 42161
- **1024chain Testnet**: （待确认）
- **1024chain Mainnet**: （待确认）

### 合约地址

根据部署网络进行配置：
- 发送端合约地址
- 接收端合约地址
- 质押金库地址（EVM）
- 质押金库地址（SVM）
- 管理员地址（EVM）
- 管理员地址（SVM）

### USDC代币地址配置

**SVM端（1024chain）：**
- USDC mint account地址：需要在部署时配置，通过 `configure_usdc` 函数设置
- 测试网USDC mint地址：待确认
- 主网USDC mint地址：待确认

**EVM端（Arbitrum）：**
- USDC ERC20合约地址：需要在部署时配置，通过 `configure_usdc` 函数设置
- Arbitrum Sepolia USDC地址：待确认
- Arbitrum Mainnet USDC地址：`0xaf88d065e77c8cC2239327C5EDb3A432268e5831`（参考，需确认）

### Relayer 配置

- Relayer 数量：≥ 3，最多 18 个
- 签名阈值：`Math.ceil(relayer_count * 2 / 3)`
- Relayer 私钥列表：每个 relayer 独立保管

**阈值示例：**
- 3 个 Relayer → 阈值 2
- 4 个 Relayer → 阈值 3
- 5 个 Relayer → 阈值 4
- 18 个 Relayer → 阈值 13

### Nonce 处理

- **Nonce 类型**：64 位无符号整数（u64）
- **Nonce 递增判断**：新 nonce 必须大于 `last_nonce`，否则视为重放攻击
- **Nonce 溢出处理**：当 nonce 达到 `u64::MAX` (18,446,744,073,709,551,615) 时，自动重置为 0
- **未完成请求支持**：至少支持 100 个未完成的跨链请求同时存在
- **签名缓存容量**：至少支持 1200 个签名缓存（100 个请求 × 18 个 relayer = 1800 个签名）

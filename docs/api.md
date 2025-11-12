# API 文档

## 智能合约 API

### 发送端合约 API

#### 初始化

```
function initialize(
    address vaultAddress,      // 质押金库地址
    address adminAddress,      // 管理员钱包地址
    uint256 sourceChainId,     // 自己的 chain id
    uint256 targetChainId      // 对端的 chain id
)
```

**参数说明：**
- `vaultAddress`：存储质押代币的金库地址
- `adminAddress`：具有管理权限的钱包地址
- `sourceChainId`：当前链的 chain id
- `targetChainId`：目标链的 chain id

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
1. 将用户的 USDC 转入质押金库地址
2. 生成单调递增的 nonce
3. 触发质押事件

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
- `nonce`：单调递增的序号，防止重放攻击

---

### 接收端合约 API

#### 初始化

```
function initialize(
    address vaultAddress,      // 质押金库地址
    address adminAddress,      // 管理员钱包地址
    uint256 sourceChainId,     // 对端的 chain id
    uint256 targetChainId      // 自己的 chain id
)
```

**参数说明：**
- `vaultAddress`：存储待解锁代币的金库地址（需要合约有转账权限）
- `adminAddress`：具有管理权限的钱包地址
- `sourceChainId`：源链的 chain id
- `targetChainId`：当前链的 chain id

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
2. 验证签名的合法性
3. 检查 nonce 是否已被使用
4. 记录该 relayer 的签名
5. 如果合法签名数量达到阈值（> 2/3 白名单大小），则执行解锁操作
6. 解锁操作：从金库向接收地址转账等量 USDC
7. 标记 nonce 为已使用，防止重放

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
- `nonce`：检查本地缓存，确保未处理过该 nonce（可选，接收端合约也会验证）

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
管理员调用: addRelayer(relayerAddress)
管理员调用: removeRelayer(relayerAddress)
管理员查询: isRelayer(relayerAddress)
管理员查询: getRelayerCount()
```

---

## 数据结构

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

### Relayer 配置

- Relayer 数量：≥ 3
- 签名阈值：> 2/3 * relayer 总数
- Relayer 私钥列表：每个 relayer 独立保管

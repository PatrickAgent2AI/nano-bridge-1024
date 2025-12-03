# 交易证明设计文档

## 概述

本文档设计了两段式跨链桥的交易证明机制，用于防止前端代码被篡改后跳过第一步跨链直接调用第二步的安全漏洞。

## 安全目标

1. **防止跳过第一步**：确保用户必须完成第一步跨链才能执行第二步
2. **防止重放攻击**：每个证明只能使用一次
3. **防止金额篡改**：确保第二步的金额与第一步匹配
4. **防止时间攻击**：证明有合理的有效期
5. **防止交易哈希被抢用**：只有执行第一步交易的用户才能生成有效证明（通过签名机制）

---

## Deposit 方向：任意链 → Arbitrum → 1024chain

### 流程概述

```
用户钱包（源链代币）
  ↓ [第一步：LiFi SDK 跨链]
Broker 中转钱包（Arbitrum USDC）
  ↓ [第二步：Broker EVM Gateway Service + 交易证明验证]
EVM Stake 合约（Arbitrum）
```

### 交易证明设计

#### 方案1：链上交易验证 + 用户签名（推荐）⭐

**核心思想**：
1. 验证链上交易确实存在且由用户发起
2. 用户使用私钥对证明内容签名，确保只有执行第一步交易的用户才能生成有效证明
3. 双重验证：既验证链上交易，又验证用户签名

**证明数据结构：**
```typescript
interface DepositProof {
  // 第一步跨链的交易信息
  sourceChainId: number;           // 源链ID
  sourceTxHash: string;            // 源链交易哈希（第一步LiFi跨链的最终交易哈希）
  sourceTokenAddress: string;       // 源链代币地址
  sourceAmount: string;            // 源链代币金额（最小单位）
  
  // 目标信息
  targetChainId: number;           // 目标链ID（Arbitrum = 42161）
  targetTokenAddress: string;      // 目标代币地址（Arbitrum USDC）
  targetAmount: string;            // 目标USDC金额（最小单位，从LiFi返回）
  
  // 地址信息
  fromAddress: string;             // 用户源链地址（必须与交易from地址匹配）
  toAddress: string;                // Broker中转钱包地址（Arbitrum）
  target1024Address: string;        // 1024chain接收地址
  
  // 时间戳
  timestamp: number;                // 第一步完成的时间戳（Unix时间戳，秒）
  
  // 可选：LiFi Route ID（用于额外验证）
  lifiRouteId?: string;             // LiFi SDK返回的route ID
  
  // 🔐 用户签名（关键安全机制）
  userSignature: string;            // 用户使用Arbitrum地址的私钥对证明内容签名（EIP-191格式）
}
```

**验证流程：**

1. **前端生成证明**（在第一步完成后）：
   ```typescript
   import { signMessage } from 'viem';
   
   // 第一步完成后，从LiFi SDK获取交易信息
   const proofData = {
     sourceChainId: selectedChainId,
     sourceTxHash: finalStep.execution.process[finalStep.execution.process.length - 1].txHash,
     sourceTokenAddress: selectedTokenAddress,
     sourceAmount: quote.action.fromAmount,
     targetChainId: ARB_CHAIN_ID,
     targetTokenAddress: ARB_USDC_ADDRESS,
     targetAmount: finalExecution.toAmount, // 实际收到的USDC金额
     fromAddress: sourceAddress,
     toAddress: BROKER_TRANSIT_WALLET_ADDRESS, // Broker中转钱包地址
     target1024Address: target1024Address,
     timestamp: Math.floor(Date.now() / 1000),
     lifiRouteId: result.id,
   };
   
   // 🔐 关键步骤：用户使用钱包对证明内容签名
   // 注意：使用钱包SDK，不需要私钥，更安全
   const messageToSign = JSON.stringify(proofData, Object.keys(proofData).sort());
   
   // 使用 wagmi 的 useSignMessage hook（会弹出MetaMask签名确认）
   const userSignature = await signMessageAsync({ message: messageToSign });
   
   const proof: DepositProof = {
     ...proofData,
     userSignature, // 包含用户签名
   };
   ```

2. **Broker服务验证证明**：
   ```rust
   // 伪代码
   async fn verify_deposit_proof(proof: &DepositProof) -> Result<()> {
       // 1. 验证时间戳（防止过期证明，例如1小时内有效）
       let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs();
       if now - proof.timestamp > 3600 {
           return Err("Proof expired");
       }
       
       // 2. 🔐 验证用户签名（关键安全机制）
       // 重建签名消息（与前端一致）
       let mut proof_data = proof.clone();
       let signature = proof_data.user_signature.clone();
       proof_data.user_signature = String::new(); // 移除签名字段
       
       // 序列化证明数据（按字段名排序，与前端一致）
       let message = serde_json::to_string(&proof_data)?;
       
       // 使用ecrecover验证签名
       let message_hash = keccak256(message.as_bytes());
       let eth_signed_hash = keccak256(
           format!("\x19Ethereum Signed Message:\n{}", message.len()).as_bytes()
           .iter()
           .chain(message_hash.iter())
           .copied()
           .collect::<Vec<u8>>()
       );
       
       // 从签名中恢复地址
       let recovered_address = ecrecover_from_signature(&signature, &eth_signed_hash)?;
       
       // 验证恢复的地址是否与proof中的fromAddress匹配
       // 注意：这里验证的是Arbitrum地址，因为最终交易在Arbitrum上
       // 如果源链不是Arbitrum，需要验证Arbitrum地址是否与源链地址对应
       // （可以通过查询LiFi交易的路由信息来验证）
       if recovered_address.to_lowercase() != proof.fromAddress.to_lowercase() {
           // 如果源链不是Arbitrum，需要额外验证
           // 可以通过查询Arbitrum链上的最终交易来验证from地址
           // 这里简化处理，假设fromAddress是Arbitrum地址
           return Err("Signature address mismatch");
       }
       
       // 3. 验证源链交易哈希（Arbitrum链上的最终交易）
       let arb_rpc_url = get_rpc_url(ARB_CHAIN_ID);
       let arb_provider = Provider::new(Http::new(arb_rpc_url));
       
       let tx_hash: H256 = proof.sourceTxHash.parse()?;
       let tx = arb_provider.get_transaction(tx_hash).await?
           .ok_or("Transaction not found")?;
       
       // 4. 验证交易的from地址是否与签名地址匹配
       if tx.from.to_lowercase() != recovered_address.to_lowercase() {
           return Err("Transaction from address does not match signature");
       }
       
       // 5. 获取交易receipt
       let receipt = arb_provider.get_transaction_receipt(tx_hash).await?
           .ok_or("Transaction receipt not found")?;
       
       // 6. 验证交易状态
       if receipt.status != Some(1.into()) {
           return Err("Transaction failed");
       }
       
       // 7. 验证交易时间（与timestamp匹配，允许一定误差）
       let tx_block = arb_provider.get_block(receipt.block_number.unwrap()).await?;
       let tx_timestamp = tx_block.timestamp.as_u64();
       if (tx_timestamp as i64 - proof.timestamp as i64).abs() > 300 {
           return Err("Timestamp mismatch");
       }
       
       // 8. 验证转账金额和地址
       // 解析receipt中的Transfer事件（ERC20 Transfer事件）
       let transfer_event = parse_transfer_event(&receipt.logs)?;
       
       // 验证：from地址是用户地址，to地址是Broker中转钱包
       if transfer_event.from.to_lowercase() != proof.fromAddress.to_lowercase() {
           return Err("From address mismatch");
       }
       if transfer_event.to.to_lowercase() != proof.toAddress.to_lowercase() {
           return Err("To address mismatch");
       }
       
       // 验证金额（允许一定误差，因为可能有手续费）
       let received_amount = U256::from_dec_str(&transfer_event.value)?;
       let expected_amount = U256::from_dec_str(&proof.targetAmount)?;
       // 允许1%的误差（考虑滑点和手续费）
       if received_amount < expected_amount * 99 / 100 {
           return Err("Amount mismatch");
       }
       
       // 9. 验证代币地址
       if transfer_event.token_address.to_lowercase() != proof.targetTokenAddress.to_lowercase() {
           return Err("Token address mismatch");
       }
       
       // 10. 防重放：检查该证明是否已被使用
       let proof_id = calculate_proof_id(proof);
       if is_proof_used(&proof_id).await? {
           return Err("Proof already used");
       }
       mark_proof_as_used(&proof_id).await?;
       
       Ok(())
   }
   ```

3. **修改Broker API**：
   ```rust
   #[derive(Debug, Deserialize)]
   struct StakeRequest {
       amount: String,
       target_address: String,
       proof: DepositProof,  // 新增：交易证明
   }
   
   async fn handle_stake(
       State(state): State<AppState>,
       Json(req): Json<StakeRequest>,
   ) -> Result<Json<StakeResponse>, (StatusCode, Json<StakeResponse>)> {
       // 1. 验证交易证明
       verify_deposit_proof(&req.proof).await
           .map_err(|e| {
               (StatusCode::BAD_REQUEST, Json(StakeResponse {
                   success: false,
                   message: format!("Proof verification failed: {}", e),
                   tx_hash: None,
               }))
           })?;
       
       // 2. 验证金额匹配
       if req.amount != req.proof.targetAmount {
           return Err((StatusCode::BAD_REQUEST, Json(StakeResponse {
               success: false,
               message: "Amount mismatch with proof",
               tx_hash: None,
           })));
       }
       
       // 3. 验证目标地址匹配
       if req.target_address != req.proof.target1024Address {
           return Err((StatusCode::BAD_REQUEST, Json(StakeResponse {
               success: false,
               message: "Target address mismatch with proof",
               tx_hash: None,
           })));
       }
       
       // 4. 执行stake（原有逻辑）
       match stake_to_1024chain(&state, &req.amount, &req.target_address).await {
           // ...
       }
   }
   ```

#### 方案2：仅验证交易发送者（备选，安全性较低）

如果不想实现签名机制，可以仅验证交易的发送者：

**验证逻辑：**
```rust
// 从Arbitrum链上的交易中获取from地址
let tx = arb_provider.get_transaction(tx_hash).await?;
let tx_from = tx.from;

// 验证交易的from地址是否与proof中的fromAddress匹配
if tx_from.to_lowercase() != proof.fromAddress.to_lowercase() {
    return Err("Transaction from address mismatch");
}
```

**优点**：实现简单，不需要用户签名
**缺点**：安全性较低，攻击者仍然可以：
1. 监听链上交易
2. 看到交易的from地址
3. 构造相同的fromAddress调用Broker服务

**注意**：此方案不能完全防止攻击，建议使用方案1（签名机制）

---

## Withdraw 方向：1024chain → Arbitrum → 任意链

### 流程概述

```
1024chain 用户地址（USDC）
  ↓ [第一步：SVM Stake 合约]
Broker 中转钱包（Arbitrum USDC）
  ↓ [第二步：Broker Withdraw Gateway Service + 交易证明验证]
用户钱包（目标链目标代币）
```

### 交易证明设计

#### 方案1：链上交易验证 + 用户签名（推荐）⭐

**核心思想**：
1. 验证1024chain交易确实存在且由用户发起
2. 用户使用私钥对证明内容签名，确保只有执行第一步交易的用户才能生成有效证明
3. 双重验证：既验证链上交易，又验证用户签名

**证明数据结构：**
```typescript
interface WithdrawProof {
  // 第一步跨链的交易信息
  sourceChainId: number;           // 源链ID（1024chain）
  sourceTxSignature: string;       // 1024chain交易签名（base58格式）
  sourceTxHash: string;            // 1024chain交易哈希
  sourceBlockHeight: number;       // 1024chain区块高度
  
  // 金额和地址
  amount: string;                  // USDC金额（最小单位）
  receiverAddress: string;         // 1024chain接收地址（用户地址）
  arbitrumAddress: string;         // Arbitrum接收地址（用户地址）
  
  // 目标信息
  targetChainId: number;           // 目标链ID
  targetAsset: string;             // 目标代币地址
  recipientAddress: string;         // 目标链接收地址
  
  // 时间戳
  timestamp: number;                // 第一步完成的时间戳
  nonce: number;                    // 1024chain stake交易的nonce
  
  // 🔐 用户签名（关键安全机制）
  userSignature: string;            // 用户使用1024chain地址的私钥对证明内容签名（Ed25519格式）
}
```

**验证流程：**

1. **前端生成证明**（在第一步完成后）：
   ```typescript
   import { sign } from '@noble/ed25519';
   import bs58 from 'bs58';
   
   // 第一步：用户在1024chain上调用stake合约
   // 从交易结果中获取信息
   const stakeResult = await program.methods
     .stake(new BN(amount), arbitrumAddress)
     .accounts({...})
     .rpc();
   
   const proofData = {
     sourceChainId: 1024,
     sourceTxSignature: stakeResult.signature, // Solana交易签名
     sourceTxHash: stakeResult.txHash,
     sourceBlockHeight: stakeResult.blockHeight,
     amount: amount.toString(),
     receiverAddress: walletAddress, // 1024chain地址
     arbitrumAddress: arbitrumAddress,
     targetChainId: targetChainId,
     targetAsset: targetAsset,
     recipientAddress: recipientAddress,
     timestamp: Math.floor(Date.now() / 1000),
     nonce: stakeResult.nonce,
   };
   
   // 🔐 关键步骤：用户使用钱包对证明内容签名
   // 注意：使用钱包SDK，不需要私钥，更安全
   const messageToSign = JSON.stringify(proofData, Object.keys(proofData).sort());
   const messageBytes = new TextEncoder().encode(messageToSign);
   
   // 使用 @solana/wallet-adapter 的 signMessage（会弹出Phantom签名确认）
   if (!wallet.signMessage) {
     throw new Error('Wallet does not support message signing');
   }
   const signatureBytes = await wallet.signMessage(messageBytes);
   const userSignature = bs58.encode(signatureBytes);
   
   const proof: WithdrawProof = {
     ...proofData,
     userSignature, // 包含用户签名
   };
   ```

2. **Broker服务验证证明**：
   ```rust
   // 伪代码
   async fn verify_withdraw_proof(proof: &WithdrawProof) -> Result<()> {
       // 1. 验证时间戳
       let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs();
       if now - proof.timestamp > 3600 {
           return Err("Proof expired");
       }
       
       // 2. 验证1024chain交易
       let solana_rpc = get_solana_rpc_url();
       let client = RpcClient::new(solana_rpc);
       
       // 获取交易
       let tx_signature = Signature::from_str(&proof.sourceTxSignature)?;
       let tx = client.get_transaction(&tx_signature, GetTransactionConfig {
           encoding: Some(UiTransactionEncoding::Json),
           max_supported_transaction_version: Some(0),
           ..Default::default()
       }).await?
           .ok_or("Transaction not found")?;
       
       // 3. 验证交易状态
       if tx.meta.as_ref().and_then(|m| m.err).is_some() {
           return Err("Transaction failed");
       }
       
       // 4. 验证区块高度
       let tx_slot = tx.slot;
       let current_slot = client.get_slot().await?;
       if current_slot - tx_slot > 150 { // 约1小时（假设每2秒一个slot）
           return Err("Transaction too old");
       }
       
       // 5. 解析交易，验证StakeEvent事件
       // 从交易日志中解析StakeEvent
       let stake_event = parse_stake_event_from_transaction(&tx)?;
       
       // 验证金额
       if stake_event.amount.to_string() != proof.amount {
           return Err("Amount mismatch");
       }
       
       // 验证接收地址（应该是Broker中转钱包在1024chain上的地址）
       if stake_event.receiver_address != BROKER_1024CHAIN_ADDRESS {
           return Err("Receiver address mismatch");
       }
       
       // 验证nonce
       if stake_event.nonce != proof.nonce {
           return Err("Nonce mismatch");
       }
       
       // 6. 🔐 验证用户签名（关键安全机制）
       // 重建签名消息（与前端一致）
       let mut proof_data = proof.clone();
       let signature_bytes = proof_data.user_signature.clone();
       proof_data.user_signature = String::new(); // 移除签名字段
       
       // 序列化证明数据（按字段名排序，与前端一致）
       let message = serde_json::to_string(&proof_data)?;
       let message_bytes = message.as_bytes();
       
       // 使用Ed25519验证签名
       let signature = bs58::decode(&signature_bytes)?;
       let public_key = bs58::decode(&proof.receiver_address)?; // 1024chain地址就是公钥
       
       // 验证签名
       if !ed25519_dalek::verify(&message_bytes, &signature, &public_key) {
           return Err("Invalid user signature");
       }
       
       // 7. 验证交易签名者（从交易中获取）
       let signers = tx.transaction.signatures;
       if signers.is_empty() {
           return Err("No signers");
       }
       
       // 验证交易的主要签名者是否是proof中的receiverAddress
       // Solana交易中，第一个签名者是交易发起者
       let primary_signer = signers[0];
       if primary_signer.to_string() != proof.receiver_address {
           return Err("Transaction signer does not match receiver address");
       }
       
       // 8. 防重放：检查该证明是否已被使用
       let proof_id = calculate_proof_id(proof);
       if is_proof_used(&proof_id).await? {
           return Err("Proof already used");
       }
       mark_proof_as_used(&proof_id).await?;
       
       Ok(())
   }
   ```

3. **修改Broker API**：
   ```typescript
   // Withdraw Gateway Service
   router.post('/', async (req: Request, res: Response) => {
     const { 
       target_chain, 
       target_asset, 
       usdc_amount, 
       recipient_address,
       proof  // 新增：交易证明
     } = req.body;
     
     // 1. 验证交易证明
     try {
       await verifyWithdrawProof(proof);
     } catch (error) {
       return res.status(400).json({
         success: false,
         message: `Proof verification failed: ${error.message}`,
         route_id: null,
         tx_hash: null,
       });
     }
     
     // 2. 验证参数匹配
     if (usdc_amount !== proof.amount) {
       return res.status(400).json({
         success: false,
         message: 'Amount mismatch with proof',
         route_id: null,
         tx_hash: null,
       });
     }
     
     if (target_chain !== proof.targetChainId) {
       return res.status(400).json({
         success: false,
         message: 'Target chain mismatch with proof',
         route_id: null,
         tx_hash: null,
       });
     }
     
     // 3. 执行withdraw（原有逻辑）
     const result = await executeWithdraw({...});
   });
   ```

#### 方案2：事件监听验证（备选）

如果链上验证太复杂，可以使用事件监听：

1. Broker服务监听1024chain的StakeEvent事件
2. 用户提交证明时，Broker检查是否监听到了对应的事件
3. 验证事件的金额、地址、nonce等字段

**优点**：实现相对简单
**缺点**：需要Broker持续监听，可能有延迟

---

## 防重放机制与原子性

### 方案1：Redis缓存 + 原子占用（推荐）

**设计目标**：
- 同一个 `proof_id` **最多只能成功消费一次**
- 在高并发场景下不会因为竞态条件导致重复消费

**证明ID计算**：

```rust
fn calculate_proof_id(proof: &DepositProof) -> String {
    // 使用链ID + 交易哈希作为唯一ID（最简单）
    // 也可以在此基础上加入 targetAddress / amount 等字段做哈希
    format!("{}:{}", proof.sourceChainId, proof.sourceTxHash)
}
```

**原子占用实现（Redis SET NX）**：

```rust
/// 尝试占用 proof_id
/// 返回 true 表示本次请求成功占用（可以继续执行资金操作）
/// 返回 false 表示 proof_id 已经被占用（应直接拒绝处理）
async fn try_consume_proof(proof_id: &str) -> Result<bool> {
    let mut conn = redis_client.get_async_connection().await?;
    let key = format!("proof:used:{}", proof_id);

    // 使用 SET NX EX 实现原子占用 + 过期时间
    // NX: 仅当 key 不存在时才设置
    // EX: 设置过期时间（秒），例如 86400 = 24 小时
    let result: Option<String> = redis::cmd("SET")
        .arg(&key)
        .arg("1")
        .arg("NX")
        .arg("EX")
        .arg(86400) // 24 小时，防止 Redis 内存泄漏
        .query_async(&mut conn)
        .await?;

    Ok(result.is_some()) // Some("OK") 表示首次占用成功，None 表示已存在
}
```

**Broker 中的原子消费流程建议**：

1. **先做所有“便宜”的校验**：
   - 参数格式、链ID白名单、金额范围等
   - 证明结构完整性
   - 时间戳检查
   - 用户签名验证
2. **再做链上查询 / LiFi 状态查询**：
   - 检查交易是否存在且成功
   - 检查确认数是否足够
   - 检查金额 / 地址 / 代币是否匹配
3. **最后一步调用 `try_consume_proof(proof_id)`**：
   - 如果返回 `false`：说明该证明已被消费，直接返回错误 `Proof already used`
   - 只有在返回 `true` 时，才执行资金相关操作（调用 `stake` 或 `withdraw`）

> **关键点**：  
> - 不再使用“先 `is_proof_used` 再 `mark_proof_as_used`”的两步模式，避免竞态  
> - 使用单次 `SET NX` 实现“**谁先占用，谁获权执行**”的原子语义

### 方案2：数据库记录（带唯一约束）

如果使用 PostgreSQL / MySQL 等数据库，也可以通过唯一索引实现一次性消费：

```sql
CREATE TABLE proof_usage (
  proof_id   VARCHAR(255) PRIMARY KEY,
  used_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL
);
```

消费逻辑：

1. 在通过所有校验（签名、链上交易、确认数）后，执行：

```sql
INSERT INTO proof_usage (proof_id, expires_at)
VALUES (:proof_id, NOW() + INTERVAL '24 hours');
```

2. 如果插入成功 → 本次请求是**首个消费者**，可以继续执行资金操作  
3. 如果触发唯一约束错误 → 说明 `proof_id` 已被消费，直接返回 `Proof already used`

可以通过定期任务清理 `expires_at < NOW()` 的记录，控制表大小。

### 方案2：数据库记录

使用PostgreSQL或MySQL记录已使用的证明：
- 表结构：`proof_usage(proof_id, used_at, expires_at)`
- 每次验证前查询，验证后插入
- 定期清理过期记录

---

## 实现优先级

### 高优先级（必须实现）

1. ✅ **Deposit方向：链上交易验证 + 用户签名**
   - 验证Arbitrum链上交易存在且成功
   - 验证交易的from地址
   - **验证用户签名**（防止交易哈希被抢用）
   - 验证金额和地址匹配
   - 防重放机制

2. ✅ **Withdraw方向：链上交易验证 + 用户签名**
   - 验证1024chain交易存在且成功
   - 验证交易的签名者
   - **验证用户签名**（防止交易哈希被抢用）
   - 验证金额和nonce匹配
   - 防重放机制

### 中优先级（建议实现）

3. ⚠️ **时间戳验证**
   - 防止过期证明（1小时有效期）
   - 验证交易时间与证明时间匹配

4. ⚠️ **金额容差处理**
   - 允许一定误差（考虑滑点和手续费）
   - 例如：允许1%的误差

### 低优先级（可选实现）

5. ✅ **用户签名机制**（已实现）
   - 用户对证明数据进行签名
   - 防止交易哈希被抢用
   - 确保只有执行第一步交易的用户才能生成有效证明

6. 💡 **证明加密传输**
   - 使用HTTPS传输证明
   - 防止中间人攻击

---

## 安全考虑

### 1. 时间窗口

- **证明有效期**：建议1小时
- **交易时间验证**：允许5分钟误差（考虑区块确认时间）

### 2. 金额验证

- **容差**：允许1%的误差（考虑滑点和手续费）
- **最小金额**：设置最小金额限制（例如1 USDC）

### 3. 重放攻击防护

- **唯一性**：每个证明只能使用一次
- **过期清理**：定期清理过期的证明记录

### 4. RPC节点安全

- **多节点备份**：使用多个RPC节点，防止单点故障
- **速率限制**：限制RPC调用频率，防止被限流

### 5. 错误处理

- **详细错误信息**：开发环境提供详细错误，生产环境隐藏敏感信息
- **日志记录**：记录所有验证失败的尝试，用于安全审计

---

## 签名机制详解

### 为什么使用钱包SDK而不是私钥？

**安全原则**：
1. ✅ **用户永远不应该在前端输入私钥**
2. ✅ **使用钱包扩展（MetaMask、Phantom等）进行签名**
3. ✅ **私钥始终保存在用户的钱包中，前端代码无法访问**

**钱包SDK支持**：
- **EVM钱包**：MetaMask、WalletConnect、Coinbase Wallet等都支持 `personal_sign`（EIP-191）
- **Solana钱包**：Phantom、Solflare、Backpack等都支持 `signMessage`

### 为什么需要用户签名？

**问题场景**：
1. 用户执行第一步跨链交易，交易哈希上链
2. 攻击者监听链上交易，看到交易哈希
3. 攻击者抢先用这个交易哈希调用Broker服务
4. 如果Broker只验证交易存在，攻击者可以成功

**解决方案**：
- 用户使用私钥对证明内容签名
- Broker验证签名，确保只有拥有私钥的用户才能生成有效证明
- 即使攻击者看到交易哈希，也无法生成有效的签名

### 项目中已有的钱包签名实现

项目中的登录功能已经实现了钱包签名，可以直接复用这个模式：

**EVM钱包签名示例**（来自 `useMultiWalletAuth.ts`）：
```typescript
import { useSignMessage } from 'wagmi';

export function useMultiWalletAuth() {
  const { signMessageAsync: signEVMMessage } = useSignMessage();
  
  const login = async () => {
    const timestamp = Date.now();
    const message = `1024 Exchange - login - ${timestamp}`;
    
    // 🔐 通过钱包签名（会弹出MetaMask等钱包的签名确认）
    const signature = await signEVMMessage({ message });
    
    // signature 格式：0x... (EIP-191标准)
    return signature;
  };
}
```

**Solana钱包签名示例**（来自 `useMultiWalletAuth.ts`）：
```typescript
import { useWallet } from '@solana/wallet-adapter-react';
import bs58 from 'bs58';

export function useMultiWalletAuth() {
  const solanaWallet = useWallet();
  
  const signSolanaMessage = async (message: string) => {
    if (!solanaWallet.signMessage) {
      throw new Error('Wallet does not support signing');
    }
    
    const encodedMessage = new TextEncoder().encode(message);
    
    // 🔐 通过钱包签名（会弹出Phantom等钱包的签名确认）
    const signature = await solanaWallet.signMessage(encodedMessage);
    
    // 转换为base58格式
    return bs58.encode(signature);
  };
}
```

**后端验证示例**（来自 `api/auth/login/route.ts`）：
```typescript
import { verifyMessage } from 'viem';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';

// EVM签名验证
const isValid = await verifyMessage({
  address: wallet_address as `0x${string}`,
  message: message,
  signature: signature as `0x${string}`,
});

// Solana签名验证
const publicKey = new PublicKey(wallet_address);
const messageBytes = new TextEncoder().encode(message);
const signatureBytes = bs58.decode(signature);

const isValid = nacl.sign.detached.verify(
  messageBytes,
  signatureBytes,
  publicKey.toBytes()
);
```

### 签名格式

#### Deposit方向（EVM链）

使用 **EIP-191** 标准签名格式：
```
message = "\x19Ethereum Signed Message:\n" + len(message) + message
hash = keccak256(message)
signature = ecdsa_sign(hash, private_key)
```

**前端实现**（使用钱包SDK）：

**方法1：使用 wagmi（推荐，无需私钥）**
```typescript
import { useSignMessage } from 'wagmi';

function DepositComponent() {
  const { signMessageAsync } = useSignMessage();
  
  // 1. 准备签名消息（移除签名字段）
  const proofData = { ...proof };
  delete proofData.userSignature;
  
  // 2. 序列化（按字段名排序，确保一致性）
  const message = JSON.stringify(proofData, Object.keys(proofData).sort());
  
  // 3. 通过钱包签名（会弹出MetaMask等钱包的签名确认）
  const signature = await signMessageAsync({ message });
  
  proof.userSignature = signature;
}
```

**方法2：使用 viem（需要私钥，仅开发/测试使用）**
```typescript
import { signMessage, privateKeyToAccount } from 'viem/accounts';

// ⚠️ 仅用于开发/测试，生产环境应使用方法1（钱包SDK）
const account = privateKeyToAccount('0x...');
const signature = await account.signMessage({
  message: message,
});
```

**Broker验证**（使用 ethers-rs）：
```rust
use ethers::core::utils::keccak256;
use ethers::prelude::*;

// 1. 重建签名消息
let mut proof_data = proof.clone();
let signature = proof_data.user_signature.clone();
proof_data.user_signature = String::new();

// 2. 序列化
let message = serde_json::to_string(&proof_data)?;

// 3. 应用EIP-191前缀
let message_len = message.len();
let prefix = format!("\x19Ethereum Signed Message:\n{}", message_len);
let message_bytes = [prefix.as_bytes(), message.as_bytes()].concat();
let hash = keccak256(message_bytes);

// 4. 验证签名并恢复地址
let signature_bytes: Vec<u8> = hex::decode(signature.strip_prefix("0x").unwrap_or(&signature))?;
let recovered_address = ecrecover(&hash, &signature_bytes)?;

// 5. 验证地址匹配
if recovered_address.to_lowercase() != proof.from_address.to_lowercase() {
    return Err("Signature address mismatch");
}
```

#### Withdraw方向（Solana/1024chain）

使用 **Ed25519** 签名格式：
```
message = JSON.stringify(proofData, sorted_keys)
signature = ed25519_sign(message_bytes, private_key)
```

**前端实现**（使用钱包SDK）：

**方法1：使用 @solana/wallet-adapter（推荐，无需私钥）**
```typescript
import { useWallet } from '@solana/wallet-adapter-react';
import bs58 from 'bs58';

function WithdrawComponent() {
  const wallet = useWallet();
  
  // 1. 准备签名消息（移除签名字段）
  const proofData = { ...proof };
  delete proofData.userSignature;
  
  // 2. 序列化（按字段名排序）
  const message = JSON.stringify(proofData, Object.keys(proofData).sort());
  const messageBytes = new TextEncoder().encode(message);
  
  // 3. 通过钱包签名（会弹出Phantom等钱包的签名确认）
  if (!wallet.signMessage) {
    throw new Error('Wallet does not support message signing');
  }
  const signatureBytes = await wallet.signMessage(messageBytes);
  const signatureBase58 = bs58.encode(signatureBytes);
  
  proof.userSignature = signatureBase58;
}
```

**方法2：使用私钥（仅开发/测试使用）**
```typescript
import { Keypair } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

// ⚠️ 仅用于开发/测试，生产环境应使用方法1（钱包SDK）
const keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
const signature = nacl.sign.detached(messageBytes, keypair.secretKey);
const signatureBase58 = bs58.encode(signature);
```

**Broker验证**（使用 ed25519-dalek）：
```rust
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use bs58;

// 1. 重建签名消息
let mut proof_data = proof.clone();
let signature_base58 = proof_data.user_signature.clone();
proof_data.user_signature = String::new();

// 2. 序列化
let message = serde_json::to_string(&proof_data)?;
let message_bytes = message.as_bytes();

// 3. 解码签名和公钥
let signature_bytes = bs58::decode(&signature_base58)?;
let signature = Signature::from_bytes(&signature_bytes[..64])?;

let public_key_bytes = bs58::decode(&proof.receiver_address)?; // 1024chain地址就是公钥
let verifying_key = VerifyingKey::from_bytes(&public_key_bytes[..32])?;

// 4. 验证签名
verifying_key.verify(message_bytes, &signature)
    .map_err(|_| "Invalid signature")?;
```

### 签名内容规范

为了确保前后端签名验证的一致性，需要规范签名的内容：

1. **字段排序**：按字段名字母顺序排序
2. **移除签名字段**：签名时不包括`userSignature`字段本身
3. **序列化格式**：使用JSON格式，确保字段顺序一致
4. **编码格式**：
   - EVM链：十六进制字符串（带或不带0x前缀）
   - Solana链：base58编码

### 链上确认数与 LiFi 交易 ID

对于使用 LiFi 的两段式跨链桥，我们可以掌握：

- **源链 / 目标链的链 ID**：`fromChainId` / `toChainId`
- **源链交易哈希**：`sendingTx.txHash`（部分路由）
- **目标链交易哈希**：`receivingTx.txHash`（Arbitrum 或其他链）
- **路由 ID**：`route.id`（可用于通过 LiFi `/status` 接口查询完整状态）

设计约定：

1. **Deposit 方向**：
   - 证明中至少包含 Arbitrum 上的最终交易哈希：`sourceTxHash`（即 `receivingTx.txHash`）
   - Broker 在 Arbitrum 上验证：
     - 交易存在且成功
     - 确认数 `>= minConfirmations[42161]`（可配置，例如 12 / 64）
     - ERC20 Transfer 日志中 `to == Broker 中转钱包`，`amount ≈ targetAmount`
   - 如需更强保证，可在 `DepositProof` 中同时记录：
     - 源链交易哈希：`lifiSourceTxHash`
     - 目标链交易哈希：`lifiDestTxHash`（与 `sourceTxHash` 对应）
   - LiFi `/status` 接口可通过 `routeId` 或 `txHash` 查询完整执行状态。

2. **Withdraw 方向**：
   - 第一段在 1024chain 上的 `stake` 交易由我们自己控制，证明中包含：
     - `sourceTxSignature` / `sourceTxHash` / `nonce` / `blockHeight`
   - Broker 在 1024chain 上验证：
     - 交易存在且成功
     - slot / blockHeight 与当前高度差值 `<= maxAgeSlots`
     - 签名者 / 事件字段与证明一致。
   - 第二段（Arbitrum → 任意链）完全由 LiFi 执行，Broker 只需保证：
     - Broker 中转钱包在 Arbitrum 上确实持有足够 USDC
     - 调用 LiFi 成功返回 routeId / txHash，并可通过 `/status` 做额外监控。

3. **确认数配置**：
   - 在 Broker 配置中增加：
     - `MIN_CONFIRMATIONS[chainId]`：每条链需要的最小确认数
     - 例如：`MIN_CONFIRMATIONS[42161] = 20`（Arbitrum）等
   - 验证规则：
     - 获取 `txBlock` 和最新区块 `latestBlock`
     - 要求 `latestBlock - txBlock + 1 >= MIN_CONFIRMATIONS[chainId]`
   - 如果确认数不足，返回“交易未最终确认”的错误，前端可做重试 / 等待。

**示例**：
```typescript
// 正确的签名内容
const proofData = {
  amount: "1000000",
  fromAddress: "0x...",
  sourceChainId: 1,
  sourceTxHash: "0x...",
  target1024Address: "...",
  targetAmount: "1000000",
  targetChainId: 42161,
  targetTokenAddress: "0x...",
  timestamp: 1234567890,
  toAddress: "0x...",
  // 注意：不包含 userSignature 字段
};

// 序列化（按字段名排序）
const message = JSON.stringify(proofData, Object.keys(proofData).sort());
```

---

## 实现示例

### Deposit方向完整示例

```typescript
// 前端：生成证明
async function generateDepositProof(
  lifiResult: Route,
  sourceChainId: number,
  sourceTokenAddress: string,
  target1024Address: string
): Promise<DepositProof> {
  const finalStep = lifiResult.steps[lifiResult.steps.length - 1];
  const finalExecution = finalStep.execution;
  const lastProcess = finalExecution.process[finalExecution.process.length - 1];
  
  // 获取最终交易哈希（Arbitrum上的交易）
  const txHash = lastProcess.txHash || 
    finalExecution.internalTxLink?.split('/').pop();
  
  if (!txHash) {
    throw new Error('Failed to get transaction hash');
  }
  
  return {
    sourceChainId,
    sourceTxHash: txHash,
    sourceTokenAddress,
    sourceAmount: lifiResult.fromAmount,
    targetChainId: ARB_CHAIN_ID,
    targetTokenAddress: ARB_USDC_ADDRESS,
    targetAmount: finalExecution.toAmount,
    fromAddress: lifiResult.fromAddress,
    toAddress: BROKER_TRANSIT_WALLET_ADDRESS,
    target1024Address,
    timestamp: Math.floor(Date.now() / 1000),
    lifiRouteId: lifiResult.id,
  };
}

// 调用stake API时带上证明（包含签名）
await callStakeAPI(receivedUsdcAmount, target1024Address, proof);
```

**完整的签名生成流程**：
```typescript
// 1. 第一步完成后，获取交易信息
const finalStep = lifiResult.steps[lifiResult.steps.length - 1];
const finalExecution = finalStep.execution;
const lastProcess = finalExecution.process[finalExecution.process.length - 1];
const txHash = lastProcess.txHash;

// 2. 构建证明数据（不包含签名）
const proofData = {
  sourceChainId: selectedChainId,
  sourceTxHash: txHash,
  sourceTokenAddress: selectedTokenAddress,
  sourceAmount: quote.action.fromAmount,
  targetChainId: ARB_CHAIN_ID,
  targetTokenAddress: ARB_USDC_ADDRESS,
  targetAmount: finalExecution.toAmount,
  fromAddress: targetAddress, // Arbitrum地址
  toAddress: BROKER_TRANSIT_WALLET_ADDRESS,
  target1024Address: target1024Address,
  timestamp: Math.floor(Date.now() / 1000),
  lifiRouteId: lifiResult.id,
};

// 3. 通过钱包生成签名（会弹出钱包签名确认）
const message = JSON.stringify(proofData, Object.keys(proofData).sort());

// 使用 wagmi 的 useSignMessage hook
const { signMessageAsync } = useSignMessage();
const signature = await signMessageAsync({ message });

// 4. 添加签名到证明
const proof: DepositProof = {
  ...proofData,
  userSignature: signature,
};

// 5. 调用API
await callStakeAPI(receivedUsdcAmount, target1024Address, proof);
```

### Withdraw方向完整示例

```typescript
// 前端：生成证明
async function generateWithdrawProof(
  stakeResult: TransactionResult,
  amount: string,
  arbitrumAddress: string,
  targetChainId: number,
  targetAsset: string,
  recipientAddress: string
): Promise<WithdrawProof> {
  return {
    sourceChainId: 1024,
    sourceTxSignature: stakeResult.signature,
    sourceTxHash: stakeResult.txHash,
    sourceBlockHeight: stakeResult.blockHeight,
    amount,
    receiverAddress: walletAddress,
    arbitrumAddress,
    targetChainId,
    targetAsset,
    recipientAddress,
    timestamp: Math.floor(Date.now() / 1000),
    nonce: stakeResult.nonce,
  };
}

// 调用withdraw API时带上证明（包含签名）
await callWithdrawAPI({
  target_chain: targetChainId,
  target_asset: targetAsset,
  usdc_amount: amount,
  recipient_address: recipientAddress,
  proof: withdrawProof,
});
```

**完整的签名生成流程**：
```typescript
// 1. 第一步：在1024chain上执行stake
const stakeResult = await program.methods
  .stake(new BN(amount), arbitrumAddress)
  .accounts({...})
  .rpc();

// 2. 构建证明数据（不包含签名）
const proofData = {
  sourceChainId: 1024,
  sourceTxSignature: stakeResult.signature,
  sourceTxHash: stakeResult.txHash,
  sourceBlockHeight: stakeResult.blockHeight,
  amount: amount.toString(),
  receiverAddress: walletAddress, // 1024chain地址
  arbitrumAddress: arbitrumAddress,
  targetChainId: targetChainId,
  targetAsset: targetAsset,
  recipientAddress: recipientAddress,
  timestamp: Math.floor(Date.now() / 1000),
  nonce: stakeResult.nonce,
};

// 3. 通过钱包生成签名（会弹出钱包签名确认）
const message = JSON.stringify(proofData, Object.keys(proofData).sort());
const messageBytes = new TextEncoder().encode(message);

// 使用 @solana/wallet-adapter 的 signMessage
const wallet = useWallet();
if (!wallet.signMessage) {
  throw new Error('Wallet does not support message signing');
}
const signatureBytes = await wallet.signMessage(messageBytes);
const signatureBase58 = bs58.encode(signatureBytes);

// 4. 添加签名到证明
const proof: WithdrawProof = {
  ...proofData,
  userSignature: signatureBase58,
};

// 5. 调用API
await callWithdrawAPI({
  target_chain: targetChainId,
  target_asset: targetAsset,
  usdc_amount: amount,
  recipient_address: recipientAddress,
  proof: proof,
});
```

---

## 总结

交易证明机制的核心思想：

1. **Deposit方向**：验证第一步跨链交易（任意链→Arbitrum）确实完成
2. **Withdraw方向**：验证第一步跨链交易（1024chain→Arbitrum）确实完成
3. **防重放**：每个证明只能使用一次
4. **时间验证**：证明有有效期，防止过期使用
5. **金额验证**：确保第二步金额与第一步匹配
6. **🔐 用户签名验证**（关键安全机制）：
   - 用户使用私钥对证明内容签名
   - Broker验证签名，确保只有执行第一步交易的用户才能生成有效证明
   - **防止攻击者抢用交易哈希**：即使攻击者看到了链上的交易哈希，也无法生成有效的签名

### 安全保证

通过这个机制，即使：
- ✅ 前端代码被篡改
- ✅ 攻击者监听链上交易
- ✅ 攻击者看到交易哈希

攻击者仍然无法：
- ❌ 跳过第一步直接执行第二步（Broker会验证链上交易）
- ❌ 抢用他人的交易哈希（无法生成有效的用户签名）

因为只有拥有私钥的用户才能对证明内容进行签名，而私钥只有用户本人拥有。

---

## 钱包SDK支持情况

### EVM钱包

**支持的钱包**：
- ✅ MetaMask
- ✅ WalletConnect
- ✅ Coinbase Wallet
- ✅ Rainbow Wallet
- ✅ Trust Wallet
- ✅ 其他支持EIP-191的钱包

**签名标准**：
- EIP-191: `personal_sign`
- 格式：`"\x19Ethereum Signed Message:\n" + len(message) + message`

**SDK支持**：
- ✅ wagmi: `useSignMessage` hook
- ✅ ethers.js: `signer.signMessage()`
- ✅ viem: `account.signMessage()`
- ✅ web3.js: `web3.eth.personal.sign()`

### Solana钱包

**支持的钱包**：
- ✅ Phantom
- ✅ Solflare
- ✅ Backpack
- ✅ Glow
- ✅ Slope
- ✅ 其他支持标准钱包适配器的钱包

**签名标准**：
- Ed25519签名
- 消息直接签名（无额外前缀）

**SDK支持**：
- ✅ @solana/wallet-adapter-react: `wallet.signMessage()`
- ✅ @solana/web3.js: 底层支持

### 实现建议

1. **优先使用钱包SDK**：
   - ✅ 更安全（私钥不暴露给前端）
   - ✅ 用户体验好（熟悉的钱包弹窗）
   - ✅ 兼容性好（支持所有主流钱包）

2. **仅在特殊情况使用私钥**：
   - 开发/测试环境
   - 自动化测试
   - 后台服务（Broker服务内部）

3. **签名前端流程**：
   ```typescript
   // 1. 用户连接钱包（不需要私钥）
   // 2. 构建证明数据
   // 3. 调用钱包SDK签名（会弹出钱包确认）
   // 4. 用户确认签名
   // 5. 获得签名，添加到证明中
   // 6. 提交证明到Broker服务
   ```

4. **用户体验优化**：
   - 在签名前展示签名内容（透明化）
   - 提示用户为什么需要签名
   - 处理用户拒绝签名的情况
   - 显示签名进度和状态

### 安全最佳实践

1. ✅ **永远不要在前端输入私钥**
2. ✅ **使用钱包扩展进行签名**
3. ✅ **在签名前向用户展示签名内容**
4. ✅ **使用HTTPS传输签名和证明**
5. ✅ **后端验证签名和链上交易（含确认数）**
6. ✅ **实施防重放机制（原子占用 proofId）**
7. ✅ **对 Broker API 增加速率限制 / IP 限流，防止 DoS**
8. ✅ **记录所有签名验证失败 / 证明拒绝的尝试，便于审计**


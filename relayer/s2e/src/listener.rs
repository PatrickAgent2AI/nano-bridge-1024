use crate::config::S2EConfig;
use crate::signer::EcdsaSigner;
use crate::submitter::EvmSubmitter;
use anyhow::{anyhow, Result};
use shared::types::StakeEventData;
use std::time::Duration;
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use tracing::{error, info, warn};
use borsh::BorshDeserialize;
use serde::Deserialize;
use serde_json::json;
use base64::{Engine as _, engine::general_purpose};

/// 启动 SVM 事件监听器
pub async fn start_listener(config: S2EConfig) -> Result<()> {
    info!("Starting SVM event listener");
    info!(
        rpc = config.source_chain.rpc_url,
        program = config.source_chain.contract_address,
        "Connecting to SVM"
    );

    // 创建签名器和提交器
    let private_key = config.relayer.ecdsa_private_key
        .as_ref()
        .ok_or_else(|| anyhow!(
            "ECDSA private key not configured. Please set RELAYER__ECDSA_PRIVATE_KEY environment variable.\n\
            Example: RELAYER__ECDSA_PRIVATE_KEY=0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef\n\
            You can generate one using: openssl rand -hex 32"
        ))?;
    
    let signer = EcdsaSigner::new(private_key)
        .map_err(|e| anyhow!("Failed to create ECDSA signer: {}\n\
            Hint: ECDSA private key must be a 64-character hex string (32 bytes).\n\
            Generate one with: openssl rand -hex 32", e))?;
    let submitter = EvmSubmitter::new(
        &config.target_chain.rpc_url,
        &config.target_chain.contract_address,
        private_key,
    )
    .map_err(|e| anyhow!("Failed to create EVM submitter: {}", e))?;

    info!("SVM event listener initialized (using HTTP RPC)");

    // 创建已处理交易的追踪集合
    let processed_signatures = Arc::new(Mutex::new(HashSet::new()));

    // 持续监听
    loop {
        match listen_for_events(&config, &signer, &submitter, processed_signatures.clone()).await {
            Ok(_) => {}
            Err(e) => {
                error!("Error listening for events: {}", e);
            }
        }

        // 等待一段时间后继续
        tokio::time::sleep(Duration::from_secs(10)).await;
    }
}

// Solana RPC 响应结构
#[derive(Debug, Deserialize)]
struct RpcResponse<T> {
    result: T,
}

#[derive(Debug, Deserialize)]
struct SignatureInfo {
    signature: String,
    #[serde(default)]
    err: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct TransactionResponse {
    meta: Option<TransactionMeta>,
}

#[derive(Debug, Deserialize)]
struct TransactionMeta {
    #[serde(rename = "logMessages")]
    log_messages: Option<Vec<String>>,
    err: Option<serde_json::Value>,
}

/// 监听事件（使用 Solana RPC HTTP API）
async fn listen_for_events(
    config: &S2EConfig,
    signer: &EcdsaSigner,
    submitter: &EvmSubmitter,
    processed_signatures: Arc<Mutex<HashSet<String>>>,
) -> Result<()> {
    let program_id = &config.source_chain.contract_address;
    
    info!("Polling for SVM events from program: {}", program_id);

    // 创建 HTTP 客户端
    let client = reqwest::Client::new();

    // 调用 getSignaturesForAddress
    let signatures_request = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getSignaturesForAddress",
        "params": [
            program_id,
            {
                "limit": 10,
                "commitment": "confirmed"
            }
        ]
    });

    let response = client
        .post(&config.source_chain.rpc_url)
        .json(&signatures_request)
        .send()
        .await?;

    let signatures: RpcResponse<Vec<SignatureInfo>> = response.json().await?;

    info!("Found {} recent transactions", signatures.result.len());

    // 处理每个交易
    for sig_info in signatures.result.iter() {
        let sig_str = &sig_info.signature;
        
        // 跳过失败的交易
        if sig_info.err.is_some() {
            continue;
        }
        
        // 检查是否已处理
        {
            let processed = processed_signatures.lock().unwrap();
            if processed.contains(sig_str) {
                continue;
            }
        }

        // 获取交易详情
        let tx_request = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getTransaction",
            "params": [
                sig_str,
                {
                    "encoding": "json",
                    "commitment": "confirmed",
                    "maxSupportedTransactionVersion": 0
                }
            ]
        });

        match client
            .post(&config.source_chain.rpc_url)
            .json(&tx_request)
            .send()
            .await
        {
            Ok(tx_response) => {
                match tx_response.json::<RpcResponse<TransactionResponse>>().await {
                    Ok(tx_data) => {
                        // 解析交易日志中的事件
                        if let Some(meta) = tx_data.result.meta {
                            if meta.err.is_some() {
                                continue; // 跳过失败的交易
                            }
                            
                            if let Some(log_messages) = meta.log_messages {
                                // 查找 StakeEvent
                                for log in log_messages.iter() {
                                    if log.contains("Program data:") {
                                        // Anchor 事件格式：Program data: <base64_encoded_event>
                                        if let Some(event) = parse_stake_event(log, config) {
                                            info!(
                                                signature = %sig_str,
                                                nonce = event.nonce,
                                                amount = event.amount,
                                                receiver = %event.receiver_address,
                                                "📥 Captured StakeEvent"
                                            );

                                            // 记录捕获的事件详情
                                            info!(
                                                "Event details: source_contract={}, target_contract={}, source_chain_id={}, target_chain_id={}, block_height={}", 
                                                event.source_contract,
                                                event.target_contract,
                                                event.source_chain_id,
                                                event.target_chain_id,
                                                event.block_height
                                            );

                                            // 处理事件
                                            match process_event(config, event.clone(), signer, submitter).await {
                                                Ok(_) => {
                                                    // 标记为已处理
                                                    let mut processed = processed_signatures.lock().unwrap();
                                                    processed.insert(sig_str.clone());
                                                    
                                                    // 限制已处理集合的大小
                                                    if processed.len() > 1000 {
                                                        processed.clear();
                                                    }
                                                }
                                                Err(e) => {
                                                    error!(
                                                        signature = %sig_str,
                                                        nonce = event.nonce,
                                                        error = %e,
                                                        "Failed to process event"
                                                    );
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    Err(e) => {
                        warn!("Failed to parse transaction {}: {}", sig_str, e);
                    }
                }
            }
            Err(e) => {
                warn!("Failed to get transaction {}: {}", sig_str, e);
            }
        }
    }

    Ok(())
}

/// 解析 Anchor 事件日志
fn parse_stake_event(log: &str, config: &S2EConfig) -> Option<StakeEventData> {
    // Anchor 事件格式：Program data: <base64_encoded_event>
    if let Some(data_str) = log.strip_prefix("Program data: ") {
        if let Ok(data) = general_purpose::STANDARD.decode(data_str.trim()) {
            // Anchor 事件格式：8字节事件discriminator + 事件数据
            if data.len() > 8 {
                // 跳过 8 字节的事件 discriminator
                let event_data = &data[8..];
                
                // 尝试反序列化为 StakeEvent（Anchor 格式）
                if let Ok(event) = deserialize_anchor_event(event_data, config) {
                    return Some(event);
                }
            }
        }
    }
    None
}

/// 反序列化 Anchor StakeEvent
fn deserialize_anchor_event(data: &[u8], config: &S2EConfig) -> Result<StakeEventData> {
    // Anchor StakeEvent 结构（与程序中的 StakeEvent 对应）
    #[derive(BorshDeserialize)]
    struct AnchorStakeEvent {
        source_contract: String,
        target_contract: String,
        chain_id: u64,
        block_height: u64,
        amount: u64,
        receiver_address: String,
        nonce: u64,
    }

    let anchor_event = AnchorStakeEvent::try_from_slice(data)?;
    
    // 转换为 StakeEventData（需要添加 target_chain_id）
    // 注意：Anchor 事件中的 chain_id 是 source_chain_id
    Ok(StakeEventData {
        source_contract: anchor_event.source_contract,
        target_contract: anchor_event.target_contract,
        source_chain_id: anchor_event.chain_id,
        target_chain_id: config.target_chain.chain_id,
        block_height: anchor_event.block_height,
        amount: anchor_event.amount,
        receiver_address: anchor_event.receiver_address,
        nonce: anchor_event.nonce,
    })
}

/// 处理单个事件
async fn process_event(
    _config: &S2EConfig,
    event: StakeEventData,
    signer: &EcdsaSigner,
    submitter: &EvmSubmitter,
) -> Result<()> {
    info!(nonce = event.nonce, "🔄 Processing event");

    // 1. 生成签名
    let signature = signer.sign_event(&event)?;
    info!(nonce = event.nonce, "✍️  Generated signature");

    // 2. 提交到 EVM
    let tx_hash = submitter.submit_signature(&event, &signature).await?;
    info!(
        nonce = event.nonce,
        tx = tx_hash,
        "✅ Submitted signature to EVM"
    );

    Ok(())
}

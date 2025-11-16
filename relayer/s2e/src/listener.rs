use crate::config::S2EConfig;
use crate::signer::EcdsaSigner;
use crate::submitter::EvmSubmitter;
use anyhow::{anyhow, Result};
use shared::types::StakeEventData;
use std::time::Duration;
use tracing::{error, info, warn};

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
        .ok_or_else(|| anyhow!("ECDSA private key not configured"))?;
    
    let signer = EcdsaSigner::new(private_key)?;
    let submitter = EvmSubmitter::new(
        &config.target_chain.rpc_url,
        &config.target_chain.contract_address,
        private_key,
    )?;

    info!("SVM event listener initialized (using HTTP RPC)");

    // 持续监听
    loop {
        match listen_for_events(&config, &signer, &submitter).await {
            Ok(_) => {}
            Err(e) => {
                error!("Error listening for events: {}", e);
            }
        }

        // 等待一段时间后继续
        tokio::time::sleep(Duration::from_secs(10)).await;
    }
}

/// 监听事件（简化版本 - 使用 HTTP RPC API）
async fn listen_for_events(
    config: &S2EConfig,
    signer: &EcdsaSigner,
    submitter: &EvmSubmitter,
) -> Result<()> {
    // TODO: 实现使用 Solana RPC HTTP API 查询程序日志
    // 这里需要：
    // 1. 调用 getSignaturesForAddress 获取程序的交易签名列表
    // 2. 对每个签名调用 getTransaction 获取交易详情
    // 3. 解析交易日志，提取 StakeEvent
    // 4. 处理事件

    info!("Polling for SVM events (not yet fully implemented)");
    
    // 占位符：在实际实现前，listener 会静默运行
    tokio::time::sleep(Duration::from_secs(5)).await;
    
    Ok(())
}

/// 处理单个事件
async fn _process_event(
    _config: &S2EConfig,
    event: StakeEventData,
    signer: &EcdsaSigner,
    submitter: &EvmSubmitter,
) -> Result<()> {
    info!(nonce = event.nonce, "Processing event");

    // 1. 生成签名
    let signature = signer.sign_event(&event)?;
    info!(nonce = event.nonce, "Generated signature");

    // 2. 提交到 EVM
    let tx_hash = submitter.submit_signature(&event, &signature).await?;
    info!(
        nonce = event.nonce,
        tx = tx_hash,
        "Submitted signature to EVM"
    );

    Ok(())
}

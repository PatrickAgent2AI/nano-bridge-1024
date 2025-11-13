use crate::config::S2EConfig;
use anyhow::Result;
use shared::types::StakeEventData;
use tracing::{error, info};

/// 启动 SVM 事件监听器
pub async fn start_listener(config: S2EConfig) -> Result<()> {
    info!("Starting SVM event listener");
    info!(
        rpc = config.source_chain.rpc_url,
        contract = config.source_chain.contract_address,
        "Connecting to SVM"
    );

    // TODO: 实现实际的 SVM 事件监听逻辑
    // 这里需要：
    // 1. 连接到 Solana RPC
    // 2. 订阅合约事件 (使用 anchor-client)
    // 3. 解析 StakeEvent
    // 4. 调用 process_event 处理事件

    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;
        info!("Event listener is running (implementation pending)");
    }
}

/// 处理单个事件
async fn process_event(_config: &S2EConfig, _event: StakeEventData) -> Result<()> {
    // TODO: 实现事件处理逻辑
    // 1. 验证事件
    // 2. 生成 ECDSA 签名
    // 3. 提交到 EVM
    Ok(())
}


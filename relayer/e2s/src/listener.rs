use crate::config::E2SConfig;
use anyhow::Result;
use shared::types::StakeEventData;
use tracing::info;

/// 启动 EVM 事件监听器
pub async fn start_listener(config: E2SConfig) -> Result<()> {
    info!("Starting EVM event listener");
    info!(
        rpc = config.source_chain.rpc_url,
        contract = config.source_chain.contract_address,
        "Connecting to EVM"
    );

    // TODO: 实现实际的 EVM 事件监听逻辑
    // 这里需要：
    // 1. 连接到 EVM RPC (使用 ethers)
    // 2. 订阅合约事件 (StakeEvent)
    // 3. 解析事件数据
    // 4. 调用 process_event 处理事件

    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;
        info!("Event listener is running (implementation pending)");
    }
}

/// 处理单个事件
async fn process_event(_config: &E2SConfig, _event: StakeEventData) -> Result<()> {
    // TODO: 实现事件处理逻辑
    // 1. 验证事件
    // 2. 生成 Ed25519 签名
    // 3. 提交到 SVM
    Ok(())
}


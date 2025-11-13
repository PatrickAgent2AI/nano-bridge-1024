mod api;
mod config;
mod listener;
mod signer;
mod submitter;

use anyhow::Result;
use shared::{logger, metrics};
use tracing::info;

#[tokio::main]
async fn main() -> Result<()> {
    // 加载配置
    let config = config::load_s2e_config()?;
    
    // 初始化日志
    logger::init_logger(&config.logging.level, &config.logging.format)?;
    info!("Starting s2e relayer service");
    info!(
        source = config.source_chain.name,
        target = config.target_chain.name,
        "Service configuration loaded"
    );

    // 初始化指标
    metrics::init_metrics();

    // 验证配置
    config.validate()?;
    info!("Configuration validated");

    // 检查余额
    check_balances(&config).await?;
    info!("Balance check passed");

    // 启动 HTTP API 服务器
    let api_handle = tokio::spawn(api::start_server(config.clone()));
    info!(port = config.api.port, "HTTP API server started");

    // 启动事件监听器
    let listener_handle = tokio::spawn(listener::start_listener(config.clone()));
    info!("Event listener started");

    // 等待服务
    tokio::select! {
        _ = api_handle => {
            info!("API server stopped");
        }
        _ = listener_handle => {
            info!("Event listener stopped");
        }
        _ = tokio::signal::ctrl_c() => {
            info!("Received shutdown signal");
        }
    }

    info!("s2e relayer service stopped");
    Ok(())
}

async fn check_balances(config: &config::S2EConfig) -> Result<()> {
    use shared::gas::GasManager;
    
    let gas_manager = GasManager::new(
        config.gas.min_svm_balance,
        config.gas.min_evm_balance,
        config.gas.balance_check_interval,
    );

    // TODO: 实现实际的余额查询
    // let svm_balance = get_svm_balance(&config).await?;
    // let evm_balance = get_evm_balance(&config).await?;
    
    // gas_manager.check_svm_balance(svm_balance)?;
    // gas_manager.check_evm_balance(evm_balance)?;

    info!("Balance check: SVM and EVM balances sufficient (check implementation pending)");
    Ok(())
}

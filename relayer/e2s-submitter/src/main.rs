mod api;
mod config;
mod signer;
mod submitter;

use anyhow::Result;
use shared::logger;
use tracing::info;

#[tokio::main]
async fn main() -> Result<()> {
    // 加载配置
    let config = config::load_config()?;
    
    // 初始化日志
    logger::init_logger(&config.logging.level, &config.logging.format)?;
    info!("Starting e2s-submitter service");
    
    // 启动 HTTP API 服务器
    let api_handle = tokio::spawn(api::start_server(config.clone()));
    info!(port = config.api.port, "HTTP API server started");
    
    // 启动事件处理器
    let processor_handle = tokio::spawn(submitter::start_processor(config.clone()));
    info!("Event processor started");
    
    // 等待服务
    tokio::select! {
        _ = api_handle => {
            info!("API server stopped");
        }
        _ = processor_handle => {
            info!("Event processor stopped");
        }
        _ = tokio::signal::ctrl_c() => {
            info!("Received shutdown signal");
        }
    }
    
    info!("e2s-submitter service stopped");
    Ok(())
}


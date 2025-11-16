mod config;
mod listener;

use anyhow::Result;
use shared::logger;
use tracing::info;

#[tokio::main]
async fn main() -> Result<()> {
    // 加载配置
    let config = config::load_config()?;
    
    // 初始化日志
    logger::init_logger(&config.logging.level, &config.logging.format)?;
    info!("Starting e2s-listener service");
    
    // 启动事件监听器
    listener::start_listener(config).await?;
    
    Ok(())
}


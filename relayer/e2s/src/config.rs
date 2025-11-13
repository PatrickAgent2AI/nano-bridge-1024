use anyhow::Result;
use shared::Config;
use std::env;

pub type E2SConfig = Config;

pub fn load_e2s_config() -> Result<E2SConfig> {
    // 设置默认的服务名称
    env::set_var("SERVICE__NAME", "e2s");
    
    // 从环境变量加载配置
    let mut config = Config::load()?;
    config.service.name = "e2s".to_string();
    
    Ok(config)
}

/// 加载示例配置 (用于测试)
pub fn load_example_config() -> E2SConfig {
    let mut config = Config::default();
    config.service.name = "e2s".to_string();
    
    // EVM (Arbitrum Sepolia) 配置
    config.source_chain.name = "Arbitrum Sepolia".to_string();
    config.source_chain.chain_id = 421614;
    config.source_chain.rpc_url = "https://sepolia-rollup.arbitrum.io/rpc".to_string();
    config.source_chain.confirmation_blocks = Some(12);
    
    // SVM (1024chain) 配置
    config.target_chain.name = "1024chain".to_string();
    config.target_chain.chain_id = 91024;
    config.target_chain.rpc_url = "https://testnet-rpc.1024chain.com/rpc/".to_string();
    config.target_chain.commitment = Some("finalized".to_string());
    
    // API 配置
    config.api.port = 8082;
    
    config
}


use anyhow::Result;
use shared::Config;
use std::env;

pub type S2EConfig = Config;

pub fn load_s2e_config() -> Result<S2EConfig> {
    // 设置默认的服务名称
    env::set_var("SERVICE__NAME", "s2e");
    
    // 从环境变量加载配置
    let mut config = Config::load()?;
    config.service.name = "s2e".to_string();
    
    // S2E 默认端口为 8083
    if config.api.port == 8082 {
        config.api.port = 8083;
    }
    
    Ok(config)
}

/// 加载示例配置 (用于测试)
pub fn load_example_config() -> S2EConfig {
    let mut config = Config::default();
    config.service.name = "s2e".to_string();
    
    // SVM (1024chain) 配置  
    config.source_chain.name = "1024chain".to_string();
    config.source_chain.chain_id = 91024;
    config.source_chain.rpc_url = "https://testnet-rpc.1024chain.com/rpc/".to_string();
    config.source_chain.commitment = Some("finalized".to_string());
    
    // EVM (Arbitrum Sepolia) 配置
    config.target_chain.name = "Arbitrum Sepolia".to_string();
    config.target_chain.chain_id = 421614;
    config.target_chain.rpc_url = "https://sepolia-rollup.arbitrum.io/rpc".to_string();
    config.target_chain.confirmation_blocks = Some(12);
    
    // API 配置
    config.api.port = 8083;
    
    config
}

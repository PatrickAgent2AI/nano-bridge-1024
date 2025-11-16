use anyhow::Result;
use shared::Config;
use std::env;

pub type ListenerConfig = Config;

pub fn load_config() -> Result<ListenerConfig> {
    // 设置默认的服务名称
    env::set_var("SERVICE__NAME", "e2s-listener");
    
    // 从环境变量加载配置
    let mut config = Config::load()?;
    config.service.name = "e2s-listener".to_string();
    
    Ok(config)
}


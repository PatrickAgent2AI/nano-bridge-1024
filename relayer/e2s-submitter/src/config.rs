use anyhow::Result;
use shared::Config;
use std::env;

pub type SubmitterConfig = Config;

pub fn load_config() -> Result<SubmitterConfig> {
    // 设置默认的服务名称
    env::set_var("SERVICE__NAME", "e2s-submitter");
    
    // 从环境变量加载配置
    let mut config = Config::load()?;
    config.service.name = "e2s-submitter".to_string();
    
    // e2s-submitter 默认端口为 8082
    if config.api.port == 8080 {
        config.api.port = 8082;
    }
    
    Ok(config)
}


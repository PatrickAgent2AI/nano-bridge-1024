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
    
    // S2E 默认端口为 8081
    if config.api.port == 8080 {
        config.api.port = 8081;
    }
    
    Ok(config)
}

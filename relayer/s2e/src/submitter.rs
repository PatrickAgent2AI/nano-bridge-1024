use anyhow::Result;
use shared::types::StakeEventData;
use tracing::info;

/// EVM 交易提交器
pub struct EvmSubmitter {
    // TODO: 添加 ethers provider 等字段
}

impl EvmSubmitter {
    pub fn new(_rpc_url: &str, _contract_address: &str) -> Result<Self> {
        // TODO: 初始化 ethers provider 和合约实例
        Ok(Self {})
    }

    /// 提交签名到 EVM 合约
    pub async fn submit_signature(
        &self,
        _event: &StakeEventData,
        _signature: &[u8],
    ) -> Result<String> {
        // TODO: 实现实际的交易提交逻辑
        // 1. 构造交易
        // 2. 估算 gas
        // 3. 发送交易
        // 4. 等待确认
        // 5. 返回交易哈希

        info!("Signature submitted (implementation pending)");
        Ok("0x0000000000000000000000000000000000000000000000000000000000000000".to_string())
    }
}


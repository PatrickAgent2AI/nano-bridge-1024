use anyhow::{anyhow, Result};
use ethers::{
    core::types::Address,
    middleware::SignerMiddleware,
    prelude::*,
    providers::{Http, Middleware, Provider},
    signers::{LocalWallet, Signer as EthersSigner},
    abi::{Token, encode},
};
use shared::types::StakeEventData;
use std::sync::Arc;
use tracing::{info, warn};

/// EVM 交易提交器
pub struct EvmSubmitter {
    client: Arc<SignerMiddleware<Provider<Http>, LocalWallet>>,
    contract_address: Address,
}

impl EvmSubmitter {
    pub fn new(rpc_url: &str, contract_address: &str, private_key_hex: &str) -> Result<Self> {
        // 创建 Provider
        let provider = Provider::<Http>::try_from(rpc_url)
            .map_err(|e| anyhow!("Failed to create provider: {}", e))?;

        // 解析私钥
        let private_key_hex = private_key_hex.strip_prefix("0x").unwrap_or(private_key_hex);
        let wallet: LocalWallet = private_key_hex
            .parse()
            .map_err(|e| anyhow!("Failed to parse wallet: {}", e))?;

        // 设置链 ID (Arbitrum Sepolia)
        let wallet = wallet.with_chain_id(421614u64);

        // 创建签名中间件
        let client = Arc::new(SignerMiddleware::new(provider, wallet));

        // 解析合约地址
        let contract_address: Address = contract_address
            .parse()
            .map_err(|e| anyhow!("Invalid contract address: {}", e))?;

        info!(
            relayer_address = %client.address(),
            contract_address = %contract_address,
            "EVM submitter initialized"
        );

        Ok(Self {
            client,
            contract_address,
        })
    }

    /// 提交签名到 EVM 合约
    pub async fn submit_signature(
        &self,
        event: &StakeEventData,
        signature: &[u8],
    ) -> Result<String> {
        info!(nonce = event.nonce, "Submitting signature to EVM");

        // 构建合约调用数据
        let call_data = self.encode_submit_signature(event, signature)?;

        // 创建交易
        let tx = TransactionRequest::new()
            .to(self.contract_address)
            .data(call_data);

        // 发送交易
        match self.client.send_transaction(tx, None).await {
            Ok(pending_tx) => {
                info!(nonce = event.nonce, "Transaction sent, waiting for confirmation");
                
                match pending_tx.await {
                    Ok(Some(receipt)) => {
                        info!(
                            nonce = event.nonce,
                            tx_hash = %receipt.transaction_hash,
                            "Transaction confirmed"
                        );
                        Ok(format!("{:?}", receipt.transaction_hash))
                    }
                    Ok(None) => {
                        warn!(nonce = event.nonce, "Transaction pending (no receipt yet)");
                        Err(anyhow!("Transaction pending"))
                    }
                    Err(e) => {
                        warn!(nonce = event.nonce, error = %e, "Transaction failed");
                        Err(anyhow!("Transaction failed: {}", e))
                    }
                }
            }
            Err(e) => {
                warn!(nonce = event.nonce, error = %e, "Failed to send transaction");
                Err(anyhow!("Failed to send transaction: {}", e))
            }
        }
    }

    /// 编码 submitSignature 函数调用
    fn encode_submit_signature(&self, event: &StakeEventData, signature: &[u8]) -> Result<Bytes> {
        // submitSignature 函数签名
        // function submitSignature((bytes32,bytes32,uint64,uint64,uint64,uint64,string,uint64) eventData, bytes signature)
        let function_signature = "submitSignature((bytes32,bytes32,uint64,uint64,uint64,uint64,string,uint64),bytes)";
        let selector = &ethers::utils::keccak256(function_signature.as_bytes())[0..4];

        // 编码事件数据元组
        let event_data_tuple = Token::Tuple(vec![
            Token::FixedBytes(self.parse_bytes32(&event.source_contract)?.to_vec()),
            Token::FixedBytes(self.parse_bytes32(&event.target_contract)?.to_vec()),
            Token::Uint(event.source_chain_id.into()),
            Token::Uint(event.target_chain_id.into()),
            Token::Uint(event.block_height.into()),
            Token::Uint(event.amount.into()),
            Token::String(event.receiver_address.clone()),
            Token::Uint(event.nonce.into()),
        ]);

        // 编码签名
        let signature_token = Token::Bytes(signature.to_vec());

        // 编码所有参数
        let encoded_params = encode(&[event_data_tuple, signature_token]);

        // 组合选择器和参数
        let mut call_data = Vec::with_capacity(4 + encoded_params.len());
        call_data.extend_from_slice(selector);
        call_data.extend_from_slice(&encoded_params);

        Ok(Bytes::from(call_data))
    }

    /// 解析字符串为 bytes32
    fn parse_bytes32(&self, s: &str) -> Result<[u8; 32]> {
        let s = s.strip_prefix("0x").unwrap_or(s);
        let bytes = hex::decode(s)?;
        
        if bytes.len() > 32 {
            return Err(anyhow!("Bytes too long: {} > 32", bytes.len()));
        }
        
        let mut result = [0u8; 32];
        result[..bytes.len()].copy_from_slice(&bytes);
        Ok(result)
    }
}

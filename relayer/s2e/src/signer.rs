use anyhow::Result;
use secp256k1::{Message, Secp256k1, SecretKey};
use sha2::{Digest, Sha256};
use shared::types::StakeEventData;

/// ECDSA 签名器 (用于 EVM)
pub struct EcdsaSigner {
    secret_key: SecretKey,
}

impl EcdsaSigner {
    /// 从私钥创建签名器
    pub fn from_private_key(private_key: &str) -> Result<Self> {
        let key_bytes = hex::decode(private_key.trim_start_matches("0x"))?;
        let secret_key = SecretKey::from_slice(&key_bytes)?;
        Ok(Self { secret_key })
    }

    /// 对事件数据生成签名
    pub fn sign_event(&self, event: &StakeEventData) -> Result<Vec<u8>> {
        // 1. JSON 序列化
        let json_data = serde_json::json!({
            "sourceContract": event.source_contract,
            "targetContract": event.target_contract,
            "chainId": event.source_chain_id.to_string(),
            "blockHeight": event.block_height.to_string(),
            "amount": event.amount.to_string(),
            "receiverAddress": event.receiver_address,
            "nonce": event.nonce.to_string()
        });
        let json_string = json_data.to_string();

        // 2. SHA-256 哈希
        let mut hasher = Sha256::new();
        hasher.update(json_string.as_bytes());
        let sha256_hash = hasher.finalize();

        // 3. EIP-191 格式 (Ethereum Signed Message)
        let eth_message = format!("\x19Ethereum Signed Message:\n32");
        let mut eth_hasher = Sha256::new();
        eth_hasher.update(eth_message.as_bytes());
        eth_hasher.update(&sha256_hash);
        let eth_signed_hash = eth_hasher.finalize();

        // 4. ECDSA 签名
        let secp = Secp256k1::new();
        let message = Message::from_digest_slice(&eth_signed_hash)?;
        let signature = secp.sign_ecdsa(&message, &self.secret_key);

        // 5. 返回 65 字节签名 (r + s + v)
        let (rec_id, sig_bytes) = signature.serialize_compact();
        let mut result = Vec::with_capacity(65);
        result.extend_from_slice(&sig_bytes);
        result.push(rec_id.to_i32() as u8 + 27); // v = recovery_id + 27

        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ecdsa_signer_creation() {
        let private_key = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
        let signer = EcdsaSigner::from_private_key(private_key);
        assert!(signer.is_ok());
    }

    #[test]
    fn test_sign_event() {
        let private_key = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
        let signer = EcdsaSigner::from_private_key(private_key).unwrap();

        let event = StakeEventData {
            source_contract: "source123".to_string(),
            target_contract: "target456".to_string(),
            source_chain_id: 91024,
            target_chain_id: 421614,
            block_height: 1000,
            amount: 100_000000,
            receiver_address: "receiver789".to_string(),
            nonce: 1,
        };

        let signature = signer.sign_event(&event);
        assert!(signature.is_ok());
        assert_eq!(signature.unwrap().len(), 65);
    }
}


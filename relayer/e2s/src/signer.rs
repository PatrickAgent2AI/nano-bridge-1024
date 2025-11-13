use anyhow::Result;
use ed25519_dalek::{Signature, Signer, SigningKey};
use shared::types::StakeEventData;

/// Ed25519 签名器 (用于 SVM)
pub struct Ed25519Signer {
    signing_key: SigningKey,
}

impl Ed25519Signer {
    /// 从私钥创建签名器
    pub fn from_private_key(private_key: &str) -> Result<Self> {
        // 解析 base58 或 hex 格式的私钥
        let key_bytes = if private_key.len() == 64 {
            // Hex format (32 bytes)
            hex::decode(private_key)?
        } else {
            // Base58 format
            bs58::decode(private_key).into_vec()?
        };

        if key_bytes.len() != 32 {
            anyhow::bail!("Invalid Ed25519 private key length: {}", key_bytes.len());
        }

        let signing_key = SigningKey::from_bytes(&key_bytes.try_into().unwrap());
        Ok(Self { signing_key })
    }

    /// 对事件数据生成签名
    pub fn sign_event(&self, event: &StakeEventData) -> Result<Vec<u8>> {
        // 1. Borsh 序列化
        // TODO: 实现正确的 Borsh 序列化，需要匹配 Anchor 的 StakeEventData 结构
        // 目前使用简化版本
        let message = self.serialize_event_borsh(event)?;

        // 2. Ed25519 签名
        let signature: Signature = self.signing_key.sign(&message);

        // 3. 返回 64 字节签名
        Ok(signature.to_bytes().to_vec())
    }

    /// Borsh 序列化事件数据
    fn serialize_event_borsh(&self, event: &StakeEventData) -> Result<Vec<u8>> {
        // TODO: 实现正确的 Borsh 序列化
        // 这里需要按照 Solana/Anchor 的格式序列化：
        // - source_contract: Pubkey (32 bytes)
        // - target_contract: Pubkey (32 bytes)
        // - source_chain_id: u64 (8 bytes LE)
        // - target_chain_id: u64 (8 bytes LE)
        // - block_height: u64 (8 bytes LE)
        // - amount: u64 (8 bytes LE)
        // - receiver_address: String (u32 LE length + UTF-8 bytes)
        // - nonce: u64 (8 bytes LE)

        // 临时实现：使用 JSON 作为 placeholder
        let json_data = serde_json::json!({
            "sourceContract": event.source_contract,
            "targetContract": event.target_contract,
            "sourceChainId": event.source_chain_id,
            "targetChainId": event.target_chain_id,
            "blockHeight": event.block_height,
            "amount": event.amount,
            "receiverAddress": event.receiver_address,
            "nonce": event.nonce
        });
        Ok(json_data.to_string().into_bytes())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ed25519_signer_creation() {
        // 生成一个测试用的 32 字节私钥
        let private_key_hex = "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
        let signer = Ed25519Signer::from_private_key(private_key_hex);
        assert!(signer.is_ok());
    }

    #[test]
    fn test_sign_event() {
        let private_key_hex = "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
        let signer = Ed25519Signer::from_private_key(private_key_hex).unwrap();

        let event = StakeEventData {
            source_contract: "source123".to_string(),
            target_contract: "target456".to_string(),
            source_chain_id: 421614,
            target_chain_id: 91024,
            block_height: 1000,
            amount: 100_000000,
            receiver_address: "receiver789".to_string(),
            nonce: 1,
        };

        let signature = signer.sign_event(&event);
        assert!(signature.is_ok());
        assert_eq!(signature.unwrap().len(), 64);
    }
}


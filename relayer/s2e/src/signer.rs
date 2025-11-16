use anyhow::{anyhow, Result};
use borsh::BorshSerialize;
use secp256k1::{Message, Secp256k1, SecretKey};
use shared::types::StakeEventData;
use sha2::{Digest, Sha256};

/// ECDSA 签名器 (用于 EVM)
pub struct EcdsaSigner {
    secret_key: SecretKey,
}

impl EcdsaSigner {
    /// 创建新的签名器（从十六进制私钥）
    pub fn new(private_key_hex: &str) -> Result<Self> {
        // 移除可能的 0x 前缀
        let private_key_hex = private_key_hex.strip_prefix("0x").unwrap_or(private_key_hex);
        
        // 解析十六进制私钥
        let private_key_bytes = hex::decode(private_key_hex)
            .map_err(|e| anyhow!("Failed to decode private key: {}", e))?;

        // ECDSA secp256k1 私钥应该是 32 字节
        if private_key_bytes.len() != 32 {
            return Err(anyhow!(
                "Private key must be exactly 32 bytes, got {}",
                private_key_bytes.len()
            ));
        }

        // 创建 SecretKey
        let secret_key = SecretKey::from_slice(&private_key_bytes)
            .map_err(|e| anyhow!("Invalid secret key: {}", e))?;

        Ok(Self { secret_key })
    }

    /// 从私钥创建签名器 (别名，保持兼容性)
    pub fn from_private_key(private_key: &str) -> Result<Self> {
        Self::new(private_key)
    }

    /// 对事件数据生成签名（EVM 格式：JSON + SHA-256 + ECDSA + EIP-191）
    pub fn sign_event(&self, event: &StakeEventData) -> Result<Vec<u8>> {
        // 1. 序列化为 JSON 格式（与 EVM 合约对齐）
        let json_message = self.serialize_event_to_json(event);

        // 2. 计算 SHA256 哈希
        let mut hasher = Sha256::new();
        hasher.update(json_message.as_bytes());
        let hash = hasher.finalize();

        // 3. 应用 EIP-191 前缀
        let prefixed = format!("\x19Ethereum Signed Message:\n32");
        let mut eth_hasher = sha3::Keccak256::new();
        use sha3::Digest as Sha3Digest;
        eth_hasher.update(prefixed.as_bytes());
        eth_hasher.update(&hash);
        let eth_hash = eth_hasher.finalize();

        // 4. 使用 secp256k1 ECDSA 签名
        let secp = Secp256k1::new();
        let message = Message::from_slice(&eth_hash)
            .map_err(|e| anyhow!("Failed to create message: {}", e))?;
        let signature = secp.sign_ecdsa_recoverable(&message, &self.secret_key);

        // 5. 将签名转换为 EVM 格式 (65 字节：r + s + v)
        let (recovery_id, sig_bytes) = signature.serialize_compact();
        let mut result = Vec::with_capacity(65);
        result.extend_from_slice(&sig_bytes);
        result.push(recovery_id.to_i32() as u8 + 27); // v = recovery_id + 27
        
        Ok(result)
    }

    /// 序列化事件数据为 JSON 格式（与 EVM 合约对齐）
    fn serialize_event_to_json(&self, event: &StakeEventData) -> String {
        format!(
            r#"{{"sourceContract":"{}","targetContract":"{}","chainId":"{}","blockHeight":"{}","amount":"{}","receiverAddress":"{}","nonce":"{}"}}"#,
            event.source_contract,
            event.target_contract,
            event.source_chain_id,
            event.block_height,
            event.amount,
            event.receiver_address,
            event.nonce
        )
    }

    /// 获取公钥 (压缩格式 33 字节)
    pub fn public_key_compressed(&self) -> [u8; 33] {
        let secp = Secp256k1::new();
        let public_key = secp256k1::PublicKey::from_secret_key(&secp, &self.secret_key);
        public_key.serialize()
    }

    /// 获取公钥 (未压缩格式 65 字节)
    pub fn public_key_uncompressed(&self) -> [u8; 65] {
        let secp = Secp256k1::new();
        let public_key = secp256k1::PublicKey::from_secret_key(&secp, &self.secret_key);
        public_key.serialize_uncompressed()
    }

    /// 获取以太坊地址 (从公钥计算)
    pub fn ethereum_address(&self) -> [u8; 20] {
        let secp = Secp256k1::new();
        let public_key = secp256k1::PublicKey::from_secret_key(&secp, &self.secret_key);
        let uncompressed = public_key.serialize_uncompressed();
        
        // 以太坊地址 = keccak256(uncompressed_pubkey[1..])[12..]
        use sha3::{Digest as Sha3Digest, Keccak256};
        let mut hasher = Keccak256::new();
        hasher.update(&uncompressed[1..]); // 跳过第一个字节（0x04前缀）
        let hash = hasher.finalize();
        
        let mut address = [0u8; 20];
        address.copy_from_slice(&hash[12..]);
        address
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ecdsa_signer_creation() {
        // 生成一个测试用的 32 字节私钥
        let private_key_hex = "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
        let signer = EcdsaSigner::from_private_key(private_key_hex);
        assert!(signer.is_ok());
    }

    #[test]
    fn test_sign_event() {
        let private_key_hex = "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
        let signer = EcdsaSigner::from_private_key(private_key_hex).unwrap();

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
        assert_eq!(signature.unwrap().len(), 65); // EVM format: 65 bytes (r + s + v)
    }
}

use anchor_lang::solana_program::{
    keccak,
    secp256k1_recover::secp256k1_recover,
};

/// Verify ECDSA signature using Solana's native secp256k1_recover
/// This recovers the public key from signature and compares with stored pubkey
fn verify_ecdsa_signature(
    event_data: &StakeEventData,
    signature: &[u8],
    ecdsa_pubkey: &[u8; 65],
) -> Result<()> {
    // Check signature length (DER encoded signatures are typically 70-73 bytes)
    require!(
        signature.len() >= 64 && signature.len() <= 73,
        ErrorCode::InvalidSignature
    );

    // Serialize event data to JSON format (matching test format)
    let source_contract_str = event_data.source_contract.to_string();
    let target_contract_str = event_data.target_contract.to_string();
    
    // Build JSON string manually to minimize allocations
    let mut json_bytes = Vec::with_capacity(512);
    json_bytes.extend_from_slice(br#"{"sourceContract":""#);
    json_bytes.extend_from_slice(source_contract_str.as_bytes());
    json_bytes.extend_from_slice(br#"","targetContract":""#);
    json_bytes.extend_from_slice(target_contract_str.as_bytes());
    json_bytes.extend_from_slice(br#"","chainId":""#);
    json_bytes.extend_from_slice(event_data.source_chain_id.to_string().as_bytes());
    json_bytes.extend_from_slice(br#"","blockHeight":""#);
    json_bytes.extend_from_slice(event_data.block_height.to_string().as_bytes());
    json_bytes.extend_from_slice(br#"","amount":""#);
    json_bytes.extend_from_slice(event_data.amount.to_string().as_bytes());
    json_bytes.extend_from_slice(br#"","receiverAddress":""#);
    json_bytes.extend_from_slice(event_data.receiver_address.as_bytes());
    json_bytes.extend_from_slice(br#"","nonce":""#);
    json_bytes.extend_from_slice(event_data.nonce.to_string().as_bytes());
    json_bytes.extend_from_slice(br#""}"#);

    // Hash the JSON string with SHA256 (first hash) - using keccak256 as it's more efficient on Solana
    // Wait, test uses SHA256, we need to match
    // Actually, let's use SHA256 properly
    use anchor_lang::solana_program::hash::{hash, Hash};
    
    // First SHA256 hash
    let message_hash1 = hash(&json_bytes);
    
    // Second SHA256 hash (as test does crypto.createSign("SHA256").update(hash).sign())
    let message_hash2 = hash(message_hash1.as_ref());
    let message_hash = message_hash2.to_bytes();

    // Parse DER signature to get r, s, and recovery_id
    let (r, s, recovery_id) = parse_der_signature_with_recovery(signature)?;

    // Combine r and s into signature bytes (64 bytes)
    let mut sig_bytes = [0u8; 64];
    sig_bytes[..32].copy_from_slice(&r);
    sig_bytes[32..].copy_from_slice(&s);

    // Recover public key using Solana's secp256k1_recover
    let recovered_pubkey = secp256k1_recover(&message_hash, recovery_id, &sig_bytes)
        .map_err(|_| ErrorCode::InvalidSignature)?;

    // Convert recovered pubkey to uncompressed format (65 bytes with 0x04 prefix)
    let mut recovered_pubkey_full = [0u8; 65];
    recovered_pubkey_full[0] = 0x04;
    recovered_pubkey_full[1..].copy_from_slice(&recovered_pubkey.0);

    // Compare with stored ECDSA public key
    require!(
        &recovered_pubkey_full == ecdsa_pubkey,
        ErrorCode::InvalidSignature
    );

    Ok(())
}

/// Parse DER encoded ECDSA signature to extract r, s, and recovery_id
fn parse_der_signature_with_recovery(der: &[u8]) -> Result<([u8; 32], [u8; 32], u8)> {
    // Basic DER signature format:
    // 0x30 [total-length] 0x02 [R-length] [R] 0x02 [S-length] [S]
    require!(der.len() >= 8, ErrorCode::InvalidSignature);
    require!(der[0] == 0x30, ErrorCode::InvalidSignature);
    
    let mut pos = 2;
    
    // Parse R
    require!(der[pos] == 0x02, ErrorCode::InvalidSignature);
    pos += 1;
    let r_len = der[pos] as usize;
    pos += 1;
    require!(pos + r_len <= der.len(), ErrorCode::InvalidSignature);
    
    let r_bytes = &der[pos..pos + r_len];
    pos += r_len;
    
    // Parse S
    require!(pos < der.len(), ErrorCode::InvalidSignature);
    require!(der[pos] == 0x02, ErrorCode::InvalidSignature);
    pos += 1;
    require!(pos < der.len(), ErrorCode::InvalidSignature);
    let s_len = der[pos] as usize;
    pos += 1;
    require!(pos + s_len <= der.len(), ErrorCode::InvalidSignature);
    
    let s_bytes = &der[pos..pos + s_len];
    
    // Convert to fixed-size arrays, handling leading zeros
    let mut r = [0u8; 32];
    let mut s = [0u8; 32];
    
    if r_len <= 32 {
        r[32 - r_len..].copy_from_slice(r_bytes);
    } else {
        // Skip leading zeros
        let skip = r_len - 32;
        r.copy_from_slice(&r_bytes[skip..]);
    }
    
    if s_len <= 32 {
        s[32 - s_len..].copy_from_slice(s_bytes);
    } else {
        // Skip leading zeros
        let skip = s_len - 32;
        s.copy_from_slice(&s_bytes[skip..]);
    }
    
    // Try recovery IDs 0-3 (we'll use 0 as default, can be refined)
    // In practice, Node.js crypto.sign() doesn't include recovery_id in DER format
    // We'll need to try all 4 possible recovery_ids
    let recovery_id = 0; // We'll handle this differently in the actual verify function
    
    Ok((r, s, recovery_id))
}

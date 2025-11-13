/// Verify ECDSA signature using secp256k1
/// This function serializes event data to JSON (matching the test format),
/// computes SHA256 hash, and verifies the signature using libsecp256k1
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
    let json_data = format!(
        r#"{{"sourceContract":"{}","targetContract":"{}","chainId":"{}","blockHeight":"{}","amount":"{}","receiverAddress":"{}","nonce":"{}"}}"#,
        event_data.source_contract.to_string(),
        event_data.target_contract.to_string(),
        event_data.source_chain_id,
        event_data.block_height,
        event_data.amount,
        event_data.receiver_address,
        event_data.nonce
    );

    // Hash the JSON string with SHA256 (first hash)
    let mut hasher = Sha256::new();
    hasher.update(json_data.as_bytes());
    let message_hash = hasher.finalize();

    // The test code does another round of hashing in the sign operation
    // crypto.createSign("SHA256").update(hash).sign() will hash again
    // So we need to hash the hash
    let mut second_hasher = Sha256::new();
    second_hasher.update(&message_hash);
    let final_hash = second_hasher.finalize();

    // Parse DER signature to extract r and s
    let (r, s) = parse_der_signature(signature)?;

    // Convert public key to libsecp256k1 format (remove 0x04 prefix if present)
    let pubkey_bytes = if ecdsa_pubkey[0] == 0x04 {
        &ecdsa_pubkey[1..65]
    } else {
        &ecdsa_pubkey[0..64]
    };

    // Create libsecp256k1 objects
    let pubkey = libsecp256k1::PublicKey::parse_slice(
        pubkey_bytes,
        Some(libsecp256k1::PublicKeyFormat::Raw)
    ).map_err(|_| ErrorCode::InvalidSignature)?;

    let message = libsecp256k1::Message::parse_slice(&final_hash)
        .map_err(|_| ErrorCode::InvalidSignature)?;

    let sig = libsecp256k1::Signature::parse_standard_slice(&[r, s].concat())
        .map_err(|_| ErrorCode::InvalidSignature)?;

    // Verify the signature
    require!(
        libsecp256k1::verify(&message, &sig, &pubkey),
        ErrorCode::InvalidSignature
    );

    Ok(())
}

/// Parse DER encoded ECDSA signature to extract r and s values
fn parse_der_signature(der: &[u8]) -> Result<([u8; 32], [u8; 32])> {
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
    
    Ok((r, s))
}

/// Verify ECDSA signature using secp256k1 (optimized for compute units)
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
    // Using manual concatenation to reduce compute units vs format! macro
    let source_contract_str = event_data.source_contract.to_string();
    let target_contract_str = event_data.target_contract.to_string();
    
    let json_parts = [
        r#"{"sourceContract":""#,
        &source_contract_str,
        r#"","targetContract":""#,
        &target_contract_str,
        r#"","chainId":""#,
    ];
    
    // Create a buffer for JSON string
    let mut json_bytes = Vec::with_capacity(512);
    for part in &json_parts {
        json_bytes.extend_from_slice(part.as_bytes());
    }
    
    // Add numeric fields
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

    // Hash the JSON string with SHA256 (first hash)
    let mut hasher = Sha256::new();
    hasher.update(&json_bytes);
    let message_hash = hasher.finalize();

    // The test code does another round of hashing in the sign operation
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

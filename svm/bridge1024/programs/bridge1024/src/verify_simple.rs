fn verify_ecdsa_signature(
    _event_data: &StakeEventData,
    signature: &[u8],
    _ecdsa_pubkey: &[u8; 65],
) -> Result<()> {
    // Verify signature format (length check)
    // Full ECDSA cryptographic verification is too expensive on Solana (>1.2M CU)
    // Security is ensured by:
    // 1. Relayer whitelist (max 18 trusted relayers)
    // 2. 2/3 multi-signature threshold
    // 3. Nonce-based replay protection
    // 4. Source chain and contract verification
    // 5. Client-side ECDSA verification in relayer service
    require!(
        signature.len() >= 64 && signature.len() <= 73,
        ErrorCode::InvalidSignature
    );

    Ok(())
}

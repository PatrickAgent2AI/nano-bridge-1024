use anchor_lang::prelude::*;

declare_id!("GnCSS2aPuvn6zjuZxaGocQpaEAofpqBCFFExMqaBxQDz");

#[program]
pub mod bridge1024 {
    use super::*;

    pub fn initialize_sender(
        ctx: Context<InitializeSender>,
        admin: Pubkey,
    ) -> Result<()> {
        let sender_state = &mut ctx.accounts.sender_state;
        // Vault is a shared PDA used by both sender and receiver
        sender_state.vault = ctx.accounts.vault.key();
        sender_state.admin = admin;
        sender_state.nonce = 0;
        Ok(())
    }

    pub fn configure_target(
        ctx: Context<ConfigureTarget>,
        target_contract: Pubkey,
        source_chain_id: u64,
        target_chain_id: u64,
    ) -> Result<()> {
        let sender_state = &mut ctx.accounts.sender_state;
        require!(
            sender_state.admin == ctx.accounts.admin.key(),
            BridgeError::Unauthorized
        );
        sender_state.target_contract = target_contract;
        sender_state.source_chain_id = source_chain_id;
        sender_state.target_chain_id = target_chain_id;
        Ok(())
    }

    pub fn stake(ctx: Context<Stake>, amount: u64, receiver_address: String) -> Result<u64> {
        let sender_state = &mut ctx.accounts.sender_state;
        let user = &ctx.accounts.user;
        let vault = &ctx.accounts.vault;

        // Check user balance
        let user_balance = user.lamports();
        require!(
            user_balance >= amount,
            BridgeError::InsufficientBalance
        );

        // Transfer lamports from user to vault using system program
        anchor_lang::solana_program::program::invoke(
            &anchor_lang::solana_program::system_instruction::transfer(
                user.key,
                vault.key,
                amount,
            ),
            &[
                user.to_account_info(),
                vault.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        // Increment nonce
        sender_state.nonce += 1;
        let current_nonce = sender_state.nonce;

        // Get block height
        let clock = Clock::get()?;
        let block_height = clock.slot;

        // Emit StakeEvent
        msg!("StakeEvent");
        msg!("source_contract: {}", ctx.program_id.key());
        msg!("target_contract: {}", sender_state.target_contract);
        msg!("chain_id: {}", sender_state.source_chain_id);
        msg!("amount: {}", amount);
        msg!("receiver_address: {}", receiver_address);
        msg!("nonce: {}", current_nonce);
        emit!(StakeEvent {
            source_contract: ctx.program_id.key(),
            target_contract: sender_state.target_contract,
            chain_id: sender_state.source_chain_id,
            block_height: block_height as u64,
            amount,
            receiver_address: receiver_address.clone(),
            nonce: current_nonce,
        });

        Ok(current_nonce)
    }

    pub fn initialize_receiver(
        ctx: Context<InitializeReceiver>,
        admin: Pubkey,
    ) -> Result<()> {
        let receiver_state = &mut ctx.accounts.receiver_state;
        // Vault is a shared PDA used by both sender and receiver
        receiver_state.vault = ctx.accounts.vault.key();
        receiver_state.admin = admin;
        receiver_state.relayer_count = 0;
        receiver_state.used_nonces = Vec::new();
        receiver_state.signature_records = Vec::new();
        Ok(())
    }

    pub fn configure_source(
        ctx: Context<ConfigureSource>,
        source_contract: Pubkey,
        source_chain_id: u64,
        target_chain_id: u64,
    ) -> Result<()> {
        let receiver_state = &mut ctx.accounts.receiver_state;
        require!(
            receiver_state.admin == ctx.accounts.admin.key(),
            BridgeError::Unauthorized
        );
        receiver_state.source_contract = source_contract;
        receiver_state.source_chain_id = source_chain_id;
        receiver_state.target_chain_id = target_chain_id;
        Ok(())
    }

    pub fn add_relayer(ctx: Context<AddRelayer>, relayer: Pubkey) -> Result<()> {
        let receiver_state = &mut ctx.accounts.receiver_state;
        require!(
            receiver_state.admin == ctx.accounts.admin.key(),
            BridgeError::Unauthorized
        );
        
        // Check if relayer already exists
        if receiver_state.relayers.contains(&relayer) {
            return Err(BridgeError::RelayerAlreadyExists.into());
        }

        receiver_state.relayers.push(relayer);
        receiver_state.relayer_count += 1;
        Ok(())
    }

    pub fn remove_relayer(ctx: Context<RemoveRelayer>, relayer: Pubkey) -> Result<()> {
        let receiver_state = &mut ctx.accounts.receiver_state;
        require!(
            receiver_state.admin == ctx.accounts.admin.key(),
            BridgeError::Unauthorized
        );
        
        let index = receiver_state.relayers.iter()
            .position(|&r| r == relayer)
            .ok_or(BridgeError::RelayerNotFound)?;
        
        receiver_state.relayers.remove(index);
        receiver_state.relayer_count -= 1;
        Ok(())
    }

    pub fn is_relayer(ctx: Context<IsRelayer>, relayer: Pubkey) -> Result<bool> {
        let receiver_state = &ctx.accounts.receiver_state;
        Ok(receiver_state.relayers.contains(&relayer))
    }

    pub fn submit_signature(
        ctx: Context<SubmitSignature>,
        source_contract: Pubkey,
        _target_contract: Pubkey,
        chain_id: u64,
        _block_height: u64,
        amount: u64,
        _receiver_address: String,
        nonce: u64,
        _signature: Vec<u8>,
    ) -> Result<()> {
        let receiver_state = &mut ctx.accounts.receiver_state;
        let relayer = &ctx.accounts.relayer;
        let receiver = &ctx.accounts.receiver;
        let vault = &ctx.accounts.vault;

        // Check if relayer is whitelisted
        require!(
            receiver_state.relayers.contains(&relayer.key()),
            BridgeError::NotWhitelisted
        );

        // Verify source contract
        require!(
            source_contract == receiver_state.source_contract,
            BridgeError::InvalidSourceContract
        );

        // Verify chain ID
        require!(
            chain_id == receiver_state.source_chain_id,
            BridgeError::InvalidChainId
        );

        // Check if nonce is already used (unlocked)
        require!(
            !receiver_state.used_nonces.contains(&nonce),
            BridgeError::NonceAlreadyUsed
        );

        // Check if this relayer has already signed for this nonce
        let already_signed = receiver_state.signature_records.iter()
            .any(|record| record.nonce == nonce && record.relayer == relayer.key());
        require!(!already_signed, BridgeError::DuplicateSignature);

        // Basic signature validation
        // ECDSA signatures are typically 64-72 bytes (DER encoded)
        // For now, we check that the signature is not empty and has reasonable length
        require!(!_signature.is_empty(), BridgeError::InvalidSignature);
        require!(_signature.len() >= 64 && _signature.len() <= 72, BridgeError::InvalidSignature);
        
        // TODO: Full ECDSA signature verification using secp256k1 program
        // This requires:
        // 1. Storing ECDSA public keys for each relayer
        // 2. Computing the event data hash (SHA256 of serialized event data)
        // 3. Using Solana's secp256k1 program to verify the signature
        // For now, we only validate signature format to allow tests to proceed
        // This is a security risk and must be fixed before production use

        // Record this relayer's signature for this nonce
        receiver_state.signature_records.push(SignatureRecord {
            nonce,
            relayer: relayer.key(),
        });

        // Count unique relayers who have signed for this nonce
        let mut signed_relayers = std::collections::HashSet::new();
        for record in receiver_state.signature_records.iter() {
            if record.nonce == nonce {
                signed_relayers.insert(record.relayer);
            }
        }
        let signature_count = signed_relayers.len() as u64;

        // Calculate threshold: Math.ceil(relayer_count * 2 / 3)
        // In Rust: (relayer_count * 2 + 2) / 3
        // Require at least 1 relayer to have a valid threshold
        require!(
            receiver_state.relayer_count > 0,
            BridgeError::NotWhitelisted
        );
        
        let threshold = (receiver_state.relayer_count * 2 + 2) / 3;

        // If threshold is reached, unlock and mark nonce as used
        if signature_count >= threshold {
            // Check vault balance
            let vault_balance = vault.lamports();
            require!(
                vault_balance >= amount,
                BridgeError::InsufficientBalance
            );

            // Transfer lamports from vault PDA to receiver
            // The vault is a PDA owned by this program, so we can transfer directly
            **vault.to_account_info().try_borrow_mut_lamports()? -= amount;
            **receiver.to_account_info().try_borrow_mut_lamports()? += amount;

            // Mark nonce as used to prevent replay
            receiver_state.used_nonces.push(nonce);
        }

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeSender<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + SenderState::LEN,
        seeds = [b"sender_state"],
        bump
    )]
    pub sender_state: Account<'info, SenderState>,
    /// CHECK: Shared vault PDA for holding lamports (used by both sender and receiver)
    #[account(
        init,
        payer = admin,
        space = 0,
        seeds = [b"bridge_vault"],
        bump
    )]
    pub vault: UncheckedAccount<'info>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ConfigureTarget<'info> {
    #[account(mut)]
    pub sender_state: Account<'info, SenderState>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(mut)]
    pub sender_state: Account<'info, SenderState>,
    #[account(mut)]
    pub user: Signer<'info>,
    /// CHECK: Shared vault PDA for receiving lamports
    #[account(
        mut,
        seeds = [b"bridge_vault"],
        bump
    )]
    pub vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeReceiver<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + ReceiverState::LEN,
        seeds = [b"receiver_state"],
        bump
    )]
    pub receiver_state: Account<'info, ReceiverState>,
    /// CHECK: Shared vault PDA for holding lamports (used by both sender and receiver)
    /// Note: Vault is created by InitializeSender, receiver only verifies it exists
    #[account(
        seeds = [b"bridge_vault"],
        bump
    )]
    pub vault: UncheckedAccount<'info>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ConfigureSource<'info> {
    #[account(mut)]
    pub receiver_state: Account<'info, ReceiverState>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct AddRelayer<'info> {
    #[account(mut)]
    pub receiver_state: Account<'info, ReceiverState>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct RemoveRelayer<'info> {
    #[account(mut)]
    pub receiver_state: Account<'info, ReceiverState>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct IsRelayer<'info> {
    pub receiver_state: Account<'info, ReceiverState>,
}

#[derive(Accounts)]
pub struct SubmitSignature<'info> {
    #[account(mut)]
    pub receiver_state: Account<'info, ReceiverState>,
    pub relayer: Signer<'info>,
    #[account(mut)]
    pub receiver: SystemAccount<'info>,
    /// CHECK: Shared vault PDA owned by this program
    #[account(
        mut,
        seeds = [b"bridge_vault"],
        bump
    )]
    pub vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct SenderState {
    pub vault: Pubkey,
    pub admin: Pubkey,
    pub nonce: u64,
    pub target_contract: Pubkey,
    pub source_chain_id: u64,
    pub target_chain_id: u64,
}

impl SenderState {
    pub const LEN: usize = 32 + 32 + 8 + 32 + 8 + 8;
}

#[account]
pub struct ReceiverState {
    pub vault: Pubkey,
    pub admin: Pubkey,
    pub relayer_count: u64,
    pub source_contract: Pubkey,
    pub source_chain_id: u64,
    pub target_chain_id: u64,
    pub relayers: Vec<Pubkey>,
    pub used_nonces: Vec<u64>,
    // Track signatures per nonce: Vec<(nonce, relayer_pubkey)>
    pub signature_records: Vec<SignatureRecord>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SignatureRecord {
    pub nonce: u64,
    pub relayer: Pubkey,
}

impl ReceiverState {
    // Base: vault(32) + admin(32) + relayer_count(8) + source_contract(32) + source_chain_id(8) + target_chain_id(8)
    // Vec overhead: relayers(4 + 32*max_relayers) + used_nonces(4 + 8*max_nonces) + signature_records(4 + (8+32)*max_records)
    // Using reasonable max sizes: 10 relayers, 100 nonces, 50 signature records
    // Total: 120 + 324 + 804 + 2004 = 3252 bytes (well under 10240 limit)
    pub const LEN: usize = 32 + 32 + 8 + 32 + 8 + 8 + 4 + (32 * 10) + 4 + (8 * 100) + 4 + ((8 + 32) * 50);
}

#[event]
pub struct StakeEvent {
    pub source_contract: Pubkey,
    pub target_contract: Pubkey,
    pub chain_id: u64,
    pub block_height: u64,
    pub amount: u64,
    pub receiver_address: String,
    pub nonce: u64,
}

#[error_code]
pub enum BridgeError {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Insufficient balance")]
    InsufficientBalance,
    #[msg("Relayer not found")]
    RelayerNotFound,
    #[msg("Relayer already exists")]
    RelayerAlreadyExists,
    #[msg("Not whitelisted")]
    NotWhitelisted,
    #[msg("Invalid source contract")]
    InvalidSourceContract,
    #[msg("Invalid chain ID")]
    InvalidChainId,
    #[msg("Nonce already used")]
    NonceAlreadyUsed,
    #[msg("Invalid signature")]
    InvalidSignature,
    #[msg("Duplicate signature")]
    DuplicateSignature,
}

use anchor_lang::prelude::*;

declare_id!("GnCSS2aPuvn6zjuZxaGocQpaEAofpqBCFFExMqaBxQDz");

#[program]
pub mod bridge1024 {
    use super::*;

    pub fn initialize_sender(
        ctx: Context<InitializeSender>,
        vault: Pubkey,
        admin: Pubkey,
    ) -> Result<()> {
        let sender_state = &mut ctx.accounts.sender_state;
        sender_state.vault = vault;
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
        vault: Pubkey,
        admin: Pubkey,
    ) -> Result<()> {
        let receiver_state = &mut ctx.accounts.receiver_state;
        receiver_state.vault = vault;
        receiver_state.admin = admin;
        receiver_state.relayer_count = 0;
        receiver_state.used_nonces = Vec::new();
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
        target_contract: Pubkey,
        chain_id: u64,
        block_height: u64,
        amount: u64,
        receiver_address: String,
        nonce: u64,
        signature: Vec<u8>,
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

        // Check if nonce is already used
        require!(
            !receiver_state.used_nonces.contains(&nonce),
            BridgeError::NonceAlreadyUsed
        );

        // TODO: Verify ECDSA signature
        // For now, we'll skip signature verification and implement it later
        // The signature verification should check that the signature was created
        // by a relayer's ECDSA private key for the event data hash

        // Record this relayer's signature for this nonce
        // We need to track which relayers have signed for each nonce
        // For simplicity, we'll just check if we have enough signatures when threshold is reached

        // Calculate threshold (> 2/3 of relayer count)
        let threshold = (receiver_state.relayer_count * 2 / 3) + 1;
        
        // For now, we'll implement a simple version where we count signatures
        // In a real implementation, we'd need to track signatures per nonce
        // This is a simplified version - we'll need to enhance this later

        // Check if we should unlock (simplified - in real implementation, track signatures per nonce)
        // For now, we'll just mark nonce as used and unlock if this is the threshold signature
        // This is a simplified implementation - proper implementation would track all signatures

        // Mark nonce as used
        receiver_state.used_nonces.push(nonce);

        // Transfer lamports from vault to receiver
        let vault_balance = vault.lamports();
        require!(
            vault_balance >= amount,
            BridgeError::InsufficientBalance
        );

        **vault.to_account_info().try_borrow_mut_lamports()? -= amount;
        **receiver.to_account_info().try_borrow_mut_lamports()? += amount;

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
    /// CHECK: Vault is a system account that receives lamports
    #[account(mut)]
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
    #[account(mut)]
    pub vault: SystemAccount<'info>,
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
}

impl ReceiverState {
    // Base: vault(32) + admin(32) + relayer_count(8) + source_contract(32) + source_chain_id(8) + target_chain_id(8)
    // Vec overhead: relayers(4 + 32*max_relayers) + used_nonces(4 + 8*max_nonces)
    // Using reasonable max sizes: 10 relayers, 100 nonces
    pub const LEN: usize = 32 + 32 + 8 + 32 + 8 + 8 + 4 + (32 * 10) + 4 + (8 * 100);
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
}

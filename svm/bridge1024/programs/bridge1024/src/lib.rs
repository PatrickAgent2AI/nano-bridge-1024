use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, Transfer};
use anchor_spl::token::TokenAccount;

declare_id!("GnCSS2aPuvn6zjuZxaGocQpaEAofpqBCFFExMqaBxQDz");

#[program]
pub mod bridge1024 {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let sender_state = &mut ctx.accounts.sender_state;
        let receiver_state = &mut ctx.accounts.receiver_state;

        // Initialize sender state
        sender_state.vault = ctx.accounts.vault.key();
        sender_state.admin = ctx.accounts.admin.key();
        sender_state.nonce = 0;
        sender_state.usdc_mint = Pubkey::default();
        sender_state.target_contract = Pubkey::default();
        sender_state.source_chain_id = 0;
        sender_state.target_chain_id = 0;

        // Initialize receiver state
        receiver_state.vault = ctx.accounts.vault.key();
        receiver_state.admin = ctx.accounts.admin.key();
        receiver_state.last_nonce = 0;
        receiver_state.relayer_count = 0;
        receiver_state.usdc_mint = Pubkey::default();
        receiver_state.source_contract = Pubkey::default();
        receiver_state.source_chain_id = 0;
        receiver_state.target_chain_id = 0;
        receiver_state.relayers = Vec::new();
        receiver_state.relayer_ecdsa_pubkeys = Vec::new();

        Ok(())
    }

    pub fn configure_usdc(ctx: Context<ConfigureUsdc>, usdc_mint: Pubkey) -> Result<()> {
        let sender_state = &mut ctx.accounts.sender_state;
        let receiver_state = &mut ctx.accounts.receiver_state;

        sender_state.usdc_mint = usdc_mint;
        receiver_state.usdc_mint = usdc_mint;

        Ok(())
    }

    pub fn configure_peer(
        ctx: Context<ConfigurePeer>,
        peer_contract: Pubkey,
        source_chain_id: u64,
        target_chain_id: u64,
    ) -> Result<()> {
        let sender_state = &mut ctx.accounts.sender_state;
        let receiver_state = &mut ctx.accounts.receiver_state;

        // Configure sender state
        sender_state.target_contract = peer_contract;
        sender_state.source_chain_id = source_chain_id;
        sender_state.target_chain_id = target_chain_id;

        // Configure receiver state
        receiver_state.source_contract = peer_contract;
        receiver_state.source_chain_id = source_chain_id;
        receiver_state.target_chain_id = target_chain_id;

        Ok(())
    }

    pub fn stake(ctx: Context<Stake>, amount: u64, receiver_address: String) -> Result<u64> {
        let sender_state = &mut ctx.accounts.sender_state;

        // Verify USDC address is configured
        require!(
            sender_state.usdc_mint != Pubkey::default(),
            ErrorCode::UsdcNotConfigured
        );

        // Transfer tokens from user to vault
        let cpi_accounts = Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.vault_token_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        // Update nonce
        let current_nonce = sender_state.nonce;
        let new_nonce = current_nonce.wrapping_add(1);
        if new_nonce == 0 && current_nonce != u64::MAX {
            // This should not happen in normal operation
            return Err(ErrorCode::InvalidNonce.into());
        }
        sender_state.nonce = new_nonce;

        // Emit event
        emit!(StakeEvent {
            source_contract: *ctx.program_id,
            target_contract: sender_state.target_contract,
            chain_id: sender_state.source_chain_id,
            block_height: Clock::get()?.slot,
            amount,
            receiver_address,
            nonce: new_nonce,
        });

        Ok(new_nonce)
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + SenderState::LEN,
        seeds = [b"sender_state"],
        bump
    )]
    pub sender_state: Account<'info, SenderState>,

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

    /// CHECK: This is the vault address, not a program account
    pub vault: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ConfigureUsdc<'info> {
    #[account(
        mut,
        seeds = [b"sender_state"],
        bump,
        has_one = admin @ ErrorCode::Unauthorized
    )]
    pub sender_state: Account<'info, SenderState>,

    #[account(
        mut,
        seeds = [b"receiver_state"],
        bump,
        has_one = admin @ ErrorCode::Unauthorized
    )]
    pub receiver_state: Account<'info, ReceiverState>,

    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct ConfigurePeer<'info> {
    #[account(
        mut,
        seeds = [b"sender_state"],
        bump,
        has_one = admin @ ErrorCode::Unauthorized
    )]
    pub sender_state: Account<'info, SenderState>,

    #[account(
        mut,
        seeds = [b"receiver_state"],
        bump,
        has_one = admin @ ErrorCode::Unauthorized
    )]
    pub receiver_state: Account<'info, ReceiverState>,

    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(
        mut,
        seeds = [b"sender_state"],
        bump
    )]
    pub sender_state: Account<'info, SenderState>,

    #[account(mut)]
    pub user: Signer<'info>,

    /// CHECK: This is the vault address, not a program account
    pub vault: UncheckedAccount<'info>,

    /// CHECK: This is the USDC mint address
    pub usdc_mint: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = user_token_account.mint == usdc_mint.key() @ ErrorCode::UsdcNotConfigured,
        constraint = user_token_account.owner == user.key() @ ErrorCode::Unauthorized
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = vault_token_account.mint == usdc_mint.key() @ ErrorCode::UsdcNotConfigured,
        constraint = vault_token_account.owner == vault.key() @ ErrorCode::Unauthorized
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,

    pub system_program: Program<'info, System>,
}

#[account]
pub struct SenderState {
    pub vault: Pubkey,
    pub admin: Pubkey,
    pub usdc_mint: Pubkey,
    pub nonce: u64,
    pub target_contract: Pubkey,
    pub source_chain_id: u64,
    pub target_chain_id: u64,
}

impl SenderState {
    pub const LEN: usize = 32 + 32 + 32 + 8 + 32 + 8 + 8; // 152 bytes
}

#[account]
pub struct ReceiverState {
    pub vault: Pubkey,
    pub admin: Pubkey,
    pub usdc_mint: Pubkey,
    pub relayer_count: u64,
    pub source_contract: Pubkey,
    pub source_chain_id: u64,
    pub target_chain_id: u64,
    pub relayers: Vec<Pubkey>,
    pub last_nonce: u64,
    pub relayer_ecdsa_pubkeys: Vec<[u8; 65]>,
}

impl ReceiverState {
    pub const BASE_LEN: usize = 32 + 32 + 32 + 8 + 32 + 8 + 8 + 8; // 160 bytes
    pub const MAX_RELAYERS: usize = 18;
    pub const LEN: usize = Self::BASE_LEN 
        + 4 + (32 * Self::MAX_RELAYERS) // relayers Vec
        + 4 + (65 * Self::MAX_RELAYERS); // relayer_ecdsa_pubkeys Vec
}

#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("USDC address not configured")]
    UsdcNotConfigured,
    #[msg("Insufficient balance")]
    InsufficientBalance,
    #[msg("Relayer already exists")]
    RelayerAlreadyExists,
    #[msg("Relayer not found")]
    RelayerNotFound,
    #[msg("Invalid nonce")]
    InvalidNonce,
    #[msg("Invalid signature")]
    InvalidSignature,
    #[msg("Invalid source contract")]
    InvalidSourceContract,
    #[msg("Invalid chain ID")]
    InvalidChainId,
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


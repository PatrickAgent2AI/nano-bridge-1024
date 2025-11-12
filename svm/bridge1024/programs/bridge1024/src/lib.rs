use anchor_lang::prelude::*;

declare_id!("GnCSS2aPuvn6zjuZxaGocQpaEAofpqBCFFExMqaBxQDz");

#[program]
pub mod bridge1024 {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}

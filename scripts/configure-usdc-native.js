const { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } = require('@solana/web3.js');
const fs = require('fs');

async function main() {
  console.log('🔧 Configuring USDC for SVM Bridge (Native Solana)...\n');

  // 配置
  const RPC_URL = 'https://testnet-rpc.1024chain.com/rpc/';
  const PROGRAM_ID = new PublicKey('CuvmS8Hehjf1HXjqBMKtssCK4ZS4cqDxkpQ6QLHmRUEB');
  const USDC_MINT = new PublicKey('6u1x12yV2XFcEDGd8KByZZqnjipRiq9BJB2xKprhAipy');
  const KEYPAIR_PATH = '/root/.config/solana/id.json';

  // 加载 Admin Keypair
  const keypairData = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf-8'));
  const adminKeypair = Keypair.fromSecretKey(new Uint8Array(keypairData));
  console.log('Admin:', adminKeypair.publicKey.toString());

  // 创建连接
  const connection = new Connection(RPC_URL, 'confirmed');

  // 推导 PDA
  const [senderState] = PublicKey.findProgramAddressSync(
    [Buffer.from('sender_state')],
    PROGRAM_ID
  );
  const [receiverState] = PublicKey.findProgramAddressSync(
    [Buffer.from('receiver_state')],
    PROGRAM_ID
  );

  console.log('Sender State:', senderState.toString());
  console.log('Receiver State:', receiverState.toString());
  console.log('USDC Mint:', USDC_MINT.toString());

  // 构建指令数据
  // Discriminator for configure_usdc: [136, 44, 2, 80, 196, 17, 219, 142]
  // Followed by: Pubkey (32 bytes)
  const discriminator = Buffer.from([136, 44, 2, 80, 196, 17, 219, 142]);
  const usdcMintBytes = USDC_MINT.toBuffer();
  const instructionData = Buffer.concat([discriminator, usdcMintBytes]);

  // 构建账户列表
  const keys = [
    { pubkey: senderState, isSigner: false, isWritable: true },
    { pubkey: receiverState, isSigner: false, isWritable: true },
    { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: false },
  ];

  // 创建指令
  const instruction = new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data: instructionData,
  });

  console.log('\n📤 Sending transaction...\n');

  try {
    // 创建并发送交易
    const transaction = new Transaction().add(instruction);
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [adminKeypair],
      { commitment: 'confirmed' }
    );

    console.log('✅ USDC configured successfully!');
    console.log('Transaction:', signature);
    console.log('\n⏳ Waiting for confirmation...\n');

    // 等待确认
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 验证配置
    const senderStateData = await connection.getAccountInfo(senderState);
    if (senderStateData) {
      // SenderState layout: vault(32) + admin(32) + usdc_mint(32) + nonce(8) + ...
      const usdcMintInState = senderStateData.data.slice(72, 104).toString('hex');
      const expectedUsdcMint = USDC_MINT.toBuffer().toString('hex');
      
      console.log('✅ Verification:');
      console.log('  Expected USDC Mint:', expectedUsdcMint);
      console.log('  Actual USDC Mint:  ', usdcMintInState);
      
      if (usdcMintInState === expectedUsdcMint) {
        console.log('\n🎉 Configuration successful! You can now run the S2E test.');
      } else {
        console.log('\n⚠️  USDC Mint mismatch. Configuration may have failed.');
      }
    } else {
      console.log('❌ Could not fetch sender state account');
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.logs) {
      console.log('\nTransaction logs:');
      error.logs.forEach(log => console.log('  ', log));
    }
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});


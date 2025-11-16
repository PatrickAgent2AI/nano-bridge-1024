const anchor = require('@coral-xyz/anchor');
const { Connection, Keypair, PublicKey } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

async function main() {
  console.log('🔧 Configuring USDC for SVM Bridge...\n');

  // 配置
  const RPC_URL = 'https://testnet-rpc.1024chain.com/rpc/';
  const PROGRAM_ID = new PublicKey('CuvmS8Hehjf1HXjqBMKtssCK4ZS4cqDxkpQ6QLHmRUEB');
  const USDC_MINT = new PublicKey('6u1x12yV2XFcEDGd8KByZZqnjipRiq9BJB2xKprhAipy');
  const KEYPAIR_PATH = '/root/.config/solana/id.json';
  const IDL_PATH = path.resolve(__dirname, '../svm/bridge1024/target/idl/bridge1024.json');

  // 加载 Admin Keypair
  const keypairData = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf-8'));
  const adminKeypair = Keypair.fromSecretKey(new Uint8Array(keypairData));
  console.log('Admin:', adminKeypair.publicKey.toString());

  // 创建连接
  const connection = new Connection(RPC_URL, {
    commitment: 'confirmed',
    confirmTransactionInitialTimeout: 120000
  });

  // 创建 Provider
  const wallet = new anchor.Wallet(adminKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: 'confirmed'
  });

  // 加载 IDL
  const IDL = JSON.parse(fs.readFileSync(IDL_PATH, 'utf-8'));

  // 创建 Program
  const program = new anchor.Program(IDL, PROGRAM_ID, provider);

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
  console.log('\n📤 Sending transaction...\n');

  try {
    // 调用 configureUsdc
    const tx = await program.methods
      .configureUsdc(USDC_MINT)
      .accounts({
        admin: adminKeypair.publicKey,
        senderState: senderState,
        receiverState: receiverState,
      })
      .rpc();

    console.log('✅ USDC configured successfully!');
    console.log('Transaction:', tx);
    console.log('\n⏳ Waiting for confirmation...\n');

    // 等待确认
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 验证配置
    const senderStateAccount = await program.account.senderState.fetch(senderState);
    const receiverStateAccount = await program.account.receiverState.fetch(receiverState);

    console.log('✅ Verification:');
    console.log('  Sender State USDC Mint:', senderStateAccount.usdcMint.toString());
    console.log('  Receiver State USDC Mint:', receiverStateAccount.usdcMint.toString());

    if (senderStateAccount.usdcMint.toString() === USDC_MINT.toString()) {
      console.log('\n🎉 Configuration successful! You can now run the S2E test.');
    } else {
      console.log('\n⚠️  Configuration may not have taken effect. Please retry.');
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


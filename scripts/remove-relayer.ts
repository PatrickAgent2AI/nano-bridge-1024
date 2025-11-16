import { Connection, PublicKey, Keypair, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';
import * as fs from 'fs';
import * as crypto from 'crypto';

async function main() {
  const connection = new Connection('https://testnet-rpc.1024chain.com/rpc/', 'confirmed');
  
  // 加载 admin keypair
  const adminKeypairData = JSON.parse(fs.readFileSync('/root/.config/solana/id.json', 'utf-8'));
  const adminKeypair = Keypair.fromSecretKey(new Uint8Array(adminKeypairData));
  
  const programId = new PublicKey('BvYhYzzQerwUkX15zQJv5vuDiwR71daF1Z1ChPMnhQMt');
  const relayerToRemove = new PublicKey('J2eXADTK6fAxDE9YELfLKVGyK5JrnwR4cpYcVJYbZpLh');
  
  console.log('\n============================================');
  console.log('删除 Relayer');
  console.log('============================================\n');
  console.log('Program ID:', programId.toBase58());
  console.log('Admin:', adminKeypair.publicKey.toBase58());
  console.log('Relayer to remove:', relayerToRemove.toBase58());
  console.log('');
  
  try {
    const [receiverState] = PublicKey.findProgramAddressSync(
      [Buffer.from('receiver_state')],
      programId
    );
    
    console.log('Receiver State PDA:', receiverState.toBase58());
    console.log('');
    
    // 构建 remove_relayer 指令
    // Discriminator from IDL: [154, 149, 161, 231, 69, 74, 136, 237]
    const discriminator = Buffer.from([154, 149, 161, 231, 69, 74, 136, 237]);
    
    // 指令数据: discriminator + relayer pubkey (32 bytes)
    const instructionData = Buffer.concat([
      discriminator,
      relayerToRemove.toBuffer()
    ]);
    
    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: receiverState, isSigner: false, isWritable: true },
        { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: false },
      ],
      programId,
      data: instructionData,
    });
    
    const transaction = new Transaction().add(instruction);
    
    console.log('📤 发送交易...');
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [adminKeypair],
      {
        commitment: 'confirmed',
        skipPreflight: false,
      }
    );
    
    console.log('✓ 交易成功！');
    console.log('  Transaction:', signature);
    console.log('  查看: https://explorer.solana.com/tx/' + signature + '?cluster=custom');
    console.log('');
    
  } catch (error) {
    console.error('❌ 删除失败:', error);
    throw error;
  }
}

main().catch(console.error);


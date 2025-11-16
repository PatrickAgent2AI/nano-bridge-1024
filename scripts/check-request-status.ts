import { Connection, PublicKey } from '@solana/web3.js';

async function main() {
  const connection = new Connection('https://testnet-rpc.1024chain.com/rpc/', 'confirmed');
  const programId = new PublicKey('BvYhYzzQerwUkX15zQJv5vuDiwR71daF1Z1ChPMnhQMt');
  
  // 计算 nonce 15 的 cross_chain_request PDA
  const nonce = 15;
  const [crossChainRequest] = PublicKey.findProgramAddressSync(
    [Buffer.from('cross_chain_request'), Buffer.from(new Uint8Array(new BigUint64Array([BigInt(nonce)]).buffer))],
    programId
  );
  
  console.log('\n============================================');
  console.log('检查跨链请求状态');
  console.log('============================================\n');
  console.log('Nonce:', nonce);
  console.log('Cross Chain Request PDA:', crossChainRequest.toBase58());
  console.log('');
  
  try {
    const accountInfo = await connection.getAccountInfo(crossChainRequest);
    
    if (!accountInfo) {
      console.log('❌ Cross Chain Request 账户不存在');
      console.log('   这意味着还没有 relayer 为这个 nonce 提交签名');
      return;
    }
    
    console.log('✓ Cross Chain Request 账户存在');
    console.log('  所有者:', accountInfo.owner.toBase58());
    console.log('  数据大小:', accountInfo.data.length, 'bytes');
    console.log('');
    
    // 尝试解析账户数据（简化版本）
    // Anchor 账户格式: 8 字节 discriminator + 数据
    const data = accountInfo.data;
    
    // 跳过 discriminator (8 bytes)
    let offset = 8;
    
    // nonce: u64 (8 bytes)
    const nonceValue = data.readBigUInt64LE(offset);
    offset += 8;
    
    // signed_relayers: Vec<Pubkey>
    // Vec 格式: 4 bytes length + data
    const relayerCount = data.readUInt32LE(offset);
    offset += 4;
    
    console.log('请求详情:');
    console.log('  Nonce:', nonceValue.toString());
    console.log('  已签名 Relayer 数量:', relayerCount);
    
    const relayers: string[] = [];
    for (let i = 0; i < relayerCount; i++) {
      const relayerPubkey = new PublicKey(data.slice(offset, offset + 32));
      relayers.push(relayerPubkey.toBase58());
      offset += 32;
    }
    
    console.log('  已签名 Relayers:');
    relayers.forEach((r, i) => {
      console.log(`    [${i}] ${r}`);
    });
    
    // signature_count: u8
    const signatureCount = data.readUInt8(offset);
    offset += 1;
    
    // is_unlocked: bool
    const isUnlocked = data.readUInt8(offset) !== 0;
    offset += 1;
    
    console.log('  签名计数:', signatureCount);
    console.log('  是否已解锁:', isUnlocked ? '✅ 是' : '❌ 否');
    console.log('');
    
    // 计算需要的阈值
    const receiverState = new PublicKey('418gG8mDbMyEPdrcmVwrcZZRNHpRqMwf8gi31Zk7fJEK');
    const receiverAccountInfo = await connection.getAccountInfo(receiverState);
    
    if (receiverAccountInfo) {
      // relayer_count 在 ReceiverState 中的位置（需要根据实际结构调整）
      // 简化：假设 relayer_count 是一个明显的数字
      console.log('需要的签名数:');
      console.log('  当前配置有 2 个 relayer');
      console.log('  阈值计算: ceil(2 * 2 / 3) = 2');
      console.log('  因此需要 2 个签名才能解锁');
      console.log('');
      console.log('⚠️  当前只有', signatureCount, '个签名，需要 2 个签名');
    }
    
  } catch (error) {
    console.error('❌ 查询失败:', error);
  }
}

main().catch(console.error);


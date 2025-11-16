import { Connection, PublicKey } from '@solana/web3.js';
import { getAccount } from '@solana/spl-token';

async function main() {
  const connection = new Connection('https://testnet-rpc.1024chain.com/rpc/', 'confirmed');
  
  // 交易签名
  const txSignature = 'oYhffC3a3oZmG2DaYSF5WNeiwFpMWYqShtZ3sJbp2uEnCpL6cMRRXZe6YZ9HF2PSbLYenrrG7TkSVUcdadi5qBS';
  
  console.log('\n============================================');
  console.log('检查交易详情');
  console.log('============================================\n');
  console.log('交易签名:', txSignature);
  console.log('');
  
  try {
    // 获取交易详情
    const tx = await connection.getTransaction(txSignature, {
      maxSupportedTransactionVersion: 0,
    });
    
    if (!tx) {
      console.log('❌ 交易未找到');
      return;
    }
    
    console.log('✓ 交易找到');
    console.log('  Slot:', tx.slot);
    console.log('  Block Time:', tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : 'N/A');
    console.log('  Error:', tx.meta?.err ? JSON.stringify(tx.meta.err) : '无');
    console.log('');
    
    // 显示日志
    if (tx.meta?.logMessages) {
      console.log('交易日志:');
      tx.meta.logMessages.forEach((log, i) => {
        console.log(`  [${i}] ${log}`);
      });
      console.log('');
    }
    
    // 检查账户余额变化
    if (tx.meta?.preTokenBalances && tx.meta?.postTokenBalances) {
      console.log('Token 余额变化:');
      
      const preBalances = new Map(
        tx.meta.preTokenBalances.map(b => [b.accountIndex, b])
      );
      const postBalances = new Map(
        tx.meta.postTokenBalances.map(b => [b.accountIndex, b])
      );
      
      postBalances.forEach((post, accountIndex) => {
        const pre = preBalances.get(accountIndex);
        if (pre) {
          const preAmount = BigInt(pre.uiTokenAmount.amount);
          const postAmount = BigInt(post.uiTokenAmount.amount);
          const change = postAmount - preAmount;
          
          if (change !== 0n) {
            console.log(`  账户 ${accountIndex}: ${post.owner || 'N/A'}`);
            console.log(`    变化: ${change > 0n ? '+' : ''}${change} (${Number(change) / 1000000} USDC)`);
            console.log(`    前: ${preAmount} -> 后: ${postAmount}`);
          }
        }
      });
    }
    
  } catch (error) {
    console.error('❌ 查询失败:', error);
  }
  
  // 检查 receiver 当前余额
  console.log('\n============================================');
  console.log('检查 Receiver USDC 余额');
  console.log('============================================\n');
  
  const receiver = new PublicKey('3VhnTppDywZUc1ti4DpfiaAH1Wit67yz6iofi9eCYHTn');
  const receiverTokenAccount = new PublicKey('B8LYcgBCFes9pRg7zFDRH3dkBdCXLeQQeLWEpu3Tr5b9');
  
  try {
    const tokenAccount = await getAccount(connection, receiverTokenAccount);
    const balance = Number(tokenAccount.amount) / 1_000_000; // USDC 有 6 位小数
    
    console.log('Receiver:', receiver.toBase58());
    console.log('Token Account:', receiverTokenAccount.toBase58());
    console.log('余额:', balance, 'USDC');
  } catch (error) {
    console.error('查询余额失败:', error);
  }
}

main().catch(console.error);


#!/bin/bash

# 启动 E2S Relayer 服务

cd /workspace/newlife2

# 停止已有服务
pkill -f e2s-submitter
pkill -f e2s-listener
sleep 2

# 提取 relayer 私钥
RELAYER_PRIVATE_KEY=$(node -e "
const fs = require('fs');
const keypair = JSON.parse(fs.readFileSync('.relayer/e2s-relayer-keypair.json', 'utf-8'));
const secretKey = Buffer.from(keypair.slice(0, 32));
console.log(secretKey.toString('hex'));
")

# 启动 e2s-submitter (API + 事件处理)
cd /workspace/newlife2 && \
SERVICE__NAME=e2s-submitter \
SERVICE__VERSION=0.1.0 \
SERVICE__WORKER_POOL_SIZE=5 \
SOURCE_CHAIN__NAME="Arbitrum Sepolia" \
SOURCE_CHAIN__CHAIN_ID=421614 \
SOURCE_CHAIN__RPC_URL=https://sepolia-rollup.arbitrum.io/rpc \
SOURCE_CHAIN__CONTRACT_ADDRESS=0x6403f74B0d0Aa625FbA1367b4C0388904884aa3F \
TARGET_CHAIN__NAME=1024chain \
TARGET_CHAIN__CHAIN_ID=91024 \
TARGET_CHAIN__RPC_URL=https://testnet-rpc.1024chain.com/rpc/ \
TARGET_CHAIN__CONTRACT_ADDRESS=CuvmS8Hehjf1HXjqBMKtssCK4ZS4cqDxkpQ6QLHmRUEB \
RELAYER__ED25519_PRIVATE_KEY=$RELAYER_PRIVATE_KEY \
API__PORT=8082 \
LOGGING__FORMAT=text \
RUST_LOG=info ./relayer/e2s-submitter/target/release/e2s-submitter > /tmp/e2s-submitter.log 2>&1 &

# 启动 e2s-listener (EVM 事件监听)
cd /workspace/newlife2/relayer/e2s-listener && \
SERVICE__NAME=e2s-listener \
SERVICE__VERSION=0.1.0 \
SOURCE_CHAIN__NAME="Arbitrum Sepolia" \
SOURCE_CHAIN__CHAIN_ID=421614 \
SOURCE_CHAIN__RPC_URL=https://sepolia-rollup.arbitrum.io/rpc \
SOURCE_CHAIN__CONTRACT_ADDRESS=0x6403f74B0d0Aa625FbA1367b4C0388904884aa3F \
TARGET_CHAIN__CHAIN_ID=91024 \
LOGGING__FORMAT=text \
RUST_LOG=info ./target/release/e2s-listener > /tmp/e2s-listener.log 2>&1 &

sleep 5

echo "✓ E2S Relayer 已启动"
echo ""
echo "服务状态:"
ps aux | grep -E "e2s-submitter|e2s-listener" | grep -v grep | awk '{print "  - " $11}'
echo ""
echo "API 测试:"
curl -s http://localhost:8082/health | python3 -c "import sys,json; d=json.load(sys.stdin); print(f\"  ✓ {d['service']} v{d['version']} (运行时间: {d['uptime']}s)\")" || echo "  ✗ API 未响应"
echo ""
echo "日志文件:"
echo "  - Submitter: /tmp/e2s-submitter.log"
echo "  - Listener: /tmp/e2s-listener.log"




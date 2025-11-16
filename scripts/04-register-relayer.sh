#!/bin/bash

# ============================================
# E2S Relayer 注册脚本
# ============================================
# 功能：
# 1. 生成 Ed25519 密钥对（用于 SVM 签名和交易）
# 2. 注册到 SVM 链（接收链）
# 3. 保存密钥到配置文件

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "============================================"
echo "E2S Relayer 注册脚本"
echo "============================================"
echo ""

# 加载环境变量
if [ -f "$PROJECT_ROOT/.env.invoke" ]; then
    source "$PROJECT_ROOT/.env.invoke"
else
    echo "❌ 未找到 .env.invoke 文件"
    exit 1
fi

# 1. 生成 Solana (Ed25519) 密钥对
echo "📝 生成 Ed25519 密钥对 (用于 SVM)..."
RELAYER_KEYPAIR_PATH="$PROJECT_ROOT/.relayer/e2s-relayer-keypair.json"
mkdir -p "$PROJECT_ROOT/.relayer"

if [ -f "$RELAYER_KEYPAIR_PATH" ]; then
    echo "⚠️  密钥文件已存在: $RELAYER_KEYPAIR_PATH"
    read -p "是否覆盖? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "使用现有密钥"
    else
        solana-keygen new --no-bip39-passphrase --outfile "$RELAYER_KEYPAIR_PATH" --force
    fi
else
    solana-keygen new --no-bip39-passphrase --outfile "$RELAYER_KEYPAIR_PATH"
fi

RELAYER_PUBKEY=$(solana-keygen pubkey "$RELAYER_KEYPAIR_PATH")
echo "✓ Relayer 公钥: $RELAYER_PUBKEY"

# 2. 注册 relayer 到 SVM 链
echo ""
echo "🔗 注册 relayer 到 SVM 链 (接收链)..."
cd "$SCRIPT_DIR"

# 使用 svm-admin.ts 添加 relayer
npx ts-node svm-admin.ts add_relayer "$RELAYER_PUBKEY" || {
    echo "⚠️  SVM 注册失败"
    echo "请手动执行: npx ts-node svm-admin.ts add_relayer $RELAYER_PUBKEY"
}

# 3. 生成 relayer 配置文件
echo ""
echo "📄 生成 relayer 配置文件..."

RELAYER_CONFIG_PATH="$PROJECT_ROOT/.relayer/e2s-relayer.env"

# 读取 SVM keypair 并转换为十六进制私钥
RELAYER_ED25519_PRIVATE_KEY=$(node -e "
const fs = require('fs');
const keypair = JSON.parse(fs.readFileSync('$RELAYER_KEYPAIR_PATH', 'utf-8'));
const secretKey = Buffer.from(keypair.slice(0, 32));
console.log(secretKey.toString('hex'));
")

cat > "$RELAYER_CONFIG_PATH" << EOF
# ============================================
# E2S Relayer 配置文件
# ============================================
# 自动生成于 $(date)

# Service Configuration
SERVICE__NAME=e2s
SERVICE__VERSION=0.1.0

# Source Chain Configuration (EVM - Arbitrum Sepolia)
SOURCE_CHAIN__NAME=Arbitrum Sepolia
SOURCE_CHAIN__CHAIN_ID=$EVM_CHAIN_ID
SOURCE_CHAIN__RPC_URL=$EVM_RPC_URL
SOURCE_CHAIN__CONTRACT_ADDRESS=$EVM_CONTRACT_ADDRESS

# Target Chain Configuration (SVM - 1024chain)
TARGET_CHAIN__NAME=1024chain
TARGET_CHAIN__CHAIN_ID=$SVM_CHAIN_ID
TARGET_CHAIN__RPC_URL=$SVM_RPC_URL
TARGET_CHAIN__CONTRACT_ADDRESS=$SVM_PROGRAM_ID

# Relayer Keys
# Ed25519 私钥（十六进制格式，32字节，用于 SVM 签名和交易）
RELAYER__ED25519_PRIVATE_KEY=$RELAYER_ED25519_PRIVATE_KEY

# Relayer Address
RELAYER__SVM_PUBKEY=$RELAYER_PUBKEY

# API Configuration
API__PORT=8082

# Logging Configuration
LOGGING__LEVEL=info
LOGGING__FORMAT=json
EOF

echo "✓ 配置文件已生成: $RELAYER_CONFIG_PATH"

# 4. 显示摘要
echo ""
echo "============================================"
echo "✅ E2S Relayer 注册完成"
echo "============================================"
echo ""
echo "Relayer 公钥: $RELAYER_PUBKEY"
echo "密钥文件: $RELAYER_KEYPAIR_PATH"
echo "配置文件: $RELAYER_CONFIG_PATH"
echo ""
echo "说明："
echo "  - E2S Relayer 监听 EVM 事件，提交签名到 SVM"
echo "  - 只需要 Ed25519 密钥对（用于 SVM 操作）"
echo "  - 已注册到 SVM 链的 relayer 白名单"
echo ""
echo "启动 relayer 命令:"
echo "  cd relayer/e2s-listener"
echo "  cargo run --release"
echo ""

#!/bin/bash

# ============================================
# Relayer 注册脚本 (E2S + S2E)
# ============================================
# 功能：
# 1. 生成 Ed25519 密钥对（用于 E2S Relayer - SVM 签名和交易）
# 2. 注册 E2S Relayer 到 SVM 链（接收链）
# 3. 生成 ECDSA 密钥对（用于 S2E Relayer - EVM 签名和交易）
# 4. 注册 S2E Relayer 到 EVM 合约（接收链）
# 5. 保存密钥到配置文件

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# 加载环境变量
if [ ! -f "$PROJECT_ROOT/.env.invoke" ]; then
    echo "❌ 未找到 .env.invoke 文件"
    exit 1
fi
source "$PROJECT_ROOT/.env.invoke"

# E2S Relayer
RELAYER_KEYPAIR_PATH="$PROJECT_ROOT/.relayer/e2s-relayer-keypair.json"
mkdir -p "$PROJECT_ROOT/.relayer"

if [ -f "$RELAYER_KEYPAIR_PATH" ]; then
    read -p "密钥文件已存在，是否覆盖? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        solana-keygen new --no-bip39-passphrase --outfile "$RELAYER_KEYPAIR_PATH" --force > /dev/null 2>&1
    fi
else
    solana-keygen new --no-bip39-passphrase --outfile "$RELAYER_KEYPAIR_PATH" > /dev/null 2>&1
fi

RELAYER_PUBKEY=$(solana-keygen pubkey "$RELAYER_KEYPAIR_PATH")

cd "$SCRIPT_DIR"
npx ts-node svm-admin.ts add_relayer "$RELAYER_PUBKEY" > /dev/null 2>&1 || {
    echo "⚠️  SVM 注册失败: npx ts-node svm-admin.ts add_relayer $RELAYER_PUBKEY"
}

E2S_ENV_PATH="$PROJECT_ROOT/relayer/e2s-submitter/.env"
if [ ! -f "$E2S_ENV_PATH" ]; then
    echo "⚠️  文件不存在: $E2S_ENV_PATH"
    exit 1
fi

RELAYER_ED25519_PRIVATE_KEY=$(node -e "
const fs = require('fs');
const keypair = JSON.parse(fs.readFileSync('$RELAYER_KEYPAIR_PATH', 'utf-8'));
const secretKey = keypair.slice(0, 32);
console.log(secretKey.join(','));
")

if grep -q "^RELAYER__ED25519_PRIVATE_KEY=" "$E2S_ENV_PATH"; then
    sed -i "s|^RELAYER__ED25519_PRIVATE_KEY=.*|RELAYER__ED25519_PRIVATE_KEY=$RELAYER_ED25519_PRIVATE_KEY|" "$E2S_ENV_PATH"
else
    echo "RELAYER__ED25519_PRIVATE_KEY=$RELAYER_ED25519_PRIVATE_KEY" >> "$E2S_ENV_PATH"
fi

# S2E Relayer
S2E_KEY_PATH="$PROJECT_ROOT/.relayer/s2e-relayer-key.json"

if [ -f "$S2E_KEY_PATH" ]; then
    read -p "密钥文件已存在，是否覆盖? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        S2E_PRIVATE_KEY=$(node -e "
        const fs = require('fs');
        const key = JSON.parse(fs.readFileSync('$S2E_KEY_PATH', 'utf-8'));
        console.log(key.privateKey);
        ")
        S2E_ADDRESS=$(node -e "
        const fs = require('fs');
        const key = JSON.parse(fs.readFileSync('$S2E_KEY_PATH', 'utf-8'));
        console.log(key.address);
        ")
    else
        cd "$SCRIPT_DIR"
        S2E_KEY_INFO=$(node -e "
        const { ethers } = require('ethers');
        const wallet = ethers.Wallet.createRandom();
        console.log(JSON.stringify({
            privateKey: wallet.privateKey,
            address: wallet.address
        }));
        ")
        echo "$S2E_KEY_INFO" > "$S2E_KEY_PATH"
        S2E_PRIVATE_KEY=$(echo "$S2E_KEY_INFO" | node -e "const data = JSON.parse(require('fs').readFileSync(0, 'utf-8')); console.log(data.privateKey);")
        S2E_ADDRESS=$(echo "$S2E_KEY_INFO" | node -e "const data = JSON.parse(require('fs').readFileSync(0, 'utf-8')); console.log(data.address);")
    fi
else
    cd "$SCRIPT_DIR"
    S2E_KEY_INFO=$(node -e "
    const { ethers } = require('ethers');
    const wallet = ethers.Wallet.createRandom();
    console.log(JSON.stringify({
        privateKey: wallet.privateKey,
        address: wallet.address
    }));
    ")
    echo "$S2E_KEY_INFO" > "$S2E_KEY_PATH"
    S2E_PRIVATE_KEY=$(echo "$S2E_KEY_INFO" | node -e "const data = JSON.parse(require('fs').readFileSync(0, 'utf-8')); console.log(data.privateKey);")
    S2E_ADDRESS=$(echo "$S2E_KEY_INFO" | node -e "const data = JSON.parse(require('fs').readFileSync(0, 'utf-8')); console.log(data.address);")
fi

# 验证变量是否成功提取
if [ -z "$S2E_PRIVATE_KEY" ] || [ -z "$S2E_ADDRESS" ]; then
    echo "❌ 错误: 未能提取 S2E 密钥信息"
    echo "S2E_PRIVATE_KEY: ${S2E_PRIVATE_KEY:-未定义}"
    echo "S2E_ADDRESS: ${S2E_ADDRESS:-未定义}"
    exit 1
fi

cd "$SCRIPT_DIR"
npx ts-node evm-admin.ts add_relayer "$S2E_ADDRESS" > /dev/null 2>&1 || {
    echo "⚠️  EVM 注册失败: npx ts-node evm-admin.ts add_relayer $S2E_ADDRESS"
}

S2E_ENV_PATH="$PROJECT_ROOT/relayer/s2e/.env"
if [ ! -f "$S2E_ENV_PATH" ]; then
    echo "⚠️  文件不存在: $S2E_ENV_PATH"
    exit 1
fi

# 更新环境变量
if grep -q "^RELAYER__ECDSA_PRIVATE_KEY=" "$S2E_ENV_PATH"; then
    # 使用 awk 更安全地替换，避免 sed 特殊字符问题
    awk -v key="$S2E_PRIVATE_KEY" '/^RELAYER__ECDSA_PRIVATE_KEY=/ { print "RELAYER__ECDSA_PRIVATE_KEY=" key; next }1' "$S2E_ENV_PATH" > "$S2E_ENV_PATH.tmp" && mv "$S2E_ENV_PATH.tmp" "$S2E_ENV_PATH"
else
    echo "RELAYER__ECDSA_PRIVATE_KEY=$S2E_PRIVATE_KEY" >> "$S2E_ENV_PATH"
fi

# 结果
echo "E2S: $RELAYER_PUBKEY -> $E2S_ENV_PATH"
echo "S2E: $S2E_ADDRESS -> $S2E_ENV_PATH"

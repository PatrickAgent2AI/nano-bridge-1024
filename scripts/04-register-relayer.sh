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

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# ==============================================================================
# 初始化检查
# ==============================================================================

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  Relayer 注册脚本${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

# 加载环境变量
echo -e "${BLUE}步骤 1/5: 检查配置文件...${NC}"
if [ ! -f "$PROJECT_ROOT/.env.invoke" ]; then
    echo -e "${RED}❌ 错误: 未找到 .env.invoke 文件${NC}"
    echo -e "${YELLOW}提示: 请先运行部署脚本生成配置文件${NC}"
    exit 1
fi
source "$PROJECT_ROOT/.env.invoke"
echo -e "${GREEN}✓ 配置文件加载成功${NC}"
echo ""

# ==============================================================================
# E2S Relayer 注册 (EVM -> Solana)
# ==============================================================================

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  注册 E2S Relayer (EVM -> Solana)${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""
echo -e "${BLUE}说明:${NC}"
echo "  E2S Relayer 负责将 EVM 链上的消息转发到 Solana 链"
echo "  需要 Ed25519 密钥对用于在 Solana 链上签名和提交交易"
echo ""

RELAYER_KEYPAIR_PATH="$PROJECT_ROOT/.relayer/e2s-relayer-keypair.json"
mkdir -p "$PROJECT_ROOT/.relayer"

echo -e "${BLUE}步骤 2/5: 生成/检查 E2S Relayer 密钥对...${NC}"
if [ -f "$RELAYER_KEYPAIR_PATH" ]; then
    EXISTING_PUBKEY=$(solana-keygen pubkey "$RELAYER_KEYPAIR_PATH" 2>/dev/null || echo "未知")
    echo -e "${YELLOW}⚠ 检测到已存在的密钥文件${NC}"
    echo "  文件路径: $RELAYER_KEYPAIR_PATH"
    echo "  当前公钥: $EXISTING_PUBKEY"
    echo ""
    echo -e "${YELLOW}选择操作:${NC}"
    echo "  y) 覆盖现有密钥（生成新的密钥对）"
    echo "  n) 使用现有密钥（跳过生成）"
    read -p "密钥文件已存在，是否覆盖? (y/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}正在生成新的 Ed25519 密钥对...${NC}"
        solana-keygen new --no-bip39-passphrase --outfile "$RELAYER_KEYPAIR_PATH" --force > /dev/null 2>&1
        echo -e "${GREEN}✓ 新密钥对已生成${NC}"
    else
        echo -e "${GREEN}✓ 使用现有密钥对${NC}"
    fi
else
    echo -e "${BLUE}正在生成新的 Ed25519 密钥对...${NC}"
    solana-keygen new --no-bip39-passphrase --outfile "$RELAYER_KEYPAIR_PATH" > /dev/null 2>&1
    echo -e "${GREEN}✓ 密钥对已生成${NC}"
fi

RELAYER_PUBKEY=$(solana-keygen pubkey "$RELAYER_KEYPAIR_PATH")
echo -e "${GREEN}✓ E2S Relayer 公钥: ${CYAN}${RELAYER_PUBKEY}${NC}"
echo ""

echo -e "${BLUE}步骤 3/5: 注册 E2S Relayer 到 Solana 合约...${NC}"
echo "  说明: 将 Relayer 公钥添加到 Solana 合约的白名单中"
echo "  公钥: $RELAYER_PUBKEY"
cd "$SCRIPT_DIR"
if timeout 5 npx ts-node svm-admin.ts add_relayer "$RELAYER_PUBKEY" 2>&1; then
    echo -e "${GREEN}✓ E2S Relayer 注册成功${NC}"
else
    echo -e "${YELLOW}⚠ SVM 注册可能失败，或由于websocket接口超时，但继续执行...${NC}"
    echo "  提示: 如果 Relayer 已经注册过，这是正常的"
fi
echo ""

echo -e "${BLUE}步骤 4/5: 保存 E2S Relayer 密钥到配置文件...${NC}"
E2S_ENV_PATH="$PROJECT_ROOT/relayer/e2s-submitter/.env"
if [ ! -f "$E2S_ENV_PATH" ]; then
    echo -e "${RED}❌ 错误: 文件不存在: $E2S_ENV_PATH${NC}"
    echo -e "${YELLOW}提示: 请确保 relayer 目录结构正确${NC}"
    exit 1
fi

echo "  正在提取私钥（Ed25519 格式）..."
RELAYER_ED25519_PRIVATE_KEY=$(node -e "
const fs = require('fs');
const keypair = JSON.parse(fs.readFileSync('$RELAYER_KEYPAIR_PATH', 'utf-8'));
const secretKey = keypair.slice(0, 32);
console.log(secretKey.join(','));
")

if grep -q "^RELAYER__ED25519_PRIVATE_KEY=" "$E2S_ENV_PATH"; then
    sed -i "s|^RELAYER__ED25519_PRIVATE_KEY=.*|RELAYER__ED25519_PRIVATE_KEY=$RELAYER_ED25519_PRIVATE_KEY|" "$E2S_ENV_PATH"
    echo -e "${GREEN}✓ 已更新配置文件: $E2S_ENV_PATH${NC}"
else
    echo "RELAYER__ED25519_PRIVATE_KEY=$RELAYER_ED25519_PRIVATE_KEY" >> "$E2S_ENV_PATH"
    echo -e "${GREEN}✓ 已添加配置到文件: $E2S_ENV_PATH${NC}"
fi
echo ""

# ==============================================================================
# S2E Relayer 注册 (Solana -> EVM)
# ==============================================================================

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  注册 S2E Relayer (Solana -> EVM)${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""
echo -e "${BLUE}说明:${NC}"
echo "  S2E Relayer 负责将 Solana 链上的消息转发到 EVM 链"
echo "  需要 ECDSA 密钥对用于在 EVM 链上签名和提交交易"
echo ""

S2E_KEY_PATH="$PROJECT_ROOT/.relayer/s2e-relayer-key.json"

echo -e "${BLUE}步骤 5/5: 生成/检查 S2E Relayer 密钥对...${NC}"
if [ -f "$S2E_KEY_PATH" ]; then
    EXISTING_ADDRESS=$(node -e "
    const fs = require('fs');
    try {
        const key = JSON.parse(fs.readFileSync('$S2E_KEY_PATH', 'utf-8'));
        console.log(key.address || '未知');
    } catch(e) {
        console.log('未知');
    }
    " 2>/dev/null || echo "未知")
    echo -e "${YELLOW}⚠ 检测到已存在的密钥文件${NC}"
    echo "  文件路径: $S2E_KEY_PATH"
    echo "  当前地址: $EXISTING_ADDRESS"
    echo ""
    echo -e "${YELLOW}选择操作:${NC}"
    echo "  y) 覆盖现有密钥（生成新的密钥对）"
    echo "  n) 使用现有密钥（跳过生成）"
    read -p "密钥文件已存在，是否覆盖? (y/n) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${GREEN}✓ 使用现有密钥对${NC}"
        echo "  正在读取现有密钥..."
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
        echo -e "${YELLOW}正在生成新的 ECDSA 密钥对...${NC}"
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
        echo -e "${GREEN}✓ 新密钥对已生成${NC}"
    fi
else
    echo -e "${BLUE}正在生成新的 ECDSA 密钥对...${NC}"
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
    echo -e "${GREEN}✓ 密钥对已生成${NC}"
fi

# 验证变量是否成功提取
if [ -z "$S2E_PRIVATE_KEY" ] || [ -z "$S2E_ADDRESS" ]; then
    echo -e "${RED}❌ 错误: 未能提取 S2E 密钥信息${NC}"
    echo "S2E_PRIVATE_KEY: ${S2E_PRIVATE_KEY:-未定义}"
    echo "S2E_ADDRESS: ${S2E_ADDRESS:-未定义}"
    exit 1
fi

echo -e "${GREEN}✓ S2E Relayer 地址: ${CYAN}${S2E_ADDRESS}${NC}"
echo ""

echo -e "${BLUE}注册 S2E Relayer 到 EVM 合约...${NC}"
echo "  说明: 将 Relayer 地址添加到 EVM 合约的白名单中"
echo "  地址: $S2E_ADDRESS"
cd "$SCRIPT_DIR"
if npx ts-node evm-admin.ts add_relayer "$S2E_ADDRESS" 2>&1; then
    echo -e "${GREEN}✓ S2E Relayer 注册成功${NC}"
else
    echo -e "${YELLOW}⚠ EVM 注册可能失败，但继续执行...${NC}"
    echo "  提示: 如果 Relayer 已经注册过，这是正常的"
fi
echo ""

echo -e "${BLUE}保存 S2E Relayer 密钥到配置文件...${NC}"
S2E_ENV_PATH="$PROJECT_ROOT/relayer/s2e/.env"
if [ ! -f "$S2E_ENV_PATH" ]; then
    echo -e "${RED}❌ 错误: 文件不存在: $S2E_ENV_PATH${NC}"
    echo -e "${YELLOW}提示: 请确保 relayer 目录结构正确${NC}"
    exit 1
fi

echo "  正在更新配置文件..."
# 使用 awk 更安全地替换，避免 sed 特殊字符问题
if grep -q "^RELAYER__ECDSA_PRIVATE_KEY=" "$S2E_ENV_PATH"; then
    awk -v key="$S2E_PRIVATE_KEY" '/^RELAYER__ECDSA_PRIVATE_KEY=/ { print "RELAYER__ECDSA_PRIVATE_KEY=" key; next }1' "$S2E_ENV_PATH" > "$S2E_ENV_PATH.tmp" && mv "$S2E_ENV_PATH.tmp" "$S2E_ENV_PATH"
    echo -e "${GREEN}✓ 已更新配置文件: $S2E_ENV_PATH${NC}"
else
    echo "RELAYER__ECDSA_PRIVATE_KEY=$S2E_PRIVATE_KEY" >> "$S2E_ENV_PATH"
    echo -e "${GREEN}✓ 已添加配置到文件: $S2E_ENV_PATH${NC}"
fi
echo ""

# ==============================================================================
# 完成总结
# ==============================================================================

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Relayer 注册完成！${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${CYAN}注册结果:${NC}"
echo ""
echo -e "${BLUE}E2S Relayer (EVM -> Solana):${NC}"
echo "  公钥: ${CYAN}${RELAYER_PUBKEY}${NC}"
echo "  密钥文件: $RELAYER_KEYPAIR_PATH"
echo "  配置文件: $E2S_ENV_PATH"
echo ""
echo -e "${BLUE}S2E Relayer (Solana -> EVM):${NC}"
echo "  地址: ${CYAN}${S2E_ADDRESS}${NC}"
echo "  密钥文件: $S2E_KEY_PATH"
echo "  配置文件: $S2E_ENV_PATH"
echo ""
echo -e "${YELLOW}下一步操作:${NC}"
echo "  1. 确保 Relayer 账户有足够的余额（用于支付 gas 费用）"
echo "  2. 启动 Relayer 服务: cd relayer && docker-compose up"
echo ""

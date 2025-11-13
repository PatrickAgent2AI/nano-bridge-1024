#!/bin/bash

# ==============================================================================
# SVM 合约部署脚本 - 1024chain Testnet
# ==============================================================================

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# ==============================================================================
# 配置
# ==============================================================================

RPC_URL="${SVM_RPC_URL:-https://testnet-rpc.1024chain.com/rpc/}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR/.."
CONTRACT_DIR="$PROJECT_ROOT/svm/bridge1024"
KEYPAIR_PATH="$CONTRACT_DIR/target/deploy/bridge1024-keypair.json"
PROGRAM_PATH="$CONTRACT_DIR/target/deploy/bridge1024.so"
ENV_FILE="$PROJECT_ROOT/.env"

# ==============================================================================
# 检查依赖
# ==============================================================================

if ! command -v anchor &> /dev/null; then
    echo -e "${RED}✗ 失败: 未安装 Anchor CLI${NC}"
    echo "   请运行: cargo install --git https://github.com/coral-xyz/anchor avm --locked --force"
    exit 1
fi

if ! command -v solana &> /dev/null; then
    echo -e "${RED}✗ 失败: 未安装 Solana CLI${NC}"
    echo "   请运行: sh -c \"\$(curl -sSfL https://release.solana.com/stable/install)\""
    exit 1
fi

# ==============================================================================
# 编译合约
# ==============================================================================

cd "$CONTRACT_DIR" || exit 1

echo "正在编译合约..."
if ! anchor build > /dev/null 2>&1; then
    echo -e "${RED}✗ 失败: 合约编译失败${NC}"
    exit 1
fi

# 检查编译产物
if [ ! -f "$PROGRAM_PATH" ]; then
    echo -e "${RED}✗ 失败: 找不到编译产物 $PROGRAM_PATH${NC}"
    exit 1
fi

if [ ! -f "$KEYPAIR_PATH" ]; then
    echo -e "${RED}✗ 失败: 找不到程序密钥 $KEYPAIR_PATH${NC}"
    exit 1
fi

# ==============================================================================
# 部署合约
# ==============================================================================

# 获取程序 ID
PROGRAM_ID=$(solana address -k "$KEYPAIR_PATH" 2>/dev/null)
if [ -z "$PROGRAM_ID" ]; then
    echo -e "${RED}✗ 失败: 无法从密钥文件获取程序 ID${NC}"
    exit 1
fi

echo "正在部署合约..."
DEPLOY_OUTPUT=$(solana program deploy \
    --url "$RPC_URL" \
    --program-id "$KEYPAIR_PATH" \
    "$PROGRAM_PATH" 2>&1)

if [ $? -ne 0 ]; then
    echo -e "${RED}✗ 失败: 合约部署失败${NC}"
    echo "$DEPLOY_OUTPUT" | grep -i "error" | head -5
    echo ""
    echo "可能原因:"
    echo "  1. 钱包余额不足"
    echo "  2. RPC 端点无法访问"
    echo "  3. 网络问题"
    exit 1
fi

# ==============================================================================
# 成功输出
# ==============================================================================

echo ""
echo -e "${GREEN}✓ 成功${NC}"
echo "程序地址: ${PROGRAM_ID}"
echo ""

# 保存到环境变量文件（如果.env存在）
if [ -f "$ENV_FILE" ]; then
    if grep -q "SVM_PROGRAM_ID=" "$ENV_FILE"; then
        sed -i "s|SVM_PROGRAM_ID=.*|SVM_PROGRAM_ID=${PROGRAM_ID}|g" "$ENV_FILE"
    else
        echo "SVM_PROGRAM_ID=${PROGRAM_ID}" >> "$ENV_FILE"
    fi
    echo "已更新 .env 文件"
fi


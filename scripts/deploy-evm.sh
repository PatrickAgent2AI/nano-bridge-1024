#!/bin/bash

# ==============================================================================
# EVM 合约部署脚本 - Arbitrum Sepolia
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

RPC_URL="${EVM_RPC_URL:-https://sepolia-rollup.arbitrum.io/rpc}"
PRIVATE_KEY="${ADMIN_EVM_PRIVATE_KEY}"
VAULT_ADDRESS="${EVM_VAULT_ADDRESS}"
ADMIN_ADDRESS="${EVM_ADMIN_ADDRESS}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR/.."
CONTRACT_DIR="$PROJECT_ROOT/evm/bridge1024"
ENV_FILE="$PROJECT_ROOT/.env"

# ==============================================================================
# 检查环境变量
# ==============================================================================

if [ -z "$PRIVATE_KEY" ]; then
    echo -e "${RED}✗ 失败: 未设置 ADMIN_EVM_PRIVATE_KEY${NC}"
    exit 1
fi

if [ -z "$VAULT_ADDRESS" ]; then
    echo -e "${YELLOW}⚠ 警告: 未设置 EVM_VAULT_ADDRESS，将使用部署者地址${NC}"
    # 从私钥获取地址
    VAULT_ADDRESS=$(cast wallet address "$PRIVATE_KEY" 2>/dev/null || echo "")
fi

if [ -z "$ADMIN_ADDRESS" ]; then
    echo -e "${YELLOW}⚠ 警告: 未设置 EVM_ADMIN_ADDRESS，将使用部署者地址${NC}"
    ADMIN_ADDRESS=$(cast wallet address "$PRIVATE_KEY" 2>/dev/null || echo "")
fi

# ==============================================================================
# 部署合约
# ==============================================================================

cd "$CONTRACT_DIR" || exit 1

# 编译合约（静默输出）
forge build --silent 2>/dev/null

# 部署Bridge1024
echo "正在部署 Bridge1024..."
DEPLOY_OUTPUT=$(forge create \
    --rpc-url "$RPC_URL" \
    --private-key "$PRIVATE_KEY" \
    src/Bridge1024.sol:Bridge1024 \
    2>&1)

if [ $? -ne 0 ]; then
    echo -e "${RED}✗ 失败: 合约部署失败${NC}"
    echo "$DEPLOY_OUTPUT" | grep -i "error" | head -5
    exit 1
fi

# 提取合约地址
CONTRACT_ADDRESS=$(echo "$DEPLOY_OUTPUT" | grep "Deployed to:" | awk '{print $3}')

if [ -z "$CONTRACT_ADDRESS" ]; then
    echo -e "${RED}✗ 失败: 无法获取合约地址${NC}"
    exit 1
fi

# ==============================================================================
# 初始化合约
# ==============================================================================

echo "正在初始化合约..."
INIT_OUTPUT=$(cast send "$CONTRACT_ADDRESS" \
    "initialize(address,address)" \
    "$VAULT_ADDRESS" \
    "$ADMIN_ADDRESS" \
    --rpc-url "$RPC_URL" \
    --private-key "$PRIVATE_KEY" \
    2>&1)

if [ $? -ne 0 ]; then
    echo -e "${RED}✗ 失败: 合约初始化失败${NC}"
    echo "$INIT_OUTPUT" | grep -i "error" | head -5
    exit 1
fi

# ==============================================================================
# 成功输出
# ==============================================================================

echo ""
echo -e "${GREEN}✓ 成功${NC}"
echo "合约地址: ${CONTRACT_ADDRESS}"
echo ""
echo "浏览器: https://sepolia.arbiscan.io/address/${CONTRACT_ADDRESS}"

# 保存到环境变量文件（如果.env存在）
if [ -f "$ENV_FILE" ]; then
    if grep -q "EVM_CONTRACT_ADDRESS=" "$ENV_FILE"; then
        sed -i "s|EVM_CONTRACT_ADDRESS=.*|EVM_CONTRACT_ADDRESS=${CONTRACT_ADDRESS}|g" "$ENV_FILE"
    else
        echo "EVM_CONTRACT_ADDRESS=${CONTRACT_ADDRESS}" >> "$ENV_FILE"
    fi
    echo "已更新 .env 文件"
fi


#!/bin/bash

# ==============================================================================
# MockUSDC 部署脚本 - Arbitrum Sepolia（测试用）
# ==============================================================================

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

# ==============================================================================
# 配置
# ==============================================================================

RPC_URL="${EVM_RPC_URL:-https://sepolia-rollup.arbitrum.io/rpc}"
PRIVATE_KEY="${ADMIN_EVM_PRIVATE_KEY}"
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

# ==============================================================================
# 部署合约
# ==============================================================================

cd "$CONTRACT_DIR" || exit 1

# 编译合约（静默输出）
forge build --silent 2>/dev/null

# 部署MockUSDC
echo "正在部署 MockUSDC..."
DEPLOY_OUTPUT=$(forge create \
    --rpc-url "$RPC_URL" \
    --private-key "$PRIVATE_KEY" \
    src/MockUSDC.sol:MockUSDC \
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
# 成功输出
# ==============================================================================

echo ""
echo -e "${GREEN}✓ 成功${NC}"
echo "MockUSDC 地址: ${CONTRACT_ADDRESS}"
echo ""
echo "浏览器: https://sepolia.arbiscan.io/address/${CONTRACT_ADDRESS}"

# 保存到环境变量文件（如果.env存在）
if [ -f "$ENV_FILE" ]; then
    if grep -q "USDC_EVM_CONTRACT=" "$ENV_FILE"; then
        sed -i "s|USDC_EVM_CONTRACT=.*|USDC_EVM_CONTRACT=${CONTRACT_ADDRESS}|g" "$ENV_FILE"
    else
        echo "USDC_EVM_CONTRACT=${CONTRACT_ADDRESS}" >> "$ENV_FILE"
    fi
    echo "已更新 .env 文件"
fi


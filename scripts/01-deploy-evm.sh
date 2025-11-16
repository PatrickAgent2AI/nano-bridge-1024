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

# 获取项目路径
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR/.."
CONTRACT_DIR="$PROJECT_ROOT/evm/bridge1024"
ENV_FILE="$PROJECT_ROOT/.env.evm.deploy"

# 从 .env.evm.deploy 文件加载环境变量
if [ -f "$ENV_FILE" ]; then
    set -a  # 自动导出所有变量
    source "$ENV_FILE"
    set +a  # 关闭自动导出
else
    echo -e "${RED}未找到 .env.evm.deploy 文件${NC}"
    exit 1
fi

# 读取环境变量
RPC_URL="${EVM_RPC_URL:-https://sepolia-rollup.arbitrum.io/rpc}"

# 确保 RPC URL 有正确的协议前缀
if [[ ! "$RPC_URL" =~ ^https?:// ]]; then
    RPC_URL="https://$RPC_URL"
fi

PRIVATE_KEY="${ADMIN_EVM_PRIVATE_KEY}"
ADMIN_ADDRESS="${EVM_ADMIN_ADDRESS}"

# ==============================================================================
# 检查环境变量
# ==============================================================================

if [ -z "$PRIVATE_KEY" ]; then
    echo -e "${RED}未设置 ADMIN_EVM_PRIVATE_KEY${NC}"
    exit 1
fi

if [ -z "$ADMIN_ADDRESS" ]; then
    ADMIN_ADDRESS=$(cast wallet address "$PRIVATE_KEY" 2>/dev/null || echo "")
fi

# 注意：从 v2.0 开始，合约本身作为金库，不需要单独的 vault 地址

# ==============================================================================
# 部署合约
# ==============================================================================

cd "$CONTRACT_DIR" || exit 1

# 编译合约（静默输出）
forge build --silent 2>/dev/null

# 部署Bridge1024
# 创建临时文件保存输出
TEMP_OUTPUT=$(mktemp)

# 部署合约（静默输出）
forge create \
    --rpc-url "$RPC_URL" \
    --private-key "$PRIVATE_KEY" \
    --broadcast \
    src/Bridge1024.sol:Bridge1024 \
    > "$TEMP_OUTPUT" 2>&1

DEPLOY_EXIT_CODE=$?

if [ $DEPLOY_EXIT_CODE -ne 0 ]; then
    echo -e "${RED}部署失败${NC}"
    cat "$TEMP_OUTPUT"
    rm -f "$TEMP_OUTPUT"
    exit 1
fi

# 从输出中提取交易哈希
DEPLOY_TX=$(grep -oP "Transaction hash:\s*\K(0x[a-fA-F0-9]{64})" "$TEMP_OUTPUT" | head -1)

# 从输出中提取合约地址
CONTRACT_ADDRESS=$(grep -oP "Deployed to:\s*\K(0x[a-fA-F0-9]{40})" "$TEMP_OUTPUT" | head -1)

if [ -z "$CONTRACT_ADDRESS" ]; then
    echo -e "${RED}无法提取合约地址${NC}"
    cat "$TEMP_OUTPUT"
    rm -f "$TEMP_OUTPUT"
    exit 1
fi

rm -f "$TEMP_OUTPUT"

# 输出部署信息
echo "部署交易: ${DEPLOY_TX}"
echo "合约地址: ${CONTRACT_ADDRESS}"
echo "浏览器: https://sepolia.arbiscan.io/address/${CONTRACT_ADDRESS}"

# ==============================================================================
# 初始化合约
# ==============================================================================

# 注意：vaultAddress 参数已废弃，合约内部使用 address(this) 作为金库
# 但为了兼容性，仍然传入一个地址（会被忽略）
INIT_OUTPUT=$(cast send "$CONTRACT_ADDRESS" \
    "initialize(address,address)" \
    "$ADMIN_ADDRESS" \
    "$ADMIN_ADDRESS" \
    --rpc-url "$RPC_URL" \
    --private-key "$PRIVATE_KEY" \
    2>&1)

if [ $? -ne 0 ]; then
    echo -e "${RED}初始化失败${NC}"
    echo "$INIT_OUTPUT" | grep -i "error"
    exit 1
fi

# 提取初始化交易哈希
INIT_TX=$(echo "$INIT_OUTPUT" | grep -oP "transactionHash\s+\K(0x[a-fA-F0-9]{64})" | head -1)

echo "初始化交易: ${INIT_TX}"

# 保存到环境变量文件
if [ -f "$ENV_FILE" ]; then
    if grep -q "EVM_CONTRACT_ADDRESS=" "$ENV_FILE"; then
        sed -i "s|EVM_CONTRACT_ADDRESS=.*|EVM_CONTRACT_ADDRESS=${CONTRACT_ADDRESS}|g" "$ENV_FILE"
    else
        echo "EVM_CONTRACT_ADDRESS=${CONTRACT_ADDRESS}" >> "$ENV_FILE"
    fi
fi

# ==============================================================================
# 同步配置到 Relayer
# ==============================================================================

echo ""
echo -e "${YELLOW}同步配置到 Relayer...${NC}"

RELAYER_DIR="$PROJECT_ROOT/relayer"
UPDATED_COUNT=0

# 更新 e2s-listener 配置（SOURCE_CHAIN）
if [ -f "$RELAYER_DIR/e2s-listener/.env" ]; then
    if grep -q "^SOURCE_CHAIN__CONTRACT_ADDRESS=" "$RELAYER_DIR/e2s-listener/.env"; then
        sed -i "s|^SOURCE_CHAIN__CONTRACT_ADDRESS=.*|SOURCE_CHAIN__CONTRACT_ADDRESS=${CONTRACT_ADDRESS}|g" "$RELAYER_DIR/e2s-listener/.env"
        echo -e "${GREEN}✓ 已更新 e2s-listener/.env${NC}"
        UPDATED_COUNT=$((UPDATED_COUNT + 1))
    fi
fi

# 更新 e2s-submitter 配置（SOURCE_CHAIN）
if [ -f "$RELAYER_DIR/e2s-submitter/.env" ]; then
    if grep -q "^SOURCE_CHAIN__CONTRACT_ADDRESS=" "$RELAYER_DIR/e2s-submitter/.env"; then
        sed -i "s|^SOURCE_CHAIN__CONTRACT_ADDRESS=.*|SOURCE_CHAIN__CONTRACT_ADDRESS=${CONTRACT_ADDRESS}|g" "$RELAYER_DIR/e2s-submitter/.env"
        echo -e "${GREEN}✓ 已更新 e2s-submitter/.env${NC}"
        UPDATED_COUNT=$((UPDATED_COUNT + 1))
    fi
fi

# 更新 s2e 配置（TARGET_CHAIN）
if [ -f "$RELAYER_DIR/s2e/.env" ]; then
    if grep -q "^TARGET_CHAIN__CONTRACT_ADDRESS=" "$RELAYER_DIR/s2e/.env"; then
        sed -i "s|^TARGET_CHAIN__CONTRACT_ADDRESS=.*|TARGET_CHAIN__CONTRACT_ADDRESS=${CONTRACT_ADDRESS}|g" "$RELAYER_DIR/s2e/.env"
        echo -e "${GREEN}✓ 已更新 s2e/.env${NC}"
        UPDATED_COUNT=$((UPDATED_COUNT + 1))
    fi
fi

if [ $UPDATED_COUNT -eq 0 ]; then
    echo -e "${YELLOW}⚠ 未找到 Relayer 配置文件，跳过同步${NC}"
else
    echo -e "${GREEN}✓ 已同步 $UPDATED_COUNT 个 Relayer 配置文件${NC}"
fi


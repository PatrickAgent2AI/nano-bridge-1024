#!/bin/bash

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  初始化新部署的 SVM 程序${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# 加载环境变量
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR/.."

if [ ! -f "$PROJECT_ROOT/.env.invoke" ]; then
    echo -e "${RED}错误: 找不到 .env.invoke 文件${NC}"
    exit 1
fi

source "$PROJECT_ROOT/.env.invoke"

# 检查必要的环境变量
if [ -z "$SVM_PROGRAM_ID" ]; then
    echo -e "${RED}错误: SVM_PROGRAM_ID 未设置${NC}"
    exit 1
fi

echo "程序ID: $SVM_PROGRAM_ID"
echo "管理员: $(solana address -k $ADMIN_SVM_KEYPAIR_PATH)"
echo ""

# 1. 初始化合约
echo -e "${YELLOW}步骤 1/5: 初始化合约...${NC}"
if npx ts-node "$PROJECT_ROOT/scripts/svm-admin.ts" initialize 2>&1 | grep -q "成功\|完成"; then
    echo "  ✓ 初始化成功"
else
    echo -e "${RED}  ✗ 初始化失败${NC}"
    exit 1
fi
sleep 2

# 2. 配置 USDC
echo -e "${YELLOW}步骤 2/5: 配置 USDC...${NC}"
if npx ts-node "$PROJECT_ROOT/scripts/svm-admin.ts" configure_usdc 2>&1 | grep -q "成功\|完成"; then
    echo "  ✓ USDC 配置成功"
else
    echo -e "${RED}  ✗ USDC 配置失败${NC}"
    exit 1
fi
sleep 2

# 3. 配置接收端对端合约（只配置 receiver_state）
echo -e "${YELLOW}步骤 3/5: 配置接收端对端合约...${NC}"
if npx ts-node "$PROJECT_ROOT/scripts/svm-admin.ts" configure_receiver_peer 2>&1 | grep -q "成功\|完成"; then
    echo "  ✓ 接收端对端配置成功"
else
    echo -e "${RED}  ✗ 接收端对端配置失败${NC}"
    # 尝试使用完整的 configure_peer（如果程序升级成功的话）
    echo "  尝试使用 configure_peer..."
    if npx ts-node "$PROJECT_ROOT/scripts/svm-admin.ts" configure_peer 2>&1 | grep -q "成功\|完成"; then
        echo "  ✓ 完整对端配置成功"
    else
        echo -e "${YELLOW}  ⚠ 对端配置失败，但可以继续（仅影响 SVM→EVM）${NC}"
    fi
fi
sleep 2

# 4. 添加 Relayer
echo -e "${YELLOW}步骤 4/5: 添加 Relayer...${NC}"
if [ -n "$RELAYER_ADDRESSES_SVM" ]; then
    IFS=',' read -ra RELAYERS <<< "$RELAYER_ADDRESSES_SVM"
    for relayer in "${RELAYERS[@]}"; do
        relayer=$(echo "$relayer" | xargs)
        if [ -n "$relayer" ]; then
            echo "  添加 Relayer: $relayer"
            if npx ts-node "$PROJECT_ROOT/scripts/svm-admin.ts" add_relayer "$relayer" 2>&1 | grep -q "成功\|完成\|已存在"; then
                echo "    ✓ 添加成功"
            else
                echo -e "${YELLOW}    ⚠ 添加失败${NC}"
            fi
            sleep 1
        fi
    done
else
    echo "  ℹ 未配置 RELAYER_ADDRESSES_SVM"
fi

# 5. 添加流动性
echo -e "${YELLOW}步骤 5/5: 添加流动性...${NC}"
LIQUIDITY_AMOUNT="${INITIAL_LIQUIDITY_AMOUNT:-100000000}"
if npx ts-node "$PROJECT_ROOT/scripts/svm-admin.ts" add_liquidity "$LIQUIDITY_AMOUNT" 2>&1 | grep -q "成功\|完成"; then
    echo "  ✓ 流动性添加成功 (${LIQUIDITY_AMOUNT})"
else
    echo -e "${YELLOW}  ⚠ 流动性添加失败${NC}"
fi

# 查询最终状态
echo ""
echo -e "${YELLOW}查询最终状态...${NC}"
npx ts-node "$PROJECT_ROOT/scripts/svm-admin.ts" query_state

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  初始化完成！${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BLUE}下一步:${NC}"
echo "  1. 验证配置: npx ts-node scripts/svm-admin.ts query_state"
echo "  2. 更新 relayer 配置中的 SVM_PROGRAM_ID"
echo "  3. 重启 relayer 服务"
echo ""

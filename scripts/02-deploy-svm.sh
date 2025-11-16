#!/bin/bash

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# ==============================================================================
# 配置
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR/.."
CONTRACT_DIR="$PROJECT_ROOT/svm/bridge1024"
KEYPAIR_PATH="$CONTRACT_DIR/target/deploy/bridge1024-keypair.json"
PROGRAM_PATH="$CONTRACT_DIR/target/deploy/bridge1024.so"
SVM_CONFIG_FILE="$PROJECT_ROOT/.env.svm.deploy"

# 加载配置
source "$SVM_CONFIG_FILE"

RPC_URL="${SVM_RPC_URL:-https://testnet-rpc.1024chain.com/rpc/}"
ADMIN_KEYPAIR="${SVM_KEYPAIR_PATH:-/root/.config/solana/id.json}"
REQUIRED_BALANCE=5

# ==============================================================================
# 检查依赖
# ==============================================================================

if ! command -v anchor &> /dev/null; then
    echo -e "${RED}错误: 未安装 Anchor CLI${NC}"
    exit 1
fi

if ! command -v solana &> /dev/null; then
    echo -e "${RED}错误: 未安装 Solana CLI${NC}"
    exit 1
fi

# ==============================================================================
# 检查管理员账户
# ==============================================================================

if [ ! -f "$ADMIN_KEYPAIR" ]; then
    mkdir -p "$(dirname "$ADMIN_KEYPAIR")"
    solana-keygen new --no-bip39-passphrase --outfile "$ADMIN_KEYPAIR" --force > /dev/null 2>&1
    if [ $? -ne 0 ]; then
        echo -e "${RED}错误: 无法生成管理员密钥${NC}"
        exit 1
    fi
fi

ADMIN_ADDRESS=$(solana address -k "$ADMIN_KEYPAIR" 2>/dev/null)
if [ -z "$ADMIN_ADDRESS" ]; then
    echo -e "${RED}错误: 无法获取管理员地址${NC}"
    exit 1
fi

# ==============================================================================
# 检查余额并自动充值
# ==============================================================================

BALANCE=$(solana balance --url "$RPC_URL" -k "$ADMIN_KEYPAIR" 2>/dev/null | awk '{print $1}')

if [ -z "$BALANCE" ]; then
    echo -e "${RED}错误: 无法获取账户余额${NC}"
    exit 1
fi

if (( $(echo "$BALANCE < $REQUIRED_BALANCE" | bc -l) )); then
    MAX_ATTEMPTS=3
    ATTEMPT=0
    
    while (( $(echo "$BALANCE < $REQUIRED_BALANCE" | bc -l) )) && [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
        ATTEMPT=$((ATTEMPT + 1))
        
        AIRDROP_OUTPUT=$(solana airdrop 2 "$ADMIN_ADDRESS" --url "$RPC_URL" 2>&1)
        AIRDROP_EXIT=$?
        
        if [ $AIRDROP_EXIT -ne 0 ]; then
            if echo "$AIRDROP_OUTPUT" | grep -qi "airdrop.*disabled\|airdrop.*not.*available\|not.*testnet"; then
                echo -e "${RED}错误: 当前网络不支持空投${NC}"
                echo "请手动充值: $ADMIN_ADDRESS"
                exit 1
            fi
            
            if [ $ATTEMPT -ge $MAX_ATTEMPTS ]; then
                echo -e "${RED}错误: 空投失败，余额不足${NC}"
                echo "请手动充值: $ADMIN_ADDRESS"
                exit 1
            fi
            
            sleep 5
        else
            sleep 2
            BALANCE=$(solana balance --url "$RPC_URL" -k "$ADMIN_KEYPAIR" 2>/dev/null | awk '{print $1}')
        fi
    done
fi

# ==============================================================================
# 编译合约
# ==============================================================================

cd "$CONTRACT_DIR" || exit 1

if ! anchor build > /dev/null 2>&1; then
    echo -e "${RED}错误: 合约编译失败${NC}"
    exit 1
fi

if [ ! -f "$PROGRAM_PATH" ] || [ ! -f "$KEYPAIR_PATH" ]; then
    echo -e "${RED}错误: 找不到编译产物${NC}"
    exit 1
fi

# ==============================================================================
# 部署合约
# ==============================================================================

PROGRAM_ID=$(solana address -k "$KEYPAIR_PATH" 2>/dev/null)
if [ -z "$PROGRAM_ID" ]; then
    echo -e "${RED}错误: 无法获取程序 ID${NC}"
    exit 1
fi

solana program deploy \
    --url "$RPC_URL" \
    --program-id "$KEYPAIR_PATH" \
    --skip-preflight \
    --max-sign-attempts 5 \
    --use-rpc \
    "$PROGRAM_PATH" > /dev/null 2>&1

if [ $? -ne 0 ]; then
    echo -e "${RED}错误: 合约部署失败${NC}"
    exit 1
fi

# ==============================================================================
# 更新配置文件
# ==============================================================================

if [ -f "$SVM_CONFIG_FILE" ] && grep -q "^SVM_PROGRAM_ID=" "$SVM_CONFIG_FILE"; then
    sed -i "s|^SVM_PROGRAM_ID=.*|SVM_PROGRAM_ID=${PROGRAM_ID}|g" "$SVM_CONFIG_FILE"
else
    echo "SVM_PROGRAM_ID=${PROGRAM_ID}" >> "$SVM_CONFIG_FILE"
fi

if grep -q "^SVM_ADMIN_ADDRESS=" "$SVM_CONFIG_FILE" 2>/dev/null; then
    sed -i "s|^SVM_ADMIN_ADDRESS=.*|SVM_ADMIN_ADDRESS=${ADMIN_ADDRESS}|g" "$SVM_CONFIG_FILE"
else
    echo "SVM_ADMIN_ADDRESS=${ADMIN_ADDRESS}" >> "$SVM_CONFIG_FILE"
fi

# ==============================================================================
# 输出结果
# ==============================================================================

echo -e "${GREEN}部署成功${NC}"
echo "程序地址: ${PROGRAM_ID}"
echo "管理员地址: ${ADMIN_ADDRESS}"

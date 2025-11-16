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
# 检查并处理程序密钥对
# ==============================================================================

# 检查是否已存在程序密钥对
if [ -f "$KEYPAIR_PATH" ]; then
    OLD_PROGRAM_ID=$(solana address -k "$KEYPAIR_PATH" 2>/dev/null || echo "unknown")
    echo -e "${YELLOW}发现已存在的程序密钥对${NC}"
    echo "  当前程序ID: $OLD_PROGRAM_ID"
    echo ""
    echo "选择操作："
    echo "  1) 使用现有程序ID（升级部署）"
    echo "  2) 生成新的程序ID（全新部署）"
    echo ""
    read -p "请选择 [1/2] (默认: 1): " DEPLOY_CHOICE
    DEPLOY_CHOICE=${DEPLOY_CHOICE:-1}
    
    if [ "$DEPLOY_CHOICE" = "2" ]; then
        # 备份旧密钥对
        BACKUP_DIR="$PROJECT_ROOT/.backup_$(date +%Y%m%d_%H%M%S)"
        mkdir -p "$BACKUP_DIR"
        cp "$KEYPAIR_PATH" "$BACKUP_DIR/old-keypair.json"
        echo -e "${GREEN}✓ 已备份旧密钥对到: $BACKUP_DIR${NC}"
        
        # 生成新的程序密钥对
        echo -e "${YELLOW}生成新的程序密钥对...${NC}"
        solana-keygen new --no-bip39-passphrase --outfile "$KEYPAIR_PATH" --force > /dev/null 2>&1
        NEW_PROGRAM_ID=$(solana address -k "$KEYPAIR_PATH")
        echo -e "${GREEN}✓ 新程序ID: $NEW_PROGRAM_ID${NC}"
        echo ""
    else
        echo -e "${GREEN}✓ 将使用现有程序ID进行升级部署${NC}"
        echo ""
    fi
else
    echo -e "${YELLOW}未找到程序密钥对，将生成新的${NC}"
    mkdir -p "$(dirname "$KEYPAIR_PATH")"
    solana-keygen new --no-bip39-passphrase --outfile "$KEYPAIR_PATH" > /dev/null 2>&1
    NEW_PROGRAM_ID=$(solana address -k "$KEYPAIR_PATH")
    echo -e "${GREEN}✓ 新程序ID: $NEW_PROGRAM_ID${NC}"
    echo ""
fi

# ==============================================================================
# 编译合约
# ==============================================================================

cd "$CONTRACT_DIR" || exit 1

echo "编译合约..."
if ! anchor build > /dev/null 2>&1; then
    echo -e "${RED}错误: 合约编译失败${NC}"
    exit 1
fi
echo -e "${GREEN}✓ 编译成功${NC}"

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

echo "部署合约到链上..."
echo "  程序ID: $PROGRAM_ID"
echo "  这可能需要几分钟..."

DEPLOY_OUTPUT=$(solana program deploy \
    --url "$RPC_URL" \
    --program-id "$KEYPAIR_PATH" \
    --skip-preflight \
    --max-sign-attempts 10 \
    --use-rpc \
    "$PROGRAM_PATH" 2>&1)

if [ $? -ne 0 ]; then
    echo -e "${RED}错误: 合约部署失败${NC}"
    echo "$DEPLOY_OUTPUT"
    exit 1
fi

echo -e "${GREEN}✓ 部署成功${NC}"

# ==============================================================================
# 更新配置文件
# ==============================================================================

echo "更新配置文件..."

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

# 同时更新 .env.invoke（如果存在）
INVOKE_ENV="$PROJECT_ROOT/.env.invoke"
if [ -f "$INVOKE_ENV" ]; then
    if grep -q "^SVM_PROGRAM_ID=" "$INVOKE_ENV"; then
        sed -i "s|^SVM_PROGRAM_ID=.*|SVM_PROGRAM_ID=${PROGRAM_ID}|g" "$INVOKE_ENV"
    else
        echo "SVM_PROGRAM_ID=${PROGRAM_ID}" >> "$INVOKE_ENV"
    fi
fi

echo -e "${GREEN}✓ 配置文件已更新${NC}"

# ==============================================================================
# 同步配置到 Relayer
# ==============================================================================

echo ""
echo -e "${YELLOW}同步配置到 Relayer...${NC}"

RELAYER_DIR="$PROJECT_ROOT/relayer"
UPDATED_COUNT=0

# 更新 e2s-listener 配置（TARGET_CHAIN）
if [ -f "$RELAYER_DIR/e2s-listener/.env" ]; then
    if grep -q "^TARGET_CHAIN__CONTRACT_ADDRESS=" "$RELAYER_DIR/e2s-listener/.env"; then
        sed -i "s|^TARGET_CHAIN__CONTRACT_ADDRESS=.*|TARGET_CHAIN__CONTRACT_ADDRESS=${PROGRAM_ID}|g" "$RELAYER_DIR/e2s-listener/.env"
        echo -e "${GREEN}✓ 已更新 e2s-listener/.env${NC}"
        UPDATED_COUNT=$((UPDATED_COUNT + 1))
    fi
fi

# 更新 e2s-submitter 配置（TARGET_CHAIN）
if [ -f "$RELAYER_DIR/e2s-submitter/.env" ]; then
    if grep -q "^TARGET_CHAIN__CONTRACT_ADDRESS=" "$RELAYER_DIR/e2s-submitter/.env"; then
        sed -i "s|^TARGET_CHAIN__CONTRACT_ADDRESS=.*|TARGET_CHAIN__CONTRACT_ADDRESS=${PROGRAM_ID}|g" "$RELAYER_DIR/e2s-submitter/.env"
        echo -e "${GREEN}✓ 已更新 e2s-submitter/.env${NC}"
        UPDATED_COUNT=$((UPDATED_COUNT + 1))
    fi
fi

# 更新 s2e 配置（SOURCE_CHAIN）
if [ -f "$RELAYER_DIR/s2e/.env" ]; then
    if grep -q "^SOURCE_CHAIN__CONTRACT_ADDRESS=" "$RELAYER_DIR/s2e/.env"; then
        sed -i "s|^SOURCE_CHAIN__CONTRACT_ADDRESS=.*|SOURCE_CHAIN__CONTRACT_ADDRESS=${PROGRAM_ID}|g" "$RELAYER_DIR/s2e/.env"
        echo -e "${GREEN}✓ 已更新 s2e/.env${NC}"
        UPDATED_COUNT=$((UPDATED_COUNT + 1))
    fi
fi

if [ $UPDATED_COUNT -eq 0 ]; then
    echo -e "${YELLOW}⚠ 未找到 Relayer 配置文件，跳过同步${NC}"
else
    echo -e "${GREEN}✓ 已同步 $UPDATED_COUNT 个 Relayer 配置文件${NC}"
fi

# ==============================================================================
# 输出结果
# ==============================================================================

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  SVM 合约部署完成！${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "程序信息:"
echo "  程序ID: ${GREEN}${PROGRAM_ID}${NC}"
echo "  管理员: ${ADMIN_ADDRESS}"
echo ""
echo "配置文件:"
echo "  .env.svm.deploy 已更新"
[ -f "$INVOKE_ENV" ] && echo "  .env.invoke 已更新"
[ $UPDATED_COUNT -gt 0 ] && echo "  已同步 $UPDATED_COUNT 个 Relayer 配置"
echo ""
echo "下一步操作:"
echo "  运行: ./03-config-usdc-peer.sh"
echo "  配置 USDC 地址和对端合约"
echo ""

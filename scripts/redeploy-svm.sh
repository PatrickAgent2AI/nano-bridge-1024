#!/bin/bash

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  SVM 程序完全重新部署${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# 配置
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR/.."
CONTRACT_DIR="$PROJECT_ROOT/svm/bridge1024"
OLD_KEYPAIR_PATH="$CONTRACT_DIR/target/deploy/bridge1024-keypair.json"
BACKUP_DIR="$PROJECT_ROOT/.backup_$(date +%Y%m%d_%H%M%S)"
PROGRAM_PATH="$CONTRACT_DIR/target/deploy/bridge1024.so"

# 加载环境变量
if [ -f "$PROJECT_ROOT/.env.svm.deploy" ]; then
    source "$PROJECT_ROOT/.env.svm.deploy"
fi

RPC_URL="${SVM_RPC_URL:-https://testnet-rpc.1024chain.com/rpc/}"
ADMIN_KEYPAIR="${SVM_KEYPAIR_PATH:-/root/.config/solana/id.json}"

# 1. 备份旧配置
echo -e "${YELLOW}步骤 1/6: 备份旧配置...${NC}"
mkdir -p "$BACKUP_DIR"
if [ -f "$OLD_KEYPAIR_PATH" ]; then
    OLD_PROGRAM_ID=$(solana address -k "$OLD_KEYPAIR_PATH" 2>/dev/null || echo "unknown")
    cp "$OLD_KEYPAIR_PATH" "$BACKUP_DIR/old-keypair.json"
    echo "  旧程序ID: $OLD_PROGRAM_ID"
    echo "  备份位置: $BACKUP_DIR"
fi

# 2. 生成新的程序密钥对
echo -e "${YELLOW}步骤 2/6: 生成新的程序密钥对...${NC}"
solana-keygen new --no-bip39-passphrase --outfile "$OLD_KEYPAIR_PATH" --force > /dev/null 2>&1
NEW_PROGRAM_ID=$(solana address -k "$OLD_KEYPAIR_PATH")
echo "  ✓ 新程序ID: ${GREEN}$NEW_PROGRAM_ID${NC}"

# 3. 编译程序
echo -e "${YELLOW}步骤 3/6: 编译程序...${NC}"
cd "$CONTRACT_DIR"
if ! anchor build 2>&1 | grep -q "Finished"; then
    echo -e "${RED}  ✗ 编译失败${NC}"
    exit 1
fi
echo "  ✓ 编译成功"

# 4. 检查管理员余额
echo -e "${YELLOW}步骤 4/6: 检查管理员账户...${NC}"
ADMIN_ADDRESS=$(solana address -k "$ADMIN_KEYPAIR" 2>/dev/null)
BALANCE=$(solana balance --url "$RPC_URL" -k "$ADMIN_KEYPAIR" 2>/dev/null | awk '{print $1}')
echo "  管理员地址: $ADMIN_ADDRESS"
echo "  当前余额: $BALANCE SOL"

if (( $(echo "$BALANCE < 3" | bc -l) )); then
    echo -e "${RED}  ✗ 余额不足，需要至少 3 SOL${NC}"
    echo "  请充值到: $ADMIN_ADDRESS"
    exit 1
fi

# 5. 部署新程序
echo -e "${YELLOW}步骤 5/6: 部署新程序...${NC}"
echo "  这可能需要几分钟..."

DEPLOY_OUTPUT=$(solana program deploy \
    --url "$RPC_URL" \
    --keypair "$ADMIN_KEYPAIR" \
    --program-id "$OLD_KEYPAIR_PATH" \
    --skip-preflight \
    --max-sign-attempts 10 \
    --use-rpc \
    "$PROGRAM_PATH" 2>&1)

if [ $? -ne 0 ]; then
    echo -e "${RED}  ✗ 部署失败${NC}"
    echo "$DEPLOY_OUTPUT"
    exit 1
fi

echo "  ✓ 部署成功"
echo ""
echo "$DEPLOY_OUTPUT" | grep -i "Program Id\|Signature" || true

# 6. 更新配置文件
echo -e "${YELLOW}步骤 6/6: 更新配置文件...${NC}"

# 更新 .env.svm.deploy
if [ -f "$PROJECT_ROOT/.env.svm.deploy" ]; then
    if grep -q "^SVM_PROGRAM_ID=" "$PROJECT_ROOT/.env.svm.deploy"; then
        sed -i "s|^SVM_PROGRAM_ID=.*|SVM_PROGRAM_ID=${NEW_PROGRAM_ID}|g" "$PROJECT_ROOT/.env.svm.deploy"
    else
        echo "SVM_PROGRAM_ID=${NEW_PROGRAM_ID}" >> "$PROJECT_ROOT/.env.svm.deploy"
    fi
fi

# 更新 .env.invoke
if [ -f "$PROJECT_ROOT/.env.invoke" ]; then
    if grep -q "^SVM_PROGRAM_ID=" "$PROJECT_ROOT/.env.invoke"; then
        sed -i "s|^SVM_PROGRAM_ID=.*|SVM_PROGRAM_ID=${NEW_PROGRAM_ID}|g" "$PROJECT_ROOT/.env.invoke"
    else
        echo "SVM_PROGRAM_ID=${NEW_PROGRAM_ID}" >> "$PROJECT_ROOT/.env.invoke"
    fi
fi

echo "  ✓ 配置文件已更新"

# 完成
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  重新部署完成！${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BLUE}新程序信息:${NC}"
echo "  程序ID: ${GREEN}$NEW_PROGRAM_ID${NC}"
echo "  管理员: $ADMIN_ADDRESS"
echo ""
echo -e "${YELLOW}下一步操作:${NC}"
echo "  1. 运行: bash scripts/init-svm-fresh.sh"
echo "     (初始化合约、配置USDC、配置对端、添加relayer、添加流动性)"
echo ""
echo -e "${YELLOW}旧配置备份:${NC}"
echo "  位置: $BACKUP_DIR"
echo "  旧程序ID: $OLD_PROGRAM_ID"
echo ""

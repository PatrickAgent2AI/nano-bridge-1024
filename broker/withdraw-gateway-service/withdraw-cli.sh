#!/bin/bash
# Withdraw Gateway Service CLI Tool

set -e

# 默认配置
GATEWAY_URL="${GATEWAY_URL:-http://localhost:8085}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# 硬编码的目标链和目标资产配置
declare -A CHAIN_IDS=(
    ["op"]="10"           # Optimism Mainnet (verified via LiFi API)
    ["eth"]="1"           # Ethereum Mainnet (verified via LiFi API)
)

declare -A OP_TOKENS=(
    ["usdc"]="0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85"  # OP Mainnet USDC (verified via LiFi API)
    ["eth"]="0x4200000000000000000000000000000000000006"  # OP Mainnet WETH (verified via LiFi API)
)

declare -A ETH_TOKENS=(
    ["usdc"]="0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"  # Ethereum Mainnet USDC (verified via LiFi API)
    ["eth"]="0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"  # Ethereum Mainnet WETH (verified via LiFi API)
)

# 打印帮助信息
show_help() {
    echo "Withdraw Gateway Service CLI"
    echo ""
    echo "Usage: $0 withdraw <amount> <recipient_address> [options]"
    echo ""
    echo "Commands:"
    echo "  withdraw <amount> <recipient_address>  Withdraw USDC to target chain"
    echo "  list                                  List available chains and tokens"
    echo "  help                                  Show this help message"
    echo ""
    echo "Options:"
    echo "  --chain <chain>                       Target chain: op, eth (default: op)"
    echo "  --token <token>                       Target token: usdc, eth (default: usdc)"
    echo ""
    echo "Environment Variables:"
    echo "  GATEWAY_URL                           Gateway service URL (default: http://localhost:8085)"
    echo ""
    echo "Examples:"
    echo "  $0 withdraw 1000000 \"0xRecipientAddress\" --chain op --token usdc"
    echo "  $0 withdraw 1000000 \"0xRecipientAddress\" --chain eth --token eth"
    echo "  GATEWAY_URL=http://localhost:8085 $0 withdraw 1000000 \"0xAddress\" --chain op"
    echo ""
    echo "Supported API Endpoints:"
    echo "  POST /withdraw                        Withdraw USDC to target chain"
    echo "    Parameters:"
    echo "      - target_chain: Target chain ID (integer)"
    echo "      - target_asset: Target token address (string)"
    echo "      - usdc_amount: USDC amount in smallest unit (string)"
    echo "      - recipient_address: Recipient address (string)"
}

# 列出可用的链和代币
list_options() {
    echo -e "${CYAN}=== Available Chains and Tokens ===${NC}"
    echo ""
    
    echo -e "${YELLOW}Optimism (OP) Mainnet:${NC}"
    echo "  Chain ID: ${CHAIN_IDS[op]}"
    echo "  Tokens:"
    echo "    - usdc: ${OP_TOKENS[usdc]}"
    echo "    - eth:  ${OP_TOKENS[eth]}"
    echo ""
    
    echo -e "${YELLOW}Ethereum (ETH) Mainnet:${NC}"
    echo "  Chain ID: ${CHAIN_IDS[eth]}"
    echo "  Tokens:"
    echo "    - usdc: ${ETH_TOKENS[usdc]}"
    echo "    - eth:  ${ETH_TOKENS[eth]}"
    echo ""
}

# 获取目标链 ID
get_chain_id() {
    local chain="$1"
    echo "${CHAIN_IDS[$chain]}"
}

# 获取目标代币地址
get_token_address() {
    local chain="$1"
    local token="$2"
    
    case "$chain" in
        op)
            echo "${OP_TOKENS[$token]}"
            ;;
        eth)
            echo "${ETH_TOKENS[$token]}"
            ;;
        *)
            echo ""
            ;;
    esac
}

# 验证链和代币组合
validate_chain_token() {
    local chain="$1"
    local token="$2"
    
    # 验证链
    if [ -z "${CHAIN_IDS[$chain]}" ]; then
        echo -e "${RED}Error: Invalid chain '$chain'${NC}"
        echo "Available chains: op, eth"
        return 1
    fi
    
    # 验证代币
    local token_addr=$(get_token_address "$chain" "$token")
    if [ -z "$token_addr" ]; then
        echo -e "${RED}Error: Invalid token '$token' for chain '$chain'${NC}"
        echo "Available tokens for $chain: usdc, eth"
        return 1
    fi
    
    return 0
}

# Withdraw 命令
withdraw() {
    local amount="$1"
    local recipient_address="$2"
    local chain="${3:-op}"
    local token="${4:-usdc}"
    
    if [ -z "$amount" ] || [ -z "$recipient_address" ]; then
        echo -e "${RED}Error: Missing required parameters${NC}"
        echo "Usage: $0 withdraw <amount> <recipient_address> [--chain <chain>] [--token <token>]"
        echo "Example: $0 withdraw 1000000 \"0xRecipientAddress\" --chain op --token usdc"
        exit 1
    fi
    
    # 验证链和代币
    if ! validate_chain_token "$chain" "$token"; then
        exit 1
    fi
    
    # 获取链 ID 和代币地址
    local chain_id=$(get_chain_id "$chain")
    local token_address=$(get_token_address "$chain" "$token")
    
    # 构建请求体
    local request_body=$(cat <<EOF
{
  "target_chain": $chain_id,
  "target_asset": "$token_address",
  "usdc_amount": "$amount",
  "recipient_address": "$recipient_address"
}
EOF
)
    
    echo -e "${BLUE}=== Withdraw Gateway Service - Withdraw Request ===${NC}"
    echo ""
    echo -e "${YELLOW}Service URL:${NC} $GATEWAY_URL"
    echo -e "${YELLOW}Endpoint:${NC} POST /withdraw"
    echo ""
    echo -e "${YELLOW}Configuration:${NC}"
    echo -e "  ${CYAN}Target Chain:${NC} $chain (Chain ID: $chain_id)"
    echo -e "  ${CYAN}Target Token:${NC} $token"
    echo -e "  ${CYAN}Token Address:${NC} $token_address"
    echo -e "  ${CYAN}USDC Amount:${NC} $amount"
    echo -e "  ${CYAN}Recipient:${NC} $recipient_address"
    echo ""
    echo -e "${YELLOW}Request Body:${NC}"
    echo "$request_body" | jq . 2>/dev/null || echo "$request_body"
    echo ""
    echo -e "${YELLOW}Executing request...${NC}"
    echo ""
    
    # 检查服务是否可用
    if ! curl -s --connect-timeout 2 --max-time 5 "$GATEWAY_URL/health" >/dev/null 2>&1; then
        echo -e "${RED}✗ Cannot connect to gateway service${NC}"
        echo -e "${YELLOW}Service URL: $GATEWAY_URL${NC}"
        echo ""
        echo "Please ensure:"
        echo "  1. The gateway service is running"
        echo "  2. The service URL is correct"
        echo "  3. The service is accessible from this machine"
        echo ""
        echo "To start the service:"
        echo "  cd $SCRIPT_DIR"
        echo "  npm start"
        echo ""
        exit 1
    fi
    
    # 发送请求
    local response=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
        --connect-timeout 10 \
        --max-time 120 \
        -X POST "$GATEWAY_URL/withdraw" \
        -H "Content-Type: application/json" \
        -d "$request_body" 2>&1)
    
    local http_status=$(echo "$response" | grep "HTTP_STATUS" | cut -d: -f2)
    local response_body=$(echo "$response" | grep -v "HTTP_STATUS")
    
    # 处理连接错误
    if [ -z "$http_status" ] || [ "$http_status" = "000" ]; then
        echo -e "${RED}✗ Failed to connect to gateway service${NC}"
        echo -e "${YELLOW}Service URL: $GATEWAY_URL${NC}"
        echo ""
        echo "Possible reasons:"
        echo "  - Service is not running"
        echo "  - Service URL is incorrect"
        echo "  - Network connectivity issues"
        echo ""
        echo "Response: $response_body"
        echo ""
        exit 1
    fi
    
    echo -e "${YELLOW}Response (HTTP $http_status):${NC}"
    
    # 格式化 JSON 响应
    if command -v jq >/dev/null 2>&1; then
        echo "$response_body" | jq . 2>/dev/null || echo "$response_body"
    else
        echo "$response_body"
    fi
    echo ""
    
    # 检查结果
    if [ "$http_status" = "200" ]; then
        local success=$(echo "$response_body" | grep -o '"success":[^,]*' | cut -d: -f2 | tr -d ' ')
        if [ "$success" = "true" ]; then
            echo -e "${GREEN}✓ Withdraw initiated successfully${NC}"
            local route_id=$(echo "$response_body" | grep -o '"route_id":"[^"]*"' | cut -d'"' -f4)
            local tx_hash=$(echo "$response_body" | grep -o '"tx_hash":"[^"]*"' | cut -d'"' -f4)
            if [ -n "$route_id" ]; then
                echo -e "${GREEN}Route ID: $route_id${NC}"
            fi
            if [ -n "$tx_hash" ] && [ "$tx_hash" != "null" ]; then
                echo -e "${GREEN}Transaction Hash: $tx_hash${NC}"
            fi
        else
            echo -e "${RED}✗ Withdraw failed${NC}"
            local message=$(echo "$response_body" | grep -o '"message":"[^"]*"' | cut -d'"' -f4)
            if [ -n "$message" ]; then
                echo -e "${RED}Error: $message${NC}"
            fi
        fi
    else
        echo -e "${RED}✗ Request failed with HTTP $http_status${NC}"
        local message=$(echo "$response_body" | grep -o '"message":"[^"]*"' | cut -d'"' -f4)
        if [ -n "$message" ]; then
            echo -e "${RED}Error: $message${NC}"
        fi
    fi
    echo ""
}

# 解析命令行参数
parse_args() {
    local amount=""
    local recipient_address=""
    local chain="op"
    local token="usdc"
    
    while [[ $# -gt 0 ]]; do
        case $1 in
            --chain)
                chain="$2"
                shift 2
                ;;
            --token)
                token="$2"
                shift 2
                ;;
            *)
                if [ -z "$amount" ]; then
                    amount="$1"
                elif [ -z "$recipient_address" ]; then
                    recipient_address="$1"
                else
                    echo -e "${RED}Error: Unknown argument '$1'${NC}"
                    exit 1
                fi
                shift
                ;;
        esac
    done
    
    withdraw "$amount" "$recipient_address" "$chain" "$token"
}

# 主函数
main() {
    local command="${1:-help}"
    
    case "$command" in
        withdraw)
            shift
            parse_args "$@"
            ;;
        list)
            list_options
            ;;
        help|--help|-h)
            show_help
            ;;
        *)
            echo -e "${RED}Error: Unknown command '$command'${NC}"
            echo ""
            show_help
            exit 1
            ;;
    esac
}

# 运行主函数
main "$@"


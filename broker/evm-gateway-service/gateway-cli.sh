#!/bin/bash
# EVM Gateway Service CLI Tool

set -e

# 默认配置
GATEWAY_URL="${GATEWAY_URL:-http://localhost:8080}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 打印帮助信息
show_help() {
    echo "EVM Gateway Service CLI"
    echo ""
    echo "Usage: $0 <command> [options]"
    echo ""
    echo "Commands:"
    echo "  stake <amount> <target_address>  Stake USDC to 1024chain"
    echo "  help                             Show this help message"
    echo ""
    echo "Environment Variables:"
    echo "  GATEWAY_URL                      Gateway service URL (default: http://localhost:8084)"
    echo ""
    echo "Examples:"
    echo "  $0 stake 1000000 \"1024chain_address_here\""
    echo "  GATEWAY_URL=http://localhost:8084 $0 stake 1000000 \"address\""
    echo ""
    echo "Supported API Endpoints:"
    echo "  POST /stake                      Stake USDC to 1024chain"
    echo "    Parameters:"
    echo "      - amount: USDC amount in smallest unit (string)"
    echo "      - target_address: 1024chain receiver address (string)"
}

# Stake 命令
stake() {
    local amount="$1"
    local target_address="$2"

    if [ -z "$amount" ] || [ -z "$target_address" ]; then
        echo -e "${RED}Error: Missing required parameters${NC}"
        echo "Usage: $0 stake <amount> <target_address>"
        echo "Example: $0 stake 1000000 \"1024chain_address_here\""
        exit 1
    fi

    # 构建请求体
    local request_body=$(cat <<EOF
{
  "amount": "$amount",
  "target_address": "$target_address"
}
EOF
)

    echo -e "${BLUE}=== EVM Gateway Service - Stake Request ===${NC}"
    echo ""
    echo -e "${YELLOW}Service URL:${NC} $GATEWAY_URL"
    echo -e "${YELLOW}Endpoint:${NC} POST /stake"
    echo ""
    echo -e "${YELLOW}Request Body:${NC}"
    echo "$request_body" | jq . 2>/dev/null || echo "$request_body"
    echo ""
    echo -e "${YELLOW}Executing request...${NC}"
    echo ""

    # 检查服务是否可用
    if ! curl -s --connect-timeout 2 --max-time 5 "$GATEWAY_URL" >/dev/null 2>&1; then
        echo -e "${RED}✗ Cannot connect to gateway service${NC}"
        echo -e "${YELLOW}Service URL: $GATEWAY_URL${NC}"
        echo ""
        echo "Please ensure:"
        echo "  1. The gateway service is running"
        echo "  2. The service URL is correct"
        echo "  3. The service is accessible from this machine"
        echo ""
        echo "To start the service:"
        echo "  cd $(dirname "$SCRIPT_DIR")/evm-gateway-service"
        echo "  cargo run --release"
        echo ""
        exit 1
    fi

    # 发送请求
    local response=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
        --connect-timeout 10 \
        --max-time 60 \
        -X POST "$GATEWAY_URL/stake" \
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
            echo -e "${GREEN}✓ Stake successful${NC}"
            local tx_hash=$(echo "$response_body" | grep -o '"tx_hash":"[^"]*"' | cut -d'"' -f4)
            if [ -n "$tx_hash" ]; then
                echo -e "${GREEN}Transaction Hash: $tx_hash${NC}"
            fi
        else
            echo -e "${RED}✗ Stake failed${NC}"
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

# 主函数
main() {
    local command="${1:-help}"

    case "$command" in
        stake)
            shift
            stake "$@"
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


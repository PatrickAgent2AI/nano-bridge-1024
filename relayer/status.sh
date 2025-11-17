#!/bin/bash

# Relayer 状态查看脚本（纯 Docker 命令）

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_header() {
    echo ""
    echo "========================================"
    echo "  $1"
    echo "========================================"
    echo ""
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

# 显示容器状态
print_header "容器状态"
docker ps -a --filter "name=s2e-relayer" --filter "name=e2s-listener" --filter "name=e2s-submitter" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# 检查 API 健康状态
print_header "服务健康检查"

# s2e-relayer
echo -n "s2e-relayer (8083): "
if response=$(curl -s -w "\n%{http_code}" http://localhost:8083/health 2>/dev/null); then
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | head -n-1)
    
    if [ "$http_code" = "200" ]; then
        print_success "健康"
        if command -v jq &> /dev/null; then
            echo "$body" | jq '.'
        else
            echo "$body"
        fi
    else
        print_error "不健康 (HTTP $http_code)"
    fi
else
    print_error "不可用"
fi
echo ""

# e2s-submitter
echo -n "e2s-submitter (8082): "
if response=$(curl -s -w "\n%{http_code}" http://localhost:8082/health 2>/dev/null); then
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | head -n-1)
    
    if [ "$http_code" = "200" ]; then
        print_success "健康"
        if command -v jq &> /dev/null; then
            echo "$body" | jq '.'
        else
            echo "$body"
        fi
    else
        print_error "不健康 (HTTP $http_code)"
    fi
else
    print_error "不可用"
fi
echo ""

# 显示资源使用
print_header "资源使用情况"
docker stats --no-stream s2e-relayer e2s-listener e2s-submitter 2>/dev/null || echo "无法获取资源使用情况"

echo ""

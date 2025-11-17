#!/bin/bash

# Relayer 重启脚本（纯 Docker 命令）

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_step() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

echo ""
echo "========================================"
echo "  重启 Relayer 服务"
echo "========================================"
echo ""

# 检查参数
SERVICE=$1

if [ -z "$SERVICE" ]; then
    # 重启所有服务
    print_step "重启所有服务..."
    
    for container in s2e-relayer e2s-listener e2s-submitter; do
        if docker ps -a --format '{{.Names}}' | grep -q "^${container}$"; then
            echo "重启 $container..."
            docker restart $container
            print_success "$container 已重启"
        else
            print_error "$container 不存在"
        fi
    done
    
    print_success "所有服务已重启"
else
    # 重启指定服务
    case "$SERVICE" in
        s2e|s2e-relayer)
            print_step "重启 s2e-relayer..."
            docker restart s2e-relayer
            print_success "s2e-relayer 已重启"
            ;;
        listener|e2s-listener)
            print_step "重启 e2s-listener..."
            docker restart e2s-listener
            print_success "e2s-listener 已重启"
            ;;
        submitter|e2s-submitter)
            print_step "重启 e2s-submitter..."
            docker restart e2s-submitter
            print_success "e2s-submitter 已重启"
            ;;
        *)
            print_error "未知服务: $SERVICE"
            echo "可用服务: s2e, listener, submitter"
            exit 1
            ;;
    esac
fi

echo ""
echo "服务状态:"
docker ps --filter "name=s2e-relayer" --filter "name=e2s-listener" --filter "name=e2s-submitter" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo ""
print_success "重启完成！"
echo ""

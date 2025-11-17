#!/bin/bash

# Relayer 停止脚本（纯 Docker 命令）

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

echo ""
echo "========================================"
echo "  停止 Relayer 服务"
echo "========================================"
echo ""

# 停止所有容器
print_step "停止容器..."

for container in s2e-relayer e2s-listener e2s-submitter; do
    if docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
        echo "停止 $container..."
        docker stop $container
        print_success "$container 已停止"
    else
        echo "$container 未运行"
    fi
done

echo ""
print_success "所有服务已停止"

echo ""
echo "查看服务状态:"
docker ps -a --filter "name=s2e-relayer" --filter "name=e2s-listener" --filter "name=e2s-submitter" --format "table {{.Names}}\t{{.Status}}"

echo ""
echo "如需删除容器，运行:"
echo "  docker rm s2e-relayer e2s-listener e2s-submitter"
echo ""
echo "如需删除镜像，运行:"
echo "  docker rmi s2e-relayer:latest e2s-listener:latest e2s-submitter:latest"
echo ""

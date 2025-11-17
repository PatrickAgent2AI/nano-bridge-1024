#!/bin/bash

# Relayer 日志查看脚本（纯 Docker 命令）

# 颜色定义
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

SERVICE=$1
TAIL_LINES=${2:-100}

if [ -z "$SERVICE" ]; then
    # 显示使用说明
    echo "用法: $0 [服务名] [行数]"
    echo ""
    echo "服务名:"
    echo "  s2e         - S2E Relayer"
    echo "  listener    - E2S Listener"
    echo "  submitter   - E2S Submitter"
    echo ""
    echo "示例:"
    echo "  $0 s2e          # 显示 s2e 日志"
    echo "  $0 s2e 200      # 显示 s2e 最近 200 行日志"
    echo "  $0 listener     # 显示 listener 日志"
    echo "  $0 submitter    # 显示 submitter 日志"
    echo ""
    exit 1
else
    # 显示指定服务日志
    case "$SERVICE" in
        s2e|s2e-relayer)
            print_info "显示 s2e-relayer 日志（最近 ${TAIL_LINES} 行）"
            docker logs --tail=${TAIL_LINES} -f s2e-relayer
            ;;
        listener|e2s-listener)
            print_info "显示 e2s-listener 日志（最近 ${TAIL_LINES} 行）"
            docker logs --tail=${TAIL_LINES} -f e2s-listener
            ;;
        submitter|e2s-submitter)
            print_info "显示 e2s-submitter 日志（最近 ${TAIL_LINES} 行）"
            docker logs --tail=${TAIL_LINES} -f e2s-submitter
            ;;
        *)
            echo "未知服务: $SERVICE"
            echo "可用服务: s2e, listener, submitter"
            exit 1
            ;;
    esac
fi

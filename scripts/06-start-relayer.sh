#!/bin/bash

# ============================================
# Relayer 启动/停止脚本
# ============================================
# 功能：
# 1. 启动三个 relayer 组件（s2e, e2s-listener, e2s-submitter）
# 2. 输出重定向到 relayer/logs 文件夹下的同名加时间戳的log文件
# 3. 保存三个 pid 到 relayer 文件夹下
# 4. 支持停止功能

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
RELAYER_DIR="$PROJECT_ROOT/relayer"
LOGS_DIR="$RELAYER_DIR/logs"
PID_DIR="$RELAYER_DIR"

# 创建日志目录
mkdir -p "$LOGS_DIR"

# PID 文件路径
PID_S2E="$PID_DIR/s2e.pid"
PID_E2S_LISTENER="$PID_DIR/e2s-listener.pid"
PID_E2S_SUBMITTER="$PID_DIR/e2s-submitter.pid"

# 时间戳
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# ==============================================================================
# 辅助函数
# ==============================================================================

# 检查进程是否运行
check_process() {
    local pid_file=$1
    local name=$2
    
    if [ -f "$pid_file" ]; then
        local pid=$(cat "$pid_file")
        if ps -p "$pid" > /dev/null 2>&1; then
            return 0  # 进程运行中
        else
            rm -f "$pid_file"
            return 1  # 进程不存在
        fi
    fi
    return 1  # PID文件不存在
}

# 停止进程
stop_process() {
    local pid_file=$1
    local name=$2
    
    if [ -f "$pid_file" ]; then
        local pid=$(cat "$pid_file")
        if ps -p "$pid" > /dev/null 2>&1; then
            echo -e "${YELLOW}停止 $name (PID: $pid)...${NC}"
            kill "$pid" 2>/dev/null || true
            sleep 1
            if ps -p "$pid" > /dev/null 2>&1; then
                kill -9 "$pid" 2>/dev/null || true
            fi
            rm -f "$pid_file"
            echo -e "${GREEN}✓ $name 已停止${NC}"
        else
            rm -f "$pid_file"
            echo -e "${YELLOW}⚠ $name 进程不存在，清理 PID 文件${NC}"
        fi
    else
        echo -e "${YELLOW}⚠ $name PID 文件不存在${NC}"
    fi
}

# 启动进程
start_process() {
    local component=$1
    local pid_file=$2
    local log_file="$LOGS_DIR/${component}_${TIMESTAMP}.log"
    
    # 检查是否已运行
    if check_process "$pid_file" "$component"; then
        local pid=$(cat "$pid_file")
        echo -e "${YELLOW}⚠ $component 已在运行 (PID: $pid)${NC}"
        return 0
    fi
    
    # 检查组件目录是否存在
    local component_dir="$RELAYER_DIR/$component"
    if [ ! -d "$component_dir" ]; then
        echo -e "${RED}❌ 错误: 组件目录不存在: $component_dir${NC}"
        return 1
    fi
    
    echo -e "${BLUE}启动 $component...${NC}"
    echo -e "  日志文件: ${CYAN}$log_file${NC}"
    
    # 进入组件目录并启动
    cd "$component_dir"
    nohup cargo run --release > "$log_file" 2>&1 &
    local pid=$!
    
    # 保存 PID
    echo "$pid" > "$pid_file"
    
    # 等待一下确认进程启动
    sleep 2
    if ps -p "$pid" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ $component 已启动 (PID: $pid)${NC}"
        return 0
    else
        echo -e "${RED}❌ $component 启动失败，请查看日志: $log_file${NC}"
        rm -f "$pid_file"
        return 1
    fi
}

# ==============================================================================
# 主逻辑
# ==============================================================================

case "${1:-start}" in
    start)
        echo -e "${CYAN}========================================${NC}"
        echo -e "${CYAN}  启动 Relayer 服务${NC}"
        echo -e "${CYAN}========================================${NC}"
        echo ""
        
        # 启动三个组件
        start_process "s2e" "$PID_S2E"
        start_process "e2s-listener" "$PID_E2S_LISTENER"
        start_process "e2s-submitter" "$PID_E2S_SUBMITTER"
        
        echo ""
        echo -e "${GREEN}========================================${NC}"
        echo -e "${GREEN}  Relayer 服务启动完成${NC}"
        echo -e "${GREEN}========================================${NC}"
        echo ""
        echo -e "${CYAN}运行状态:${NC}"
        echo -e "  s2e:           $(check_process "$PID_S2E" "s2e" && echo -e "${GREEN}运行中${NC} (PID: $(cat "$PID_S2E"))" || echo -e "${RED}未运行${NC}")"
        echo -e "  e2s-listener:  $(check_process "$PID_E2S_LISTENER" "e2s-listener" && echo -e "${GREEN}运行中${NC} (PID: $(cat "$PID_E2S_LISTENER"))" || echo -e "${RED}未运行${NC}")"
        echo -e "  e2s-submitter: $(check_process "$PID_E2S_SUBMITTER" "e2s-submitter" && echo -e "${GREEN}运行中${NC} (PID: $(cat "$PID_E2S_SUBMITTER"))" || echo -e "${RED}未运行${NC}")"
        echo ""
        echo -e "${CYAN}日志文件:${NC}"
        echo -e "  ${BLUE}$LOGS_DIR/${NC}"
        echo ""
        echo -e "${YELLOW}停止服务:${NC} $0 stop"
        ;;
    
    stop)
        echo -e "${CYAN}========================================${NC}"
        echo -e "${CYAN}  停止 Relayer 服务${NC}"
        echo -e "${CYAN}========================================${NC}"
        echo ""
        
        stop_process "$PID_E2S_SUBMITTER" "e2s-submitter"
        stop_process "$PID_E2S_LISTENER" "e2s-listener"
        stop_process "$PID_S2E" "s2e"
        
        echo ""
        echo -e "${GREEN}========================================${NC}"
        echo -e "${GREEN}  所有 Relayer 服务已停止${NC}"
        echo -e "${GREEN}========================================${NC}"
        ;;
    
    status)
        echo -e "${CYAN}========================================${NC}"
        echo -e "${CYAN}  Relayer 服务状态${NC}"
        echo -e "${CYAN}========================================${NC}"
        echo ""
        
        if check_process "$PID_S2E" "s2e"; then
            echo -e "s2e:           ${GREEN}运行中${NC} (PID: $(cat "$PID_S2E"))"
        else
            echo -e "s2e:           ${RED}未运行${NC}"
        fi
        
        if check_process "$PID_E2S_LISTENER" "e2s-listener"; then
            echo -e "e2s-listener:  ${GREEN}运行中${NC} (PID: $(cat "$PID_E2S_LISTENER"))"
        else
            echo -e "e2s-listener:  ${RED}未运行${NC}"
        fi
        
        if check_process "$PID_E2S_SUBMITTER" "e2s-submitter"; then
            echo -e "e2s-submitter: ${GREEN}运行中${NC} (PID: $(cat "$PID_E2S_SUBMITTER"))"
        else
            echo -e "e2s-submitter: ${RED}未运行${NC}"
        fi
        ;;
    
    *)
        echo "用法: $0 {start|stop|status}"
        echo ""
        echo "命令:"
        echo "  start   - 启动所有 relayer 服务（默认）"
        echo "  stop    - 停止所有 relayer 服务"
        echo "  status  - 查看服务状态"
        exit 1
        ;;
esac


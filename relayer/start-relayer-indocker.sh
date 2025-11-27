#!/bin/bash

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

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 启动三个 relayer 组件
cd $PROJECT_ROOT/s2e
cargo build --release
nohup cargo run --release > "$PROJECT_ROOT/logs/s2e.log" 2>&1 &
echo $! > "$PROJECT_ROOT/s2e.pid"

cd $PROJECT_ROOT/e2s-listener
cargo build --release
nohup cargo run --release > "$PROJECT_ROOT/logs/e2s-listener.log" 2>&1 &
echo $! > "$PROJECT_ROOT/e2s-listener.pid"

cd $PROJECT_ROOT/e2s-submitter
cargo build --release
nohup cargo run --release > "$PROJECT_ROOT/logs/e2s-submitter.log" 2>&1 &
echo $! > "$PROJECT_ROOT/e2s-submitter.pid"

echo -e "${GREEN}三个 relayer 组件已启动${NC}"

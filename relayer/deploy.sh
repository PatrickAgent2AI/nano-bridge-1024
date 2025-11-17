#!/bin/bash

# Relayer 一键部署脚本（纯 Docker 命令）
# 功能：自动创建必要的目录、配置文件，并启动 Docker 容器

set -e  # 遇到错误立即退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 打印函数
print_step() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

# 检查依赖
check_dependencies() {
    print_step "检查依赖..."
    
    if ! command -v docker &> /dev/null; then
        print_error "Docker 未安装，请先安装 Docker"
        exit 1
    fi
    print_success "Docker 已安装: $(docker --version)"
}

# 创建目录结构
create_directories() {
    print_step "创建目录结构..."
    
    mkdir -p logs/s2e
    mkdir -p logs/e2s-listener
    mkdir -p logs/e2s-submitter
    mkdir -p queue
    mkdir -p keys
    
    print_success "目录创建完成"
}

# 设置权限
set_permissions() {
    print_step "设置目录权限..."
    
    # 确保日志和队列目录可写
    chmod -R 755 logs/ queue/
    
    # 密钥目录只读
    if [ -d "keys" ] && [ "$(ls -A keys/)" ]; then
        chmod -R 400 keys/*
        print_success "密钥文件权限设置为只读"
    fi
    
    print_success "权限设置完成"
}

# 检查配置文件
check_config_files() {
    print_step "检查配置文件..."
    
    local missing_config=false
    
    # 检查 s2e 配置
    if [ ! -f "s2e/.env" ]; then
        if [ -f "s2e/config.example.env" ]; then
            print_warning "s2e/.env 不存在，从示例复制..."
            cp s2e/config.example.env s2e/.env
            print_success "已创建 s2e/.env，请编辑后重新运行"
        else
            print_error "s2e/config.example.env 不存在"
        fi
        missing_config=true
    else
        print_success "s2e/.env 存在"
    fi
    
    # 检查 e2s-listener 配置
    if [ ! -f "e2s-listener/.env" ]; then
        print_warning "e2s-listener/.env 不存在，将使用环境变量"
    else
        print_success "e2s-listener/.env 存在"
    fi
    
    # 检查 e2s-submitter 配置
    if [ ! -f "e2s-submitter/.env" ]; then
        print_warning "e2s-submitter/.env 不存在，将使用环境变量"
    else
        print_success "e2s-submitter/.env 存在"
    fi
    
    if [ "$missing_config" = true ]; then
        print_error "配置文件缺失或未配置，请编辑 .env 文件后重新运行"
        echo ""
        echo "需要配置的文件："
        echo "  - s2e/.env"
        echo "  - e2s-listener/.env（可选）"
        echo "  - e2s-submitter/.env（可选）"
        exit 1
    fi
}

# 构建 Docker 镜像
build_images() {
    print_step "构建 Docker 镜像..."
    
    # 构建 s2e
    print_step "构建 s2e-relayer 镜像..."
    if docker build -f Dockerfile.s2e -t s2e-relayer:latest .; then
        print_success "s2e-relayer 镜像构建成功"
    else
        print_error "s2e-relayer 镜像构建失败"
        exit 1
    fi
    
    # 构建 e2s-listener
    print_step "构建 e2s-listener 镜像..."
    if docker build -f Dockerfile.e2s-listener -t e2s-listener:latest .; then
        print_success "e2s-listener 镜像构建成功"
    else
        print_error "e2s-listener 镜像构建失败"
        exit 1
    fi
    
    # 构建 e2s-submitter
    print_step "构建 e2s-submitter 镜像..."
    if docker build -f Dockerfile.e2s-submitter -t e2s-submitter:latest .; then
        print_success "e2s-submitter 镜像构建成功"
    else
        print_error "e2s-submitter 镜像构建失败"
        exit 1
    fi
}

# 创建 Docker 网络
create_network() {
    print_step "创建 Docker 网络..."
    
    if docker network inspect relayer-network >/dev/null 2>&1; then
        print_success "网络 relayer-network 已存在"
    else
        docker network create relayer-network
        print_success "网络 relayer-network 创建成功"
    fi
}

# 停止并删除旧容器
cleanup_old_containers() {
    print_step "清理旧容器..."
    
    for container in s2e-relayer e2s-listener e2s-submitter; do
        if docker ps -a --format '{{.Names}}' | grep -q "^${container}$"; then
            print_step "停止并删除容器: $container"
            docker stop $container >/dev/null 2>&1 || true
            docker rm $container >/dev/null 2>&1 || true
        fi
    done
    
    print_success "旧容器清理完成"
}

# 启动服务
start_services() {
    print_step "启动服务..."
    
    # 启动 s2e-relayer
    print_step "启动 s2e-relayer..."
    docker run -d \
        --name s2e-relayer \
        --network relayer-network \
        --restart unless-stopped \
        -p 8083:8083 \
        --env-file s2e/.env \
        -v "$(pwd)/logs/s2e:/app/logs" \
        -v "$(pwd)/keys:/app/keys:ro" \
        s2e-relayer:latest
    print_success "s2e-relayer 已启动"
    
    # 启动 e2s-listener
    print_step "启动 e2s-listener..."
    print_warning "注意：e2s-listener 和 e2s-submitter 共享队列目录 $(pwd)/queue"
    docker run -d \
        --name e2s-listener \
        --network relayer-network \
        --restart unless-stopped \
        --env-file e2s-listener/.env \
        -v "$(pwd)/logs/e2s-listener:/app/logs" \
        -v "$(pwd)/queue:/app/queue" \
        e2s-listener:latest
    print_success "e2s-listener 已启动"
    
    # 启动 e2s-submitter
    print_step "启动 e2s-submitter..."
    docker run -d \
        --name e2s-submitter \
        --network relayer-network \
        --restart unless-stopped \
        -p 8082:8082 \
        --env-file e2s-submitter/.env \
        -v "$(pwd)/logs/e2s-submitter:/app/logs" \
        -v "$(pwd)/queue:/app/queue" \
        -v "$(pwd)/keys:/app/keys:ro" \
        e2s-submitter:latest
    print_success "e2s-submitter 已启动"
    print_success "e2s 服务共享队列配置完成"
}

# 等待服务就绪
wait_for_services() {
    print_step "等待服务就绪..."
    
    local max_attempts=30
    local attempt=0
    
    # 等待 s2e 服务
    echo -n "等待 s2e-relayer (8083)..."
    while [ $attempt -lt $max_attempts ]; do
        if curl -s http://localhost:8083/health > /dev/null 2>&1; then
            echo -e " ${GREEN}就绪${NC}"
            break
        fi
        echo -n "."
        sleep 2
        attempt=$((attempt + 1))
    done
    
    if [ $attempt -eq $max_attempts ]; then
        echo -e " ${YELLOW}超时（服务可能仍在启动中）${NC}"
    fi
    
    # 等待 e2s-submitter 服务
    attempt=0
    echo -n "等待 e2s-submitter (8082)..."
    while [ $attempt -lt $max_attempts ]; do
        if curl -s http://localhost:8082/health > /dev/null 2>&1; then
            echo -e " ${GREEN}就绪${NC}"
            break
        fi
        echo -n "."
        sleep 2
        attempt=$((attempt + 1))
    done
    
    if [ $attempt -eq $max_attempts ]; then
        echo -e " ${YELLOW}超时（服务可能仍在启动中）${NC}"
    fi
}

# 显示服务状态
show_status() {
    print_step "服务状态:"
    echo ""
    docker ps --filter "name=s2e-relayer" --filter "name=e2s-listener" --filter "name=e2s-submitter" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    echo ""
    
    print_step "健康检查:"
    echo ""
    
    # s2e 健康检查
    if curl -s http://localhost:8083/health > /dev/null 2>&1; then
        echo -e "${GREEN}✓${NC} s2e-relayer (8083): 健康"
        curl -s http://localhost:8083/health | jq '.' 2>/dev/null || echo ""
    else
        echo -e "${RED}✗${NC} s2e-relayer (8083): 不可用"
    fi
    echo ""
    
    # e2s-submitter 健康检查
    if curl -s http://localhost:8082/health > /dev/null 2>&1; then
        echo -e "${GREEN}✓${NC} e2s-submitter (8082): 健康"
        curl -s http://localhost:8082/health | jq '.' 2>/dev/null || echo ""
    else
        echo -e "${RED}✗${NC} e2s-submitter (8082): 不可用"
    fi
    echo ""
}

# 显示日志查看命令
show_log_commands() {
    print_step "查看日志命令:"
    echo ""
    echo "  # 查看 s2e-relayer 日志"
    echo "  docker logs -f s2e-relayer"
    echo ""
    echo "  # 查看 e2s-listener 日志"
    echo "  docker logs -f e2s-listener"
    echo ""
    echo "  # 查看 e2s-submitter 日志"
    echo "  docker logs -f e2s-submitter"
    echo ""
    echo "  # 或使用快捷脚本"
    echo "  ./logs.sh s2e"
    echo "  ./logs.sh listener"
    echo "  ./logs.sh submitter"
    echo ""
}

# 显示管理命令
show_management_commands() {
    print_step "管理命令:"
    echo ""
    echo "  # 停止服务"
    echo "  ./stop.sh"
    echo ""
    echo "  # 重启服务"
    echo "  ./restart.sh [服务名]"
    echo ""
    echo "  # 查看状态"
    echo "  ./status.sh"
    echo ""
}

# 主函数
main() {
    echo ""
    echo "========================================"
    echo "  Relayer 容器化部署脚本"
    echo "  (纯 Docker 命令)"
    echo "========================================"
    echo ""
    
    # 执行部署步骤
    check_dependencies
    create_directories
    check_config_files
    set_permissions
    create_network
    cleanup_old_containers
    build_images
    start_services
    wait_for_services
    
    echo ""
    echo "========================================"
    echo -e "  ${GREEN}部署完成！${NC}"
    echo "========================================"
    echo ""
    
    show_status
    show_log_commands
    show_management_commands
    
    print_success "Relayer 服务已成功启动！"
    echo ""
}

# 运行主函数
main "$@"

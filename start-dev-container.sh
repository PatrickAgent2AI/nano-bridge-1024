#!/bin/bash

set -e

IMAGE_NAME="bridge-dev"
CONTAINER_NAME="bridge"
DOCKERFILE="Dockerfile-dev"

# 参数解析
AUTO_YES=false
AUTO_NO=false
ACTION=""

for arg in "$@"; do
  case $arg in
    -y|--yes) AUTO_YES=true ;;
    -n|--no) AUTO_NO=true ;;
    build|run) ACTION="$arg" ;;
    *) echo "❌ 未知参数: $arg"; exit 1 ;;
  esac
done

# 交互式确认
confirm() {
  [[ "$AUTO_YES" == true ]] && return 0
  [[ "$AUTO_NO" == true ]] && return 1
  read -p "$1 (y/n): " -n 1 -r
  echo
  [[ $REPLY =~ ^[Yy]$ ]]
}

# 构建镜像
build_image() {
  if docker images -q "$IMAGE_NAME" 2>/dev/null | grep -q .; then
    echo "⚠️  镜像 $IMAGE_NAME 已存在"
    confirm "是否覆盖?" || { echo "❌ 取消构建"; exit 0; }
  fi
  
  echo "🔨 构建镜像 $IMAGE_NAME..."
  docker build -f "$DOCKERFILE" -t "$IMAGE_NAME" .
  echo "✅ 镜像构建完成"
}

# 运行容器
run_container() {
  if ! docker images -q "$IMAGE_NAME" 2>/dev/null | grep -q .; then
    echo "❌ 镜像 $IMAGE_NAME 不存在，请先执行: $0 build"
    exit 1
  fi
  
  if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "⚠️  容器 $CONTAINER_NAME 已存在"
    if confirm "是否删除旧容器?"; then
      docker rm -f "$CONTAINER_NAME" >/dev/null
      echo "🗑️  已删除旧容器"
    else
      echo "❌ 取消创建"
      exit 0
    fi
  fi
  
  echo "🚀 启动容器 $CONTAINER_NAME..."
  docker run -d \
    --name "$CONTAINER_NAME" \
    --privileged \
    -v "$(pwd):/workspace" \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -p 8545:8545 \
    -p 8899:8899 \
    "$IMAGE_NAME" \
    tail -f /dev/null
  
  echo "✅ 容器已启动"
  echo "💡 进入容器: docker exec -it $CONTAINER_NAME bash"
}

# 主逻辑
case "$ACTION" in
  build) build_image ;;
  run) run_container ;;
  *) 
    echo "用法: $0 {build|run} [-y|--yes] [-n|--no]"
    echo "  build  构建镜像 $IMAGE_NAME"
    echo "  run    运行容器 $CONTAINER_NAME"
    echo "  -y     自动确认所有操作"
    echo "  -n     自动拒绝所有操作"
    exit 1
    ;;
esac


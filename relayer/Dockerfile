FROM ubuntu:24.04

RUN apt-get update && apt-get install -y \
    curl \
    wget \
    build-essential \
    pkg-config \
    libssl-dev \
    ca-certificates \
    gnupg \
    lsb-release \
    sudo \
    jq tree net-tools 

# 安装最新版本的Rust工具链
RUN curl https://sh.rustup.rs -sSf | sh -s -- -y --default-toolchain stable
ENV PATH="/root/.cargo/bin:${PATH}"

RUN mkdir -p /app/
RUN mkdir -p /app/logs

COPY e2s-listener /app/e2s-listener
COPY s2e /app/s2e
COPY e2s-submitter /app/e2s-submitter
COPY shared /app/shared
COPY start-relayer-indocker.sh /app/start-relayer-indocker.sh

CMD ["tail", "-f", "/dev/null"]

use anyhow::{Context, Result};
use axum::{
    extract::State,
    http::StatusCode,
    response::Json,
    routing::post,
    Router,
};
use ethers::{
    abi::Abi,
    contract::Contract,
    core::types::Address,
    middleware::SignerMiddleware,
    prelude::*,
    providers::{Http, Provider},
    signers::{LocalWallet, Signer as EthersSigner},
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;
use tower_http::cors::{CorsLayer, Any};
use axum::http::HeaderName;
use tracing::{error, info};

#[derive(Debug, Deserialize)]
struct StakeRequest {
    amount: String,           // USDC 金额（字符串格式，支持大数）
    target_address: String,   // 1024chain 接收地址
}

#[derive(Debug, Serialize)]
struct StakeResponse {
    success: bool,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    tx_hash: Option<String>,
}

#[derive(Clone)]
struct AppState {
    bridge_contract: Arc<Contract<SignerMiddleware<Provider<Http>, LocalWallet>>>,
    usdc_contract: Arc<Contract<SignerMiddleware<Provider<Http>, LocalWallet>>>,
    wallet_address: Address,
    // 使用 Mutex 序列化交易发送，避免 nonce 冲突和余额检查竞态
    tx_mutex: Arc<Mutex<()>>,
}

// Bridge 合约 ABI（仅包含需要的函数）
const BRIDGE_ABI: &str = r#"
[
    {
        "inputs": [
            {"internalType": "uint256", "name": "amount", "type": "uint256"},
            {"internalType": "string", "name": "receiverAddress", "type": "string"}
        ],
        "name": "stake",
        "outputs": [{"internalType": "uint64", "name": "", "type": "uint64"}],
        "stateMutability": "nonpayable",
        "type": "function"
    }
]
"#;

// ERC20 USDC 合约 ABI（仅包含需要的函数）
const ERC20_ABI: &str = r#"
[
    {
        "inputs": [
            {"internalType": "address", "name": "spender", "type": "address"},
            {"internalType": "uint256", "name": "amount", "type": "uint256"}
        ],
        "name": "approve",
        "outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {"internalType": "address", "name": "owner", "type": "address"},
            {"internalType": "address", "name": "spender", "type": "address"}
        ],
        "name": "allowance",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [{"internalType": "address", "name": "account", "type": "address"}],
        "name": "balanceOf",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function"
    }
]
"#;

#[tokio::main]
async fn main() -> Result<()> {
    // 初始化日志
    // 默认日志级别：RUST_LOG=info
    // 可以通过环境变量设置：RUST_LOG=debug 查看详细调试信息
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"))
        )
        .init();

    // 加载配置
    dotenvy::dotenv().ok();

    let rpc_url = std::env::var("RPC_URL")
        .context("RPC_URL environment variable not set")?;

    let private_key_hex = std::env::var("PRIVATE_KEY")
        .context("PRIVATE_KEY environment variable not set (hex format, with or without 0x prefix)")?;

    let bridge_contract_address = std::env::var("BRIDGE_CONTRACT_ADDRESS")
        .context("BRIDGE_CONTRACT_ADDRESS environment variable not set")?;

    let usdc_contract_address = std::env::var("USDC_CONTRACT_ADDRESS")
        .context("USDC_CONTRACT_ADDRESS environment variable not set")?;

    let chain_id = std::env::var("CHAIN_ID")
        .unwrap_or_else(|_| "421614".to_string()) // 默认 Arbitrum Sepolia
        .parse::<u64>()
        .context("Invalid CHAIN_ID")?;

    let port = std::env::var("PORT")
        .unwrap_or_else(|_| "8080".to_string())
        .parse::<u16>()
        .context("Invalid PORT")?;

    // CORS 配置：从环境变量读取允许的源，默认允许 localhost:3000
    let allowed_origin = std::env::var("CORS_ALLOW_ORIGIN")
        .unwrap_or_else(|_| "http://localhost:3000".to_string());

    // 创建 Provider
    let provider = Provider::<Http>::try_from(rpc_url.clone())
        .context("Failed to create provider")?;

    // 解析私钥
    let private_key_hex = private_key_hex.strip_prefix("0x").unwrap_or(&private_key_hex);
    let wallet: LocalWallet = private_key_hex
        .parse()
        .context("Failed to parse private key")?;

    // 设置链 ID
    let wallet = wallet.with_chain_id(chain_id);

    // 创建签名中间件
    let client = Arc::new(SignerMiddleware::new(provider, wallet.clone()));

    let wallet_address = wallet.address();

    // 解析合约地址
    let bridge_address: Address = bridge_contract_address
        .parse()
        .context("Invalid BRIDGE_CONTRACT_ADDRESS")?;

    let usdc_address: Address = usdc_contract_address
        .parse()
        .context("Invalid USDC_CONTRACT_ADDRESS")?;

    // 解析 ABI 并创建合约实例
    let bridge_abi: Abi = serde_json::from_str(BRIDGE_ABI)
        .context("Failed to parse BRIDGE_ABI")?;

    let usdc_abi: Abi = serde_json::from_str(ERC20_ABI)
        .context("Failed to parse ERC20_ABI")?;

    let bridge_contract = Arc::new(Contract::new(bridge_address, bridge_abi, client.clone()));
    let usdc_contract = Arc::new(Contract::new(usdc_address, usdc_abi, client.clone()));

    info!(
        rpc_url = %rpc_url,
        wallet_address = %wallet_address,
        bridge_contract = %bridge_address,
        usdc_contract = %usdc_address,
        chain_id = chain_id,
        port = port,
        "EVM Gateway service starting"
    );

    // 创建应用状态
    let state = AppState {
        bridge_contract,
        usdc_contract,
        wallet_address,
        tx_mutex: Arc::new(Mutex::new(())),
    };

    // 配置 CORS
    // 注意：当 allow_credentials(true) 时，不能使用 Any 作为 allow_headers
    // 必须明确指定允许的请求头
    let cors = CorsLayer::new()
        .allow_origin(allowed_origin.parse::<axum::http::HeaderValue>().unwrap())
        .allow_methods([axum::http::Method::GET, axum::http::Method::POST, axum::http::Method::OPTIONS])
        .allow_headers([
            HeaderName::from_static("content-type"),
            HeaderName::from_static("authorization"),
            HeaderName::from_static("accept"),
        ])
        .allow_credentials(true);
    
    info!(
        cors_origin = %allowed_origin,
        "CORS configured"
    );

    // 创建路由
    let app = Router::new()
        .route("/stake", post(handle_stake))
        .layer(cors)
        .with_state(state);

    // 启动服务器
    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port))
        .await
        .context("Failed to bind to address")?;

    info!(port = port, "EVM Gateway service listening");

    axum::serve(listener, app)
        .await
        .context("Server error")?;

    Ok(())
}

async fn handle_stake(
    State(state): State<AppState>,
    Json(req): Json<StakeRequest>,
) -> Result<Json<StakeResponse>, (StatusCode, Json<StakeResponse>)> {
    info!(
        target_address = %req.target_address,
        amount = %req.amount,
        "Received stake request"
    );
    

    match stake_to_1024chain(&state, &req.amount, &req.target_address).await {
        Ok(tx_hash) => {
            info!(
                tx_hash = %tx_hash,
                amount = %req.amount,
                target_address = %req.target_address,
                "Stake request completed successfully"
            );
            Ok(Json(StakeResponse {
                success: true,
                message: "Stake successful".to_string(),
                tx_hash: Some(tx_hash),
            }))
        }
        Err(e) => {
            error!(
                error = %e,
                amount = %req.amount,
                target_address = %req.target_address,
                "Stake request failed"
            );
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(StakeResponse {
                    success: false,
                    message: format!("Stake failed: {}", e),
                    tx_hash: None,
                }),
            ))
        }
    }
}

async fn stake_to_1024chain(
    state: &AppState,
    amount_str: &str,
    receiver_address: &str,
) -> Result<String> {
    // 解析金额（支持字符串格式的大数）
    let amount: U256 = amount_str
        .parse()
        .context("Failed to parse amount")?;

    // 验证 amount 不超过 uint64::MAX，因为事件中会转换为 uint64
    // uint64::MAX = 18,446,744,073,709,551,615
    const U64_MAX: u64 = u64::MAX;
    if amount > U256::from(U64_MAX) {
        return Err(anyhow::anyhow!(
            "Amount {} exceeds uint64::MAX ({})",
            amount,
            U64_MAX
        ));
    }

    // 使用 Mutex 序列化关键操作，避免并发问题：
    // 1. 余额检查竞态条件
    // 2. Nonce 冲突
    // 3. Approve 竞态条件
    let _guard = state.tx_mutex.lock().await;

    // 1. 检查 USDC 余额
    let balance: U256 = state
        .usdc_contract
        .method::<_, U256>("balanceOf", state.wallet_address)?
        .call()
        .await
        .context("Failed to check USDC balance")?;

    if balance < amount {
        error!(
            balance = %balance,
            required = %amount,
            "Insufficient USDC balance"
        );
        return Err(anyhow::anyhow!(
            "Insufficient USDC balance: have {}, need {}",
            balance,
            amount
        ));
    }

    // 2. 检查并授权 USDC
    let bridge_address = state.bridge_contract.address();
    let allowance: U256 = state
        .usdc_contract
        .method::<_, U256>("allowance", (state.wallet_address, bridge_address))?
        .call()
        .await
        .context("Failed to check USDC allowance")?;


    // 使用一个超大的数额进行 approve，避免频繁 approve 操作
    // U256::MAX 可能导致某些合约拒绝，使用一个足够大的固定值
    // 例如：10^12 USDC（假设 6 位小数，即 1,000,000 USDC）
    let max_approval_amount = U256::from(10_u64.pow(18)); // 10^18，足够大

    if allowance < amount {
        info!(
            allowance = %allowance,
            required = %amount,
            "Approving USDC - allowance insufficient"
        );
        let approve_method = state
            .usdc_contract
            .method::<_, bool>("approve", (bridge_address, max_approval_amount))
            .context("Failed to create approve method")?;
        
        let approve_tx = approve_method
            .send()
            .await
            .context("Failed to send approve transaction")?;

        let approve_receipt = approve_tx
            .await?
            .context("Failed to get approve receipt")?;

        info!(
            approve_tx_hash = %approve_receipt.transaction_hash,
            "USDC approved"
        );
    }

    // 3. 调用 stake 函数
    let receiver_addr = receiver_address.to_string();
    let method = state
        .bridge_contract
        .method::<_, u64>("stake", (amount, receiver_addr))
        .context("Failed to create stake method")?;
    
    let pending_tx = method
        .send()
        .await
        .context("Failed to send stake transaction")?;

    let stake_receipt = pending_tx
        .await?
        .context("Failed to get stake receipt")?;

    let tx_hash = format!("{:?}", stake_receipt.transaction_hash);

    // 验证事件中的amount是否正确（通过解析receipt中的事件）
    // 注意：这里我们只是记录，实际的验证由relayer完成
    info!(
        tx_hash = %tx_hash,
        amount = %amount,
        amount_u64 = %amount.as_u64(),
        receiver = %receiver_address,
        "Stake transaction confirmed"
    );

    Ok(tx_hash)
}

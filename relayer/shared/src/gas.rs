use crate::error::{RelayerError, Result};
use tracing::{error, info, warn};

/// Gas 管理器
#[derive(Debug, Clone)]
pub struct GasManager {
    pub min_svm_balance: f64,
    pub min_evm_balance: f64,
    pub check_interval: u64,
}

impl GasManager {
    pub fn new(min_svm_balance: f64, min_evm_balance: f64, check_interval: u64) -> Self {
        Self {
            min_svm_balance,
            min_evm_balance,
            check_interval,
        }
    }

    /// 检查 SVM 余额
    pub fn check_svm_balance(&self, balance_sol: f64) -> Result<()> {
        info!(balance_sol = balance_sol, "Checking SVM balance");

        if balance_sol < self.min_svm_balance {
            error!(
                balance = balance_sol,
                required = self.min_svm_balance,
                "Insufficient SVM balance"
            );
            return Err(RelayerError::InsufficientFunds(format!(
                "SVM balance {} SOL is below minimum {} SOL",
                balance_sol, self.min_svm_balance
            )));
        }

        // 警告阈值 (2倍最小值)
        let warning_threshold = self.min_svm_balance * 2.0;
        if balance_sol < warning_threshold {
            warn!(
                balance = balance_sol,
                threshold = warning_threshold,
                "Low SVM balance warning"
            );
        }

        Ok(())
    }

    /// 检查 EVM 余额
    pub fn check_evm_balance(&self, balance_eth: f64) -> Result<()> {
        info!(balance_eth = balance_eth, "Checking EVM balance");

        if balance_eth < self.min_evm_balance {
            error!(
                balance = balance_eth,
                required = self.min_evm_balance,
                "Insufficient EVM balance"
            );
            return Err(RelayerError::InsufficientFunds(format!(
                "EVM balance {} ETH is below minimum {} ETH",
                balance_eth, self.min_evm_balance
            )));
        }

        // 警告阈值 (2倍最小值)
        let warning_threshold = self.min_evm_balance * 2.0;
        if balance_eth < warning_threshold {
            warn!(
                balance = balance_eth,
                threshold = warning_threshold,
                "Low EVM balance warning"
            );
        }

        Ok(())
    }

    /// 启动余额监控任务
    pub fn start_balance_monitor<F>(&self, check_balance_fn: F) -> tokio::task::JoinHandle<()>
    where
        F: Fn() -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send>>
            + Send
            + 'static,
    {
        let interval = self.check_interval;
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(tokio::time::Duration::from_millis(interval)).await;
                if let Err(e) = check_balance_fn().await {
                    error!(error = %e, "Balance check failed");
                }
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_check_svm_balance_sufficient() {
        let manager = GasManager::new(5.0, 0.1, 300000);
        assert!(manager.check_svm_balance(10.0).is_ok());
    }

    #[test]
    fn test_check_svm_balance_insufficient() {
        let manager = GasManager::new(5.0, 0.1, 300000);
        assert!(manager.check_svm_balance(3.0).is_err());
    }

    #[test]
    fn test_check_evm_balance_sufficient() {
        let manager = GasManager::new(5.0, 0.1, 300000);
        assert!(manager.check_evm_balance(0.5).is_ok());
    }

    #[test]
    fn test_check_evm_balance_insufficient() {
        let manager = GasManager::new(5.0, 0.1, 300000);
        assert!(manager.check_evm_balance(0.05).is_err());
    }
}


use crate::error::{RelayerError, Result};
use std::time::Duration;
use tokio::time::sleep;
use tracing::warn;

/// 重试策略
#[derive(Debug, Clone)]
pub struct RetryStrategy {
    pub max_retries: u32,
    pub delays: Vec<u64>, // milliseconds
}

impl Default for RetryStrategy {
    fn default() -> Self {
        Self {
            max_retries: 5,
            delays: vec![0, 30000, 60000, 120000, 300000], // 0s, 30s, 1m, 2m, 5m
        }
    }
}

impl RetryStrategy {
    /// 执行带重试的异步操作
    pub async fn retry<F, Fut, T>(&self, mut operation: F) -> Result<T>
    where
        F: FnMut() -> Fut,
        Fut: std::future::Future<Output = Result<T>>,
    {
        let mut last_error = None;

        for attempt in 0..self.max_retries {
            match operation().await {
                Ok(result) => return Ok(result),
                Err(err) => {
                    // 检查是否可重试
                    if !err.is_retryable() {
                        return Err(err);
                    }

                    last_error = Some(err);

                    // 如果不是最后一次尝试，等待后重试
                    if attempt < self.max_retries - 1 {
                        let delay_ms = self.delays.get(attempt as usize).copied().unwrap_or(300000);
                        warn!(
                            attempt = attempt + 1,
                            max_retries = self.max_retries,
                            delay_ms = delay_ms,
                            error = ?last_error,
                            "Retrying after error"
                        );
                        sleep(Duration::from_millis(delay_ms)).await;
                    }
                }
            }
        }

        Err(last_error.unwrap_or_else(|| {
            RelayerError::Internal("Retry failed without error".to_string())
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_retry_success() {
        let strategy = RetryStrategy {
            max_retries: 3,
            delays: vec![0, 10, 20],
        };

        let mut attempts = 0;
        let result = strategy
            .retry(|| async {
                attempts += 1;
                if attempts < 3 {
                    Err(RelayerError::RpcTimeout)
                } else {
                    Ok(42)
                }
            })
            .await;

        assert_eq!(result.unwrap(), 42);
        assert_eq!(attempts, 3);
    }

    #[tokio::test]
    async fn test_retry_non_retryable() {
        let strategy = RetryStrategy {
            max_retries: 3,
            delays: vec![0, 10, 20],
        };

        let mut attempts = 0;
        let result: Result<i32> = strategy
            .retry(|| async {
                attempts += 1;
                Err(RelayerError::NotWhitelisted)
            })
            .await;

        assert!(result.is_err());
        assert_eq!(attempts, 1); // Should fail immediately
    }
}


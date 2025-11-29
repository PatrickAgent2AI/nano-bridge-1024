import { RateLimiterMemory } from 'rate-limiter-flexible';
import PQueue from 'p-queue';

// LiFi API 速率限制器
// 已认证用户：每分钟 200 个请求
// 未认证用户：每两小时 200 个请求
export const createRateLimiter = (hasApiKey: boolean) => {
  if (hasApiKey) {
    // 已认证：每分钟 200 个请求
    return new RateLimiterMemory({
      points: 200,
      duration: 60, // 60 秒
    });
  } else {
    // 未认证：每两小时 200 个请求
    return new RateLimiterMemory({
      points: 200,
      duration: 7200, // 7200 秒 = 2 小时
    });
  }
};

// 创建请求队列（限制并发数量）
export const createRequestQueue = (concurrency: number = 5) => {
  return new PQueue({ concurrency });
};

// 简单的 Mutex 实现（用于序列化交易发送）
export class Mutex {
  private locked = false;
  private queue: Array<() => void> = [];

  async acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      if (!this.locked) {
        this.locked = true;
        resolve(() => this.release());
      } else {
        this.queue.push(() => {
          this.locked = true;
          resolve(() => this.release());
        });
      }
    });
  }

  private release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) next();
    } else {
      this.locked = false;
    }
  }
}


# S2E Relayer 配置说明

## 问题：私钥未配置

如果看到错误 "Failed to decode private key" 或 "Invalid private key: appears to be a placeholder"，
说明 `RELAYER__ECDSA_PRIVATE_KEY` 未正确配置。

## 解决方案

### 1. 生成 ECDSA 私钥

```bash
# 方法1：使用 openssl
openssl rand -hex 32

# 方法2：使用 Node.js
node -e "console.log('0x' + require('crypto').randomBytes(32).toString('hex'))"
```

### 2. 配置私钥

编辑 `relayer/s2e/.env` 文件，设置：

```bash
RELAYER__ECDSA_PRIVATE_KEY=0x<生成的64字符十六进制字符串>
```

例如：
```bash
RELAYER__ECDSA_PRIVATE_KEY=0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef
```

### 3. 注意事项

- 私钥必须是 64 个十六进制字符（32 字节）
- 可以带 `0x` 前缀，也可以不带
- 请妥善保管私钥，不要提交到版本控制系统
- 这个私钥将用于：
  - 签名事件数据（提交到 EVM）
  - 支付 EVM 链的 gas 费

### 4. 验证配置

运行 relayer 后，应该看到：
```
SVM event listener initialized (using HTTP RPC)
```

而不是错误信息。

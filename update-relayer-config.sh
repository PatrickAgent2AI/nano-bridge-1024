#!/bin/bash
set -e

# 新程序ID
NEW_PROGRAM_ID="BvYhYzzQerwUkX15zQJv5vuDiwR71daF1Z1ChPMnhQMt"

# 更新 relayer 配置
echo "更新 Relayer 配置..."

# 更新 e2s-submitter 的环境变量
if [ -f "relayer/e2s-submitter/.env" ]; then
    sed -i "s/SVM_PROGRAM_ID=.*/SVM_PROGRAM_ID=$NEW_PROGRAM_ID/" relayer/e2s-submitter/.env
    echo "✓ 已更新 e2s-submitter/.env"
fi

# 更新 .env.invoke
if grep -q "^SVM_PROGRAM_ID=" ".env.invoke"; then
    sed -i "s|^SVM_PROGRAM_ID=.*|SVM_PROGRAM_ID=${NEW_PROGRAM_ID}|g" ".env.invoke"
    echo "✓ 已更新 .env.invoke"
fi

echo ""
echo "✅ 配置更新完成！"
echo ""
echo "新程序ID: $NEW_PROGRAM_ID"
echo ""
echo "下一步："
echo "  1. cd relayer/e2s-submitter"
echo "  2. cargo run"
echo "  (Relayer 将使用新的程序ID处理事件)"

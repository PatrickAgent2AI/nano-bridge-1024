#! /bin/bash

SCRIPT_DIR=$(dirname "$0")

cd "$SCRIPT_DIR"

# ./01-deploy-evm.sh
# ./02-deploy-svm.sh
# ./03-config-usdc-peer.sh

# timeout 10s npx ts-node svm-admin.ts add_relayer DzuaqLKyD1hNLUL5gQLDumU3yJb2vDT7UT2PRxDPRVkX
# timeout 10s npx ts-node svm-admin.ts add_relayer AhRB2W2wPEHUqWBZbtt3jHnyJ18iku2eCygTBuE6WFri
# timeout 10s npx ts-node svm-admin.ts add_relayer 31tdr68GNJDyq8F8V32JqSao2HNDp4nN4PSG1HCQk5v6

# npx ts-node evm-admin.ts add_relayer 0x45F36969E162E741fB4aFc3fd10ca01cFd5B3D73
# npx ts-node evm-admin.ts add_relayer 0x774EC3Fbb0509103b113505d01D5d6f8f1F58903
# npx ts-node evm-admin.ts add_relayer 0x24380449b3311EE8ACdD71B4a350489eA10B9662

# npx ts-node svm-admin.ts add_liquidity 100000000
# npx ts-node evm-admin.ts add_liquidity 1000

# 调用 svm-user.ts balance 脚本并解析 USDC Balance (最小单位)
USDC_RAW_AMOUNT_BEFORE=$(npx ts-node svm-user.ts balance | awk -F': ' '/USDC Balance \(最小单位\)/ {gsub(/\r/,"",$2); print $2}' | tr -d ' ')
echo "USDC Balance (raw amount) before: $USDC_RAW_AMOUNT_BEFORE"


npx ts-node evm-user.ts stake 89730  3VhnTppDywZUc1ti4DpfiaAH1Wit67yz6iofi9eCYHTn

USDC_RAW_AMOUNT_AFTER=$(npx ts-node svm-user.ts balance | awk -F': ' '/USDC Balance \(最小单位\)/ {gsub(/\r/,"",$2); print $2}' | tr -d ' ')
echo "USDC Balance (raw amount) after: $USDC_RAW_AMOUNT_AFTER"

USDC_DIFFERENCE=$((USDC_RAW_AMOUNT_AFTER - USDC_RAW_AMOUNT_BEFORE))

echo "USDC Balance (raw amount) difference: $USDC_DIFFERENCE"

if [ "$USDC_DIFFERENCE" -ne 89730 ]; then
    echo "USDC Balance (raw amount) difference is not correct"
    exit 1
fi
USDC_RAW_AMOUNT_BEFORE=$USDC_RAW_AMOUNT_AFTER

cd ../gateway/evm-gateway-service
./gateway-cli.sh stake 89730 3VhnTppDywZUc1ti4DpfiaAH1Wit67yz6iofi9eCYHTn

USDC_RAW_AMOUNT_AFTER=$(npx ts-node svm-user.ts balance | awk -F': ' '/USDC Balance \(最小单位\)/ {gsub(/\r/,"",$2); print $2}' | tr -d ' ')
echo "USDC Balance (raw amount) after: $USDC_RAW_AMOUNT_AFTER"

USDC_DIFFERENCE=$((USDC_RAW_AMOUNT_AFTER - USDC_RAW_AMOUNT_BEFORE))

echo "USDC Balance (raw amount) difference: $USDC_DIFFERENCE"

if [ "$USDC_DIFFERENCE" -ne 89730 ]; then
    echo "USDC Balance (raw amount) difference is not correct"
    exit 1
fi

echo "USDC Balance (raw amount) difference is correct"
exit 0
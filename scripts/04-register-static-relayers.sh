#!/bin/bash


timeout 10s npx ts-node svm-admin.ts add_relayer DzuaqLKyD1hNLUL5gQLDumU3yJb2vDT7UT2PRxDPRVkX
timeout 10s npx ts-node svm-admin.ts add_relayer AhRB2W2wPEHUqWBZbtt3jHnyJ18iku2eCygTBuE6WFri
timeout 10s npx ts-node svm-admin.ts add_relayer 31tdr68GNJDyq8F8V32JqSao2HNDp4nN4PSG1HCQk5v6

npx ts-node evm-admin.ts add_relayer 0x45F36969E162E741fB4aFc3fd10ca01cFd5B3D73
npx ts-node evm-admin.ts add_relayer 0x774EC3Fbb0509103b113505d01D5d6f8f1F58903
npx ts-node evm-admin.ts add_relayer 0x24380449b3311EE8ACdD71B4a350489eA10B9662

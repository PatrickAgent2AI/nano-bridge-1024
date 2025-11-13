import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Bridge1024 } from "../target/types/bridge1024";
import { expect } from "chai";
import * as crypto from "crypto";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createMint, createAccount, mintTo } from "@solana/spl-token";
import BN from "bn.js";

describe("bridge1024", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Bridge1024 as Program<Bridge1024>;

  const SOURCE_CHAIN_ID = new BN(421614);
  const TARGET_CHAIN_ID = new BN(91024);
  const TEST_AMOUNT = new BN(100_000000);
  const AIRDROP_AMOUNT = 10 * LAMPORTS_PER_SOL;
  const MAX_RELAYERS = 18;
  const MIN_THRESHOLD = 2;
  const MAX_THRESHOLD = 13;

  let admin: Keypair;
  let vault: Keypair;
  let user1: Keypair;
  let user2: Keypair;
  let relayer1: Keypair;
  let relayer2: Keypair;
  let relayer3: Keypair;
  let nonRelayer: Keypair;
  let nonAdmin: Keypair;
  let usdcMint: PublicKey;
  let senderState: PublicKey;
  let receiverState: PublicKey;
  let peerContract: Keypair;
  let user1TokenAccount: PublicKey;
  let vaultTokenAccount: PublicKey;

  interface StakeEventData {
    sourceContract: PublicKey;
    targetContract: PublicKey;
    chainId: BN;
    blockHeight: BN;
    amount: BN;
    receiverAddress: string;
    nonce: BN;
  }

  function generateECDSAKeypair() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
      namedCurve: "secp256k1",
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    return { publicKey, privateKey };
  }

  function hashEventData(eventData: StakeEventData): Buffer {
    const dataString = JSON.stringify({
      sourceContract: eventData.sourceContract.toBase58(),
      targetContract: eventData.targetContract.toBase58(),
      chainId: eventData.chainId.toString(),
      blockHeight: eventData.blockHeight.toString(),
      amount: eventData.amount.toString(),
      receiverAddress: eventData.receiverAddress,
      nonce: eventData.nonce.toString(),
    });
    return crypto.createHash("sha256").update(dataString).digest();
  }

  function generateSignature(eventData: StakeEventData, privateKey: string): Buffer {
    const hash = hashEventData(eventData);
    const sign = crypto.createSign("SHA256");
    sign.update(hash);
    return sign.sign(privateKey);
  }

  function verifySignature(eventData: StakeEventData, signature: Buffer, publicKey: string): boolean {
    const hash = hashEventData(eventData);
    const verify = crypto.createVerify("SHA256");
    verify.update(hash);
    return verify.verify(publicKey, signature);
  }

  function calculateThreshold(relayerCount: number): number {
    return Math.ceil(relayerCount * 2 / 3);
  }

  async function getStakeAccounts(user: Keypair) {
    const userTokenAccount = await getAssociatedTokenAddress(
      usdcMint,
      user.publicKey
    );
    return {
      user: user.publicKey,
      senderState: senderState,
      vault: vault.publicKey,
      usdcMint: usdcMint,
      userTokenAccount: userTokenAccount,
      vaultTokenAccount: vaultTokenAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    };
  }

  before(async () => {
    admin = Keypair.generate();
    vault = Keypair.generate();
    user1 = Keypair.generate();
    user2 = Keypair.generate();
    relayer1 = Keypair.generate();
    relayer2 = Keypair.generate();
    relayer3 = Keypair.generate();
    nonRelayer = Keypair.generate();
    nonAdmin = Keypair.generate();
    peerContract = Keypair.generate();

    const airdropAmount = AIRDROP_AMOUNT;
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(admin.publicKey, airdropAmount),
      "confirmed"
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(vault.publicKey, airdropAmount),
      "confirmed"
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(user1.publicKey, airdropAmount),
      "confirmed"
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(user2.publicKey, airdropAmount),
      "confirmed"
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(relayer1.publicKey, airdropAmount),
      "confirmed"
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(relayer2.publicKey, airdropAmount),
      "confirmed"
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(relayer3.publicKey, airdropAmount),
      "confirmed"
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(nonRelayer.publicKey, airdropAmount),
      "confirmed"
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(nonAdmin.publicKey, airdropAmount),
      "confirmed"
    );

    const [senderStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("sender_state")],
      program.programId
    );
    senderState = senderStatePda;

    const [receiverStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("receiver_state")],
      program.programId
    );
    receiverState = receiverStatePda;

    // Create USDC mint
    usdcMint = await createMint(
      provider.connection,
      admin,
      admin.publicKey,
      null,
      6 // 6 decimals for USDC
    );

    // Create token accounts
    user1TokenAccount = await getAssociatedTokenAddress(
      usdcMint,
      user1.publicKey
    );
    vaultTokenAccount = await getAssociatedTokenAddress(
      usdcMint,
      vault.publicKey
    );

    // Create token accounts if they don't exist
    try {
      await createAccount(
        provider.connection,
        user1,
        usdcMint,
        user1.publicKey
      );
    } catch (e) {
      // Account might already exist
    }

    try {
      await createAccount(
        provider.connection,
        vault,
        usdcMint,
        vault.publicKey
      );
    } catch (e) {
      // Account might already exist
    }

    // Mint tokens to user1
    await mintTo(
      provider.connection,
      admin,
      usdcMint,
      user1TokenAccount,
      admin,
      1000000_000000 // 1,000,000 USDC with 6 decimals
    );
  });

  describe("Unified Contract Tests", () => {
    describe("TC-001: 统一初始化合约", () => {
      it("should initialize both sender and receiver contracts", async () => {
        await program.methods
          .initialize()
          .accounts({
            admin: admin.publicKey,
            vault: vault.publicKey,
            senderState: senderState,
            receiverState: receiverState,
            systemProgram: SystemProgram.programId,
          })
          .signers([admin])
          .rpc();

        const senderStateAccount = await program.account.senderState.fetch(senderState);
        const receiverStateAccount = await program.account.receiverState.fetch(receiverState);

        expect(senderStateAccount.vault.toBase58()).to.equal(vault.publicKey.toBase58());
        expect(senderStateAccount.admin.toBase58()).to.equal(admin.publicKey.toBase58());
        expect(senderStateAccount.nonce.toNumber()).to.equal(0);
        expect(receiverStateAccount.vault.toBase58()).to.equal(vault.publicKey.toBase58());
        expect(receiverStateAccount.admin.toBase58()).to.equal(admin.publicKey.toBase58());
        expect(receiverStateAccount.lastNonce.toNumber()).to.equal(0);
        expect(receiverStateAccount.relayerCount.toNumber()).to.equal(0);
      });
    });

    describe("TC-002: 配置USDC代币地址", () => {
      it("should configure USDC token address", async () => {
        await program.methods
          .configureUsdc(usdcMint)
          .accounts({
            admin: admin.publicKey,
            senderState: senderState,
            receiverState: receiverState,
          })
          .signers([admin])
          .rpc();

        const senderStateAccount = await program.account.senderState.fetch(senderState);
        const receiverStateAccount = await program.account.receiverState.fetch(receiverState);

        expect(senderStateAccount.usdcMint.toBase58()).to.equal(usdcMint.toBase58());
        expect(receiverStateAccount.usdcMint.toBase58()).to.equal(usdcMint.toBase58());
      });
    });

    describe("TC-003: 统一对端配置", () => {
      it("should configure peer contract and chain IDs", async () => {
        await program.methods
          .configurePeer(peerContract.publicKey, SOURCE_CHAIN_ID, TARGET_CHAIN_ID)
          .accounts({
            admin: admin.publicKey,
            senderState: senderState,
            receiverState: receiverState,
          })
          .signers([admin])
          .rpc();

        const senderStateAccount = await program.account.senderState.fetch(senderState);
        const receiverStateAccount = await program.account.receiverState.fetch(receiverState);

        expect(senderStateAccount.targetContract.toBase58()).to.equal(peerContract.publicKey.toBase58());
        expect(senderStateAccount.sourceChainId.toString()).to.equal(SOURCE_CHAIN_ID.toString());
        expect(senderStateAccount.targetChainId.toString()).to.equal(TARGET_CHAIN_ID.toString());
        expect(receiverStateAccount.sourceContract.toBase58()).to.equal(peerContract.publicKey.toBase58());
        expect(receiverStateAccount.sourceChainId.toString()).to.equal(SOURCE_CHAIN_ID.toString());
        expect(receiverStateAccount.targetChainId.toString()).to.equal(TARGET_CHAIN_ID.toString());
      });

      it("should reject non-admin configuration", async () => {
        try {
          await program.methods
            .configurePeer(peerContract.publicKey, SOURCE_CHAIN_ID, TARGET_CHAIN_ID)
            .accounts({
              admin: nonAdmin.publicKey,
              senderState: senderState,
              receiverState: receiverState,
            })
            .signers([nonAdmin])
            .rpc();
          expect.fail("Should have thrown an error");
        } catch (err) {
          expect(err).to.exist;
        }
      });
    });
  });

  describe("Sender Contract Tests", () => {
    describe("TC-004: 质押功能 - 成功场景", () => {
      it("should successfully stake USDC", async () => {
        // First configure USDC
        await program.methods
          .configureUsdc(usdcMint)
          .accounts({
            admin: admin.publicKey,
            senderState: senderState,
            receiverState: receiverState,
          })
          .signers([admin])
          .rpc();

        const receiverAddress = user2.publicKey.toBase58();
        const initialNonce = (await program.account.senderState.fetch(senderState)).nonce;

        const accounts = await getStakeAccounts(user1);
        await program.methods
          .stake(TEST_AMOUNT, receiverAddress)
          .accounts(accounts)
          .signers([user1])
          .rpc();

        const senderStateAccount = await program.account.senderState.fetch(senderState);
        expect(senderStateAccount.nonce.toNumber()).to.equal(initialNonce.toNumber() + 1);
      });
    });

    describe("TC-005: 质押功能 - 余额不足", () => {
      it.skip("should reject stake when balance is insufficient", async () => {
        const largeAmount = new BN(1000000_000000);
        const receiverAddress = user2.publicKey.toBase58();

        try {
          await program.methods
            .stake(largeAmount, receiverAddress)
            .accounts({
              user: user1.publicKey,
              senderState: senderState,
              vault: vault.publicKey,
              usdcMint: usdcMint.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([user1])
            .rpc();
          expect.fail("Should have thrown an error");
        } catch (err) {
          expect(err).to.exist;
        }
      });
    });

    describe("TC-006: 质押功能 - 未授权", () => {
      it.skip("should reject stake when not authorized", async () => {
        const receiverAddress = user2.publicKey.toBase58();

        try {
          await program.methods
            .stake(TEST_AMOUNT, receiverAddress)
            .accounts({
              user: user1.publicKey,
              senderState: senderState,
              vault: vault.publicKey,
              usdcMint: usdcMint.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([user1])
            .rpc();
          expect.fail("Should have thrown an error");
        } catch (err) {
          expect(err).to.exist;
        }
      });
    });

    describe("TC-007: 质押功能 - USDC地址未配置", () => {
      it.skip("should reject stake when USDC address is not configured", async () => {
        const receiverAddress = user2.publicKey.toBase58();

        try {
          await program.methods
            .stake(TEST_AMOUNT, receiverAddress)
            .accounts({
              user: user1.publicKey,
              senderState: senderState,
              vault: vault.publicKey,
              usdcMint: usdcMint.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([user1])
            .rpc();
          expect.fail("Should have thrown an error");
        } catch (err) {
          expect(err).to.exist;
        }
      });
    });

    describe("TC-008: 质押事件完整性", () => {
      it.skip("should emit complete stake event", async () => {
        const receiverAddress = user2.publicKey.toBase58();

        await program.methods
          .stake(TEST_AMOUNT, receiverAddress)
          .accounts({
            user: user1.publicKey,
            senderState: senderState,
            vault: vault.publicKey,
            usdcMint: usdcMint.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([user1])
          .rpc();

        const senderStateAccount = await program.account.senderState.fetch(senderState);
        expect(senderStateAccount.nonce.toNumber()).to.be.greaterThan(0);
      });
    });
  });

  describe("Receiver Contract Tests", () => {
    describe("TC-101: 添加 Relayer - 管理员权限", () => {
      it.skip("should add relayer with ECDSA public key", async () => {
        const relayer1Keypair = generateECDSAKeypair();
        const relayer2Keypair = generateECDSAKeypair();
        const relayer3Keypair = generateECDSAKeypair();

        await program.methods
          .addRelayer(relayer1.publicKey, Buffer.from(relayer1Keypair.publicKey))
          .accounts({
            admin: admin.publicKey,
            receiverState: receiverState,
            systemProgram: SystemProgram.programId,
          })
          .signers([admin])
          .rpc();

        await program.methods
          .addRelayer(relayer2.publicKey, Buffer.from(relayer2Keypair.publicKey))
          .accounts({
            admin: admin.publicKey,
            receiverState: receiverState,
            systemProgram: SystemProgram.programId,
          })
          .signers([admin])
          .rpc();

        await program.methods
          .addRelayer(relayer3.publicKey, Buffer.from(relayer3Keypair.publicKey))
          .accounts({
            admin: admin.publicKey,
            receiverState: receiverState,
            systemProgram: SystemProgram.programId,
          })
          .signers([admin])
          .rpc();

        const receiverStateAccount = await program.account.receiverState.fetch(receiverState);
        expect(receiverStateAccount.relayerCount.toNumber()).to.equal(3);
      });
    });

    describe("TC-102: 移除 Relayer - 管理员权限", () => {
      it.skip("should remove relayer and ECDSA public key", async () => {
        await program.methods
          .removeRelayer(relayer1.publicKey)
          .accounts({
            admin: admin.publicKey,
            receiverState: receiverState,
            systemProgram: SystemProgram.programId,
          })
          .signers([admin])
          .rpc();

        const receiverStateAccount = await program.account.receiverState.fetch(receiverState);
        expect(receiverStateAccount.relayerCount.toNumber()).to.equal(2);
      });
    });

    describe("TC-103: 添加/移除 Relayer - 非管理员权限", () => {
      it.skip("should reject non-admin add relayer", async () => {
        const relayerKeypair = generateECDSAKeypair();

        try {
          await program.methods
            .addRelayer(nonRelayer.publicKey, Buffer.from(relayerKeypair.publicKey))
            .accounts({
              admin: nonAdmin.publicKey,
              receiverState: receiverState,
              systemProgram: SystemProgram.programId,
            })
            .signers([nonAdmin])
            .rpc();
          expect.fail("Should have thrown an error");
        } catch (err) {
          expect(err).to.exist;
        }
      });

      it.skip("should reject non-admin remove relayer", async () => {
        try {
          await program.methods
            .removeRelayer(relayer1.publicKey)
            .accounts({
              admin: nonAdmin.publicKey,
              receiverState: receiverState,
              systemProgram: SystemProgram.programId,
            })
            .signers([nonAdmin])
            .rpc();
          expect.fail("Should have thrown an error");
        } catch (err) {
          expect(err).to.exist;
        }
      });
    });

    describe("TC-104: 提交签名 - 单个 Relayer（未达到阈值）", () => {
      it.skip("should accept signature but not unlock when threshold not reached", async () => {
        const eventData: StakeEventData = {
          sourceContract: peerContract.publicKey,
          targetContract: receiverState,
          chainId: SOURCE_CHAIN_ID,
          blockHeight: new BN(1000),
          amount: TEST_AMOUNT,
          receiverAddress: user2.publicKey.toBase58(),
          nonce: new BN(1),
        };

        const relayer1Keypair = generateECDSAKeypair();
        const signature = generateSignature(eventData, relayer1Keypair.privateKey);

        await program.methods
          .submitSignature(
            eventData.sourceContract,
            eventData.targetContract,
            eventData.chainId,
            eventData.blockHeight,
            eventData.amount,
            eventData.receiverAddress,
            eventData.nonce,
            Buffer.from(signature)
          )
          .accounts({
            relayer: relayer1.publicKey,
            receiverState: receiverState,
            vault: vault.publicKey,
            usdcMint: usdcMint.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([relayer1])
          .rpc();

        const receiverStateAccount = await program.account.receiverState.fetch(receiverState);
        expect(receiverStateAccount.lastNonce.toNumber()).to.equal(0);
      });
    });

    describe("TC-105: 提交签名 - 达到阈值并解锁", () => {
      it.skip("should unlock when threshold is reached", async () => {
        const eventData: StakeEventData = {
          sourceContract: peerContract.publicKey,
          targetContract: receiverState,
          chainId: SOURCE_CHAIN_ID,
          blockHeight: new BN(1001),
          amount: TEST_AMOUNT,
          receiverAddress: user2.publicKey.toBase58(),
          nonce: new BN(2),
        };

        const relayer1Keypair = generateECDSAKeypair();
        const relayer2Keypair = generateECDSAKeypair();

        const signature1 = generateSignature(eventData, relayer1Keypair.privateKey);
        const signature2 = generateSignature(eventData, relayer2Keypair.privateKey);

        await program.methods
          .submitSignature(
            eventData.sourceContract,
            eventData.targetContract,
            eventData.chainId,
            eventData.blockHeight,
            eventData.amount,
            eventData.receiverAddress,
            eventData.nonce,
            Buffer.from(signature1)
          )
          .accounts({
            relayer: relayer1.publicKey,
            receiverState: receiverState,
            vault: vault.publicKey,
            usdcMint: usdcMint.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([relayer1])
          .rpc();

        await program.methods
          .submitSignature(
            eventData.sourceContract,
            eventData.targetContract,
            eventData.chainId,
            eventData.blockHeight,
            eventData.amount,
            eventData.receiverAddress,
            eventData.nonce,
            Buffer.from(signature2)
          )
          .accounts({
            relayer: relayer2.publicKey,
            receiverState: receiverState,
            vault: vault.publicKey,
            usdcMint: usdcMint.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([relayer2])
          .rpc();

        const receiverStateAccount = await program.account.receiverState.fetch(receiverState);
        expect(receiverStateAccount.lastNonce.toNumber()).to.equal(2);
      });
    });

    describe("TC-106: 提交签名 - Nonce递增判断（重放攻击防御）", () => {
      it.skip("should reject same nonce (replay attack)", async () => {
        const eventData: StakeEventData = {
          sourceContract: peerContract.publicKey,
          targetContract: receiverState,
          chainId: SOURCE_CHAIN_ID,
          blockHeight: new BN(1002),
          amount: TEST_AMOUNT,
          receiverAddress: user2.publicKey.toBase58(),
          nonce: new BN(2),
        };

        const relayer1Keypair = generateECDSAKeypair();
        const signature = generateSignature(eventData, relayer1Keypair.privateKey);

        try {
          await program.methods
            .submitSignature(
              eventData.sourceContract,
              eventData.targetContract,
              eventData.chainId,
              eventData.blockHeight,
              eventData.amount,
              eventData.receiverAddress,
              eventData.nonce,
              Buffer.from(signature)
            )
            .accounts({
              relayer: relayer1.publicKey,
              receiverState: receiverState,
              vault: vault.publicKey,
              usdcMint: usdcMint.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([relayer1])
            .rpc();
          expect.fail("Should have thrown an error");
        } catch (err) {
          expect(err).to.exist;
        }
      });

      it.skip("should reject smaller nonce (replay attack)", async () => {
        const eventData: StakeEventData = {
          sourceContract: peerContract.publicKey,
          targetContract: receiverState,
          chainId: SOURCE_CHAIN_ID,
          blockHeight: new BN(1003),
          amount: TEST_AMOUNT,
          receiverAddress: user2.publicKey.toBase58(),
          nonce: new BN(1),
        };

        const relayer1Keypair = generateECDSAKeypair();
        const signature = generateSignature(eventData, relayer1Keypair.privateKey);

        try {
          await program.methods
            .submitSignature(
              eventData.sourceContract,
              eventData.targetContract,
              eventData.chainId,
              eventData.blockHeight,
              eventData.amount,
              eventData.receiverAddress,
              eventData.nonce,
              Buffer.from(signature)
            )
            .accounts({
              relayer: relayer1.publicKey,
              receiverState: receiverState,
              vault: vault.publicKey,
              usdcMint: usdcMint.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([relayer1])
            .rpc();
          expect.fail("Should have thrown an error");
        } catch (err) {
          expect(err).to.exist;
        }
      });

      it.skip("should accept larger nonce (normal case)", async () => {
        const eventData: StakeEventData = {
          sourceContract: peerContract.publicKey,
          targetContract: receiverState,
          chainId: SOURCE_CHAIN_ID,
          blockHeight: new BN(1004),
          amount: TEST_AMOUNT,
          receiverAddress: user2.publicKey.toBase58(),
          nonce: new BN(3),
        };

        const relayer1Keypair = generateECDSAKeypair();
        const signature = generateSignature(eventData, relayer1Keypair.privateKey);

        await program.methods
          .submitSignature(
            eventData.sourceContract,
            eventData.targetContract,
            eventData.chainId,
            eventData.blockHeight,
            eventData.amount,
            eventData.receiverAddress,
            eventData.nonce,
            Buffer.from(signature)
          )
          .accounts({
            relayer: relayer1.publicKey,
            receiverState: receiverState,
            vault: vault.publicKey,
            usdcMint: usdcMint.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([relayer1])
          .rpc();
      });
    });

    describe("TC-107: 提交签名 - 无效签名", () => {
      it.skip("should reject invalid signature", async () => {
        const eventData: StakeEventData = {
          sourceContract: peerContract.publicKey,
          targetContract: receiverState,
          chainId: SOURCE_CHAIN_ID,
          blockHeight: new BN(1005),
          amount: TEST_AMOUNT,
          receiverAddress: user2.publicKey.toBase58(),
          nonce: new BN(4),
        };

        const wrongKeypair = generateECDSAKeypair();
        const signature = generateSignature(eventData, wrongKeypair.privateKey);

        try {
          await program.methods
            .submitSignature(
              eventData.sourceContract,
              eventData.targetContract,
              eventData.chainId,
              eventData.blockHeight,
              eventData.amount,
              eventData.receiverAddress,
              eventData.nonce,
              Buffer.from(signature)
            )
            .accounts({
              relayer: relayer1.publicKey,
              receiverState: receiverState,
              vault: vault.publicKey,
              usdcMint: usdcMint.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([relayer1])
            .rpc();
          expect.fail("Should have thrown an error");
        } catch (err) {
          expect(err).to.exist;
        }
      });
    });

    describe("TC-108: 提交签名 - 非白名单 Relayer", () => {
      it.skip("should reject non-whitelisted relayer", async () => {
        const eventData: StakeEventData = {
          sourceContract: peerContract.publicKey,
          targetContract: receiverState,
          chainId: SOURCE_CHAIN_ID,
          blockHeight: new BN(1006),
          amount: TEST_AMOUNT,
          receiverAddress: user2.publicKey.toBase58(),
          nonce: new BN(5),
        };

        const nonRelayerKeypair = generateECDSAKeypair();
        const signature = generateSignature(eventData, nonRelayerKeypair.privateKey);

        try {
          await program.methods
            .submitSignature(
              eventData.sourceContract,
              eventData.targetContract,
              eventData.chainId,
              eventData.blockHeight,
              eventData.amount,
              eventData.receiverAddress,
              eventData.nonce,
              Buffer.from(signature)
            )
            .accounts({
              relayer: nonRelayer.publicKey,
              receiverState: receiverState,
              vault: vault.publicKey,
              usdcMint: usdcMint.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([nonRelayer])
            .rpc();
          expect.fail("Should have thrown an error");
        } catch (err) {
          expect(err).to.exist;
        }
      });
    });

    describe("TC-109: 提交签名 - USDC地址未配置", () => {
      it.skip("should reject when USDC address is not configured", async () => {
        const eventData: StakeEventData = {
          sourceContract: peerContract.publicKey,
          targetContract: receiverState,
          chainId: SOURCE_CHAIN_ID,
          blockHeight: new BN(1007),
          amount: TEST_AMOUNT,
          receiverAddress: user2.publicKey.toBase58(),
          nonce: new BN(6),
        };

        const relayer1Keypair = generateECDSAKeypair();
        const signature = generateSignature(eventData, relayer1Keypair.privateKey);

        try {
          await program.methods
            .submitSignature(
              eventData.sourceContract,
              eventData.targetContract,
              eventData.chainId,
              eventData.blockHeight,
              eventData.amount,
              eventData.receiverAddress,
              eventData.nonce,
              Buffer.from(signature)
            )
            .accounts({
              relayer: relayer1.publicKey,
              receiverState: receiverState,
              vault: vault.publicKey,
              usdcMint: usdcMint.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([relayer1])
            .rpc();
          expect.fail("Should have thrown an error");
        } catch (err) {
          expect(err).to.exist;
        }
      });
    });

    describe("TC-110: 提交签名 - 错误的源链合约地址", () => {
      it.skip("should reject wrong source contract address", async () => {
        const wrongSourceContract = Keypair.generate();
        const eventData: StakeEventData = {
          sourceContract: wrongSourceContract.publicKey,
          targetContract: receiverState,
          chainId: SOURCE_CHAIN_ID,
          blockHeight: new BN(1008),
          amount: TEST_AMOUNT,
          receiverAddress: user2.publicKey.toBase58(),
          nonce: new BN(7),
        };

        const relayer1Keypair = generateECDSAKeypair();
        const signature = generateSignature(eventData, relayer1Keypair.privateKey);

        try {
          await program.methods
            .submitSignature(
              eventData.sourceContract,
              eventData.targetContract,
              eventData.chainId,
              eventData.blockHeight,
              eventData.amount,
              eventData.receiverAddress,
              eventData.nonce,
              Buffer.from(signature)
            )
            .accounts({
              relayer: relayer1.publicKey,
              receiverState: receiverState,
              vault: vault.publicKey,
              usdcMint: usdcMint.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([relayer1])
            .rpc();
          expect.fail("Should have thrown an error");
        } catch (err) {
          expect(err).to.exist;
        }
      });
    });

    describe("TC-111: 提交签名 - 错误的 Chain ID", () => {
      it.skip("should reject wrong chain ID", async () => {
        const wrongChainId = new BN(999999);
        const eventData: StakeEventData = {
          sourceContract: peerContract.publicKey,
          targetContract: receiverState,
          chainId: wrongChainId,
          blockHeight: new BN(1009),
          amount: TEST_AMOUNT,
          receiverAddress: user2.publicKey.toBase58(),
          nonce: new BN(8),
        };

        const relayer1Keypair = generateECDSAKeypair();
        const signature = generateSignature(eventData, relayer1Keypair.privateKey);

        try {
          await program.methods
            .submitSignature(
              eventData.sourceContract,
              eventData.targetContract,
              eventData.chainId,
              eventData.blockHeight,
              eventData.amount,
              eventData.receiverAddress,
              eventData.nonce,
              Buffer.from(signature)
            )
            .accounts({
              relayer: relayer1.publicKey,
              receiverState: receiverState,
              vault: vault.publicKey,
              usdcMint: usdcMint.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([relayer1])
            .rpc();
          expect.fail("Should have thrown an error");
        } catch (err) {
          expect(err).to.exist;
        }
      });
    });
  });

  describe("Integration Tests", () => {
    describe("IT-001: 端到端跨链转账（EVM → SVM）", () => {
      it.skip("should complete end-to-end cross-chain transfer from EVM to SVM", async () => {
        const receiverAddress = user2.publicKey.toBase58();

        await program.methods
          .stake(TEST_AMOUNT, receiverAddress)
          .accounts({
            user: user1.publicKey,
            senderState: senderState,
            vault: vault.publicKey,
            usdcMint: usdcMint.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([user1])
          .rpc();

        const senderStateAccount = await program.account.senderState.fetch(senderState);
        const nonce = senderStateAccount.nonce;

        const eventData: StakeEventData = {
          sourceContract: peerContract.publicKey,
          targetContract: receiverState,
          chainId: SOURCE_CHAIN_ID,
          blockHeight: new BN(2000),
          amount: TEST_AMOUNT,
          receiverAddress: receiverAddress,
          nonce: nonce,
        };

        const relayer1Keypair = generateECDSAKeypair();
        const relayer2Keypair = generateECDSAKeypair();

        const signature1 = generateSignature(eventData, relayer1Keypair.privateKey);
        const signature2 = generateSignature(eventData, relayer2Keypair.privateKey);

        await program.methods
          .submitSignature(
            eventData.sourceContract,
            eventData.targetContract,
            eventData.chainId,
            eventData.blockHeight,
            eventData.amount,
            eventData.receiverAddress,
            eventData.nonce,
            Buffer.from(signature1)
          )
          .accounts({
            relayer: relayer1.publicKey,
            receiverState: receiverState,
            vault: vault.publicKey,
            usdcMint: usdcMint.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([relayer1])
          .rpc();

        await program.methods
          .submitSignature(
            eventData.sourceContract,
            eventData.targetContract,
            eventData.chainId,
            eventData.blockHeight,
            eventData.amount,
            eventData.receiverAddress,
            eventData.nonce,
            Buffer.from(signature2)
          )
          .accounts({
            relayer: relayer2.publicKey,
            receiverState: receiverState,
            vault: vault.publicKey,
            usdcMint: usdcMint.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([relayer2])
          .rpc();

        const receiverStateAccount = await program.account.receiverState.fetch(receiverState);
        expect(receiverStateAccount.lastNonce.toString()).to.equal(nonce.toString());
      });
    });

    describe("IT-002: 端到端跨链转账（SVM → EVM）", () => {
      it.skip("should complete end-to-end cross-chain transfer from SVM to EVM", async () => {
        const receiverAddress = "0x1234567890123456789012345678901234567890";

        await program.methods
          .stake(TEST_AMOUNT, receiverAddress)
          .accounts({
            user: user1.publicKey,
            senderState: senderState,
            vault: vault.publicKey,
            usdcMint: usdcMint.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([user1])
          .rpc();

        const senderStateAccount = await program.account.senderState.fetch(senderState);
        const nonce = senderStateAccount.nonce;

        const eventData: StakeEventData = {
          sourceContract: peerContract.publicKey,
          targetContract: receiverState,
          chainId: SOURCE_CHAIN_ID,
          blockHeight: new BN(2001),
          amount: TEST_AMOUNT,
          receiverAddress: receiverAddress,
          nonce: nonce,
        };

        const relayer1Keypair = generateECDSAKeypair();
        const relayer2Keypair = generateECDSAKeypair();

        const signature1 = generateSignature(eventData, relayer1Keypair.privateKey);
        const signature2 = generateSignature(eventData, relayer2Keypair.privateKey);

        await program.methods
          .submitSignature(
            eventData.sourceContract,
            eventData.targetContract,
            eventData.chainId,
            eventData.blockHeight,
            eventData.amount,
            eventData.receiverAddress,
            eventData.nonce,
            Buffer.from(signature1)
          )
          .accounts({
            relayer: relayer1.publicKey,
            receiverState: receiverState,
            vault: vault.publicKey,
            usdcMint: usdcMint.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([relayer1])
          .rpc();

        await program.methods
          .submitSignature(
            eventData.sourceContract,
            eventData.targetContract,
            eventData.chainId,
            eventData.blockHeight,
            eventData.amount,
            eventData.receiverAddress,
            eventData.nonce,
            Buffer.from(signature2)
          )
          .accounts({
            relayer: relayer2.publicKey,
            receiverState: receiverState,
            vault: vault.publicKey,
            usdcMint: usdcMint.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([relayer2])
          .rpc();

        const receiverStateAccount = await program.account.receiverState.fetch(receiverState);
        expect(receiverStateAccount.lastNonce.toString()).to.equal(nonce.toString());
      });
    });

    describe("IT-003: 并发跨链转账", () => {
      it.skip("should handle concurrent cross-chain transfers", async () => {
        const promises = [];
        for (let i = 0; i < 10; i++) {
          const receiverAddress = user2.publicKey.toBase58();
          promises.push(
            program.methods
              .stake(TEST_AMOUNT, receiverAddress)
              .accounts({
                user: user1.publicKey,
                senderState: senderState,
                vault: vault.publicKey,
                usdcMint: usdcMint.publicKey,
                systemProgram: SystemProgram.programId,
              })
              .signers([user1])
              .rpc()
          );
        }

        await Promise.all(promises);

        const senderStateAccount = await program.account.senderState.fetch(senderState);
        expect(senderStateAccount.nonce.toNumber()).to.be.greaterThanOrEqual(10);
      });
    });

    describe("IT-004: 大额转账测试", () => {
      it.skip("should handle large amount transfer", async () => {
        const largeAmount = new BN(10000_000000);
        const receiverAddress = user2.publicKey.toBase58();

        await program.methods
          .stake(largeAmount, receiverAddress)
          .accounts({
            user: user1.publicKey,
            senderState: senderState,
            vault: vault.publicKey,
            usdcMint: usdcMint.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([user1])
          .rpc();

        const senderStateAccount = await program.account.senderState.fetch(senderState);
        expect(senderStateAccount.nonce.toNumber()).to.be.greaterThan(0);
      });
    });
  });

  describe("Security Tests", () => {
    describe("ST-001: Nonce递增判断机制（重放攻击防御）", () => {
      it.skip("should reject same nonce replay attack", async () => {
        const eventData: StakeEventData = {
          sourceContract: peerContract.publicKey,
          targetContract: receiverState,
          chainId: SOURCE_CHAIN_ID,
          blockHeight: new BN(3000),
          amount: TEST_AMOUNT,
          receiverAddress: user2.publicKey.toBase58(),
          nonce: new BN(10),
        };

        const relayer1Keypair = generateECDSAKeypair();
        const relayer2Keypair = generateECDSAKeypair();

        const signature1 = generateSignature(eventData, relayer1Keypair.privateKey);
        const signature2 = generateSignature(eventData, relayer2Keypair.privateKey);

        await program.methods
          .submitSignature(
            eventData.sourceContract,
            eventData.targetContract,
            eventData.chainId,
            eventData.blockHeight,
            eventData.amount,
            eventData.receiverAddress,
            eventData.nonce,
            Buffer.from(signature1)
          )
          .accounts({
            relayer: relayer1.publicKey,
            receiverState: receiverState,
            vault: vault.publicKey,
            usdcMint: usdcMint.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([relayer1])
          .rpc();

        await program.methods
          .submitSignature(
            eventData.sourceContract,
            eventData.targetContract,
            eventData.chainId,
            eventData.blockHeight,
            eventData.amount,
            eventData.receiverAddress,
            eventData.nonce,
            Buffer.from(signature2)
          )
          .accounts({
            relayer: relayer2.publicKey,
            receiverState: receiverState,
            vault: vault.publicKey,
            usdcMint: usdcMint.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([relayer2])
          .rpc();

        const receiverStateAccount = await program.account.receiverState.fetch(receiverState);
        expect(receiverStateAccount.lastNonce.toNumber()).to.equal(10);

        try {
          await program.methods
            .submitSignature(
              eventData.sourceContract,
              eventData.targetContract,
              eventData.chainId,
              eventData.blockHeight,
              eventData.amount,
              eventData.receiverAddress,
              eventData.nonce,
              Buffer.from(signature1)
            )
            .accounts({
              relayer: relayer1.publicKey,
              receiverState: receiverState,
              vault: vault.publicKey,
              usdcMint: usdcMint.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([relayer1])
            .rpc();
          expect.fail("Should have thrown an error");
        } catch (err) {
          expect(err).to.exist;
        }
      });

      it.skip("should reject smaller nonce replay attack", async () => {
        const eventData: StakeEventData = {
          sourceContract: peerContract.publicKey,
          targetContract: receiverState,
          chainId: SOURCE_CHAIN_ID,
          blockHeight: new BN(3001),
          amount: TEST_AMOUNT,
          receiverAddress: user2.publicKey.toBase58(),
          nonce: new BN(9),
        };

        const relayer1Keypair = generateECDSAKeypair();
        const signature = generateSignature(eventData, relayer1Keypair.privateKey);

        try {
          await program.methods
            .submitSignature(
              eventData.sourceContract,
              eventData.targetContract,
              eventData.chainId,
              eventData.blockHeight,
              eventData.amount,
              eventData.receiverAddress,
              eventData.nonce,
              Buffer.from(signature)
            )
            .accounts({
              relayer: relayer1.publicKey,
              receiverState: receiverState,
              vault: vault.publicKey,
              usdcMint: usdcMint.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([relayer1])
            .rpc();
          expect.fail("Should have thrown an error");
        } catch (err) {
          expect(err).to.exist;
        }
      });

      it.skip("should handle nonce overflow correctly", async () => {
        const maxNonce = new BN("18446744073709551615");
        const eventData: StakeEventData = {
          sourceContract: peerContract.publicKey,
          targetContract: receiverState,
          chainId: SOURCE_CHAIN_ID,
          blockHeight: new BN(3002),
          amount: TEST_AMOUNT,
          receiverAddress: user2.publicKey.toBase58(),
          nonce: maxNonce,
        };

        const relayer1Keypair = generateECDSAKeypair();
        const relayer2Keypair = generateECDSAKeypair();

        const signature1 = generateSignature(eventData, relayer1Keypair.privateKey);
        const signature2 = generateSignature(eventData, relayer2Keypair.privateKey);

        await program.methods
          .submitSignature(
            eventData.sourceContract,
            eventData.targetContract,
            eventData.chainId,
            eventData.blockHeight,
            eventData.amount,
            eventData.receiverAddress,
            eventData.nonce,
            Buffer.from(signature1)
          )
          .accounts({
            relayer: relayer1.publicKey,
            receiverState: receiverState,
            vault: vault.publicKey,
            usdcMint: usdcMint.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([relayer1])
          .rpc();

        await program.methods
          .submitSignature(
            eventData.sourceContract,
            eventData.targetContract,
            eventData.chainId,
            eventData.blockHeight,
            eventData.amount,
            eventData.receiverAddress,
            eventData.nonce,
            Buffer.from(signature2)
          )
          .accounts({
            relayer: relayer2.publicKey,
            receiverState: receiverState,
            vault: vault.publicKey,
            usdcMint: usdcMint.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([relayer2])
          .rpc();

        const receiverStateAccount = await program.account.receiverState.fetch(receiverState);
        expect(receiverStateAccount.lastNonce.toString()).to.equal(maxNonce.toString());
      });
    });

    describe("ST-002: 签名伪造防御", () => {
      it.skip("should reject forged signature", async () => {
        const eventData: StakeEventData = {
          sourceContract: peerContract.publicKey,
          targetContract: receiverState,
          chainId: SOURCE_CHAIN_ID,
          blockHeight: new BN(4000),
          amount: TEST_AMOUNT,
          receiverAddress: user2.publicKey.toBase58(),
          nonce: new BN(20),
        };

        const attackerKeypair = generateECDSAKeypair();
        const signature = generateSignature(eventData, attackerKeypair.privateKey);

        try {
          await program.methods
            .submitSignature(
              eventData.sourceContract,
              eventData.targetContract,
              eventData.chainId,
              eventData.blockHeight,
              eventData.amount,
              eventData.receiverAddress,
              eventData.nonce,
              Buffer.from(signature)
            )
            .accounts({
              relayer: relayer1.publicKey,
              receiverState: receiverState,
              vault: vault.publicKey,
              usdcMint: usdcMint.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([relayer1])
            .rpc();
          expect.fail("Should have thrown an error");
        } catch (err) {
          expect(err).to.exist;
        }
      });
    });

    describe("ST-003: 权限控制测试", () => {
      it.skip("should reject non-admin add relayer", async () => {
        const relayerKeypair = generateECDSAKeypair();

        try {
          await program.methods
            .addRelayer(nonRelayer.publicKey, Buffer.from(relayerKeypair.publicKey))
            .accounts({
              admin: nonAdmin.publicKey,
              receiverState: receiverState,
              systemProgram: SystemProgram.programId,
            })
            .signers([nonAdmin])
            .rpc();
          expect.fail("Should have thrown an error");
        } catch (err) {
          expect(err).to.exist;
        }
      });

      it.skip("should reject non-admin remove relayer", async () => {
        try {
          await program.methods
            .removeRelayer(relayer1.publicKey)
            .accounts({
              admin: nonAdmin.publicKey,
              receiverState: receiverState,
              systemProgram: SystemProgram.programId,
            })
            .signers([nonAdmin])
            .rpc();
          expect.fail("Should have thrown an error");
        } catch (err) {
          expect(err).to.exist;
        }
      });
    });

    describe("ST-004: 金库安全测试", () => {
      it.skip("should prevent direct vault transfer", async () => {
        try {
          const transferInstruction = SystemProgram.transfer({
            fromPubkey: vault.publicKey,
            toPubkey: user1.publicKey,
            lamports: LAMPORTS_PER_SOL,
          });

          await provider.sendAndConfirm(
            new anchor.web3.Transaction().add(transferInstruction),
            [vault]
          );
          expect.fail("Should have thrown an error");
        } catch (err) {
          expect(err).to.exist;
        }
      });

      it.skip("should prevent over-unlock", async () => {
        const largeAmount = new BN(1000000_000000);
        const eventData: StakeEventData = {
          sourceContract: peerContract.publicKey,
          targetContract: receiverState,
          chainId: SOURCE_CHAIN_ID,
          blockHeight: new BN(4001),
          amount: largeAmount,
          receiverAddress: user2.publicKey.toBase58(),
          nonce: new BN(21),
        };

        const relayer1Keypair = generateECDSAKeypair();
        const relayer2Keypair = generateECDSAKeypair();

        const signature1 = generateSignature(eventData, relayer1Keypair.privateKey);
        const signature2 = generateSignature(eventData, relayer2Keypair.privateKey);

        try {
          await program.methods
            .submitSignature(
              eventData.sourceContract,
              eventData.targetContract,
              eventData.chainId,
              eventData.blockHeight,
              eventData.amount,
              eventData.receiverAddress,
              eventData.nonce,
              Buffer.from(signature1)
            )
            .accounts({
              relayer: relayer1.publicKey,
              receiverState: receiverState,
              vault: vault.publicKey,
              usdcMint: usdcMint.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([relayer1])
            .rpc();

          await program.methods
            .submitSignature(
              eventData.sourceContract,
              eventData.targetContract,
              eventData.chainId,
              eventData.blockHeight,
              eventData.amount,
              eventData.receiverAddress,
              eventData.nonce,
              Buffer.from(signature2)
            )
            .accounts({
              relayer: relayer2.publicKey,
              receiverState: receiverState,
              vault: vault.publicKey,
              usdcMint: usdcMint.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([relayer2])
            .rpc();
          expect.fail("Should have thrown an error");
        } catch (err) {
          expect(err).to.exist;
        }
      });
    });

    describe("ST-005: 伪造事件防御和CrossChainRequest PDA安全", () => {
      it.skip("should reject forged event with wrong contract address", async () => {
        const wrongSourceContract = Keypair.generate();
        const eventData: StakeEventData = {
          sourceContract: wrongSourceContract.publicKey,
          targetContract: receiverState,
          chainId: SOURCE_CHAIN_ID,
          blockHeight: new BN(5000),
          amount: TEST_AMOUNT,
          receiverAddress: user2.publicKey.toBase58(),
          nonce: new BN(22),
        };

        const relayer1Keypair = generateECDSAKeypair();
        const signature = generateSignature(eventData, relayer1Keypair.privateKey);

        try {
          await program.methods
            .submitSignature(
              eventData.sourceContract,
              eventData.targetContract,
              eventData.chainId,
              eventData.blockHeight,
              eventData.amount,
              eventData.receiverAddress,
              eventData.nonce,
              Buffer.from(signature)
            )
            .accounts({
              relayer: relayer1.publicKey,
              receiverState: receiverState,
              vault: vault.publicKey,
              usdcMint: usdcMint.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([relayer1])
            .rpc();
          expect.fail("Should have thrown an error");
        } catch (err) {
          expect(err).to.exist;
        }
      });

      it.skip("should reject forged event with wrong chain ID", async () => {
        const wrongChainId = new BN(999999);
        const eventData: StakeEventData = {
          sourceContract: peerContract.publicKey,
          targetContract: receiverState,
          chainId: wrongChainId,
          blockHeight: new BN(5001),
          amount: TEST_AMOUNT,
          receiverAddress: user2.publicKey.toBase58(),
          nonce: new BN(23),
        };

        const relayer1Keypair = generateECDSAKeypair();
        const signature = generateSignature(eventData, relayer1Keypair.privateKey);

        try {
          await program.methods
            .submitSignature(
              eventData.sourceContract,
              eventData.targetContract,
              eventData.chainId,
              eventData.blockHeight,
              eventData.amount,
              eventData.receiverAddress,
              eventData.nonce,
              Buffer.from(signature)
            )
            .accounts({
              relayer: relayer1.publicKey,
              receiverState: receiverState,
              vault: vault.publicKey,
              usdcMint: usdcMint.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([relayer1])
            .rpc();
          expect.fail("Should have thrown an error");
        } catch (err) {
          expect(err).to.exist;
        }
      });

      it.skip("should isolate signatures for different nonces", async () => {
        const eventData1: StakeEventData = {
          sourceContract: peerContract.publicKey,
          targetContract: receiverState,
          chainId: SOURCE_CHAIN_ID,
          blockHeight: new BN(5002),
          amount: TEST_AMOUNT,
          receiverAddress: user2.publicKey.toBase58(),
          nonce: new BN(24),
        };

        const eventData2: StakeEventData = {
          sourceContract: peerContract.publicKey,
          targetContract: receiverState,
          chainId: SOURCE_CHAIN_ID,
          blockHeight: new BN(5003),
          amount: TEST_AMOUNT,
          receiverAddress: user2.publicKey.toBase58(),
          nonce: new BN(25),
        };

        const relayer1Keypair = generateECDSAKeypair();
        const signature1 = generateSignature(eventData1, relayer1Keypair.privateKey);
        const signature2 = generateSignature(eventData2, relayer1Keypair.privateKey);

        await program.methods
          .submitSignature(
            eventData1.sourceContract,
            eventData1.targetContract,
            eventData1.chainId,
            eventData1.blockHeight,
            eventData1.amount,
            eventData1.receiverAddress,
            eventData1.nonce,
            Buffer.from(signature1)
          )
          .accounts({
            relayer: relayer1.publicKey,
            receiverState: receiverState,
            vault: vault.publicKey,
            usdcMint: usdcMint.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([relayer1])
          .rpc();

        await program.methods
          .submitSignature(
            eventData2.sourceContract,
            eventData2.targetContract,
            eventData2.chainId,
            eventData2.blockHeight,
            eventData2.amount,
            eventData2.receiverAddress,
            eventData2.nonce,
            Buffer.from(signature2)
          )
          .accounts({
            relayer: relayer1.publicKey,
            receiverState: receiverState,
            vault: vault.publicKey,
            usdcMint: usdcMint.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([relayer1])
          .rpc();
      });
    });
  });

  describe("Performance Tests", () => {
    describe("PT-001: 事件监听延迟", () => {
      it.skip("should measure event listening latency", async () => {
        const startTime = Date.now();
        const receiverAddress = user2.publicKey.toBase58();

        await program.methods
          .stake(TEST_AMOUNT, receiverAddress)
          .accounts({
            user: user1.publicKey,
            senderState: senderState,
            vault: vault.publicKey,
            usdcMint: usdcMint.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([user1])
          .rpc();

        const endTime = Date.now();
        const latency = endTime - startTime;
        expect(latency).to.be.lessThan(30000);
      });
    });

    describe("PT-002: 签名提交延迟", () => {
      it.skip("should measure signature submission latency", async () => {
        const eventData: StakeEventData = {
          sourceContract: peerContract.publicKey,
          targetContract: receiverState,
          chainId: SOURCE_CHAIN_ID,
          blockHeight: new BN(6000),
          amount: TEST_AMOUNT,
          receiverAddress: user2.publicKey.toBase58(),
          nonce: new BN(30),
        };

        const relayer1Keypair = generateECDSAKeypair();
        const signature = generateSignature(eventData, relayer1Keypair.privateKey);

        const startTime = Date.now();

        await program.methods
          .submitSignature(
            eventData.sourceContract,
            eventData.targetContract,
            eventData.chainId,
            eventData.blockHeight,
            eventData.amount,
            eventData.receiverAddress,
            eventData.nonce,
            Buffer.from(signature)
          )
          .accounts({
            relayer: relayer1.publicKey,
            receiverState: receiverState,
            vault: vault.publicKey,
            usdcMint: usdcMint.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([relayer1])
          .rpc();

        const endTime = Date.now();
        const latency = endTime - startTime;
        expect(latency).to.be.lessThan(60000);
      });
    });

    describe("PT-003: 端到端延迟", () => {
      it.skip("should measure end-to-end latency", async () => {
        const startTime = Date.now();
        const receiverAddress = user2.publicKey.toBase58();

        await program.methods
          .stake(TEST_AMOUNT, receiverAddress)
          .accounts({
            user: user1.publicKey,
            senderState: senderState,
            vault: vault.publicKey,
            usdcMint: usdcMint.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([user1])
          .rpc();

        const senderStateAccount = await program.account.senderState.fetch(senderState);
        const nonce = senderStateAccount.nonce;

        const eventData: StakeEventData = {
          sourceContract: peerContract.publicKey,
          targetContract: receiverState,
          chainId: SOURCE_CHAIN_ID,
          blockHeight: new BN(7000),
          amount: TEST_AMOUNT,
          receiverAddress: receiverAddress,
          nonce: nonce,
        };

        const relayer1Keypair = generateECDSAKeypair();
        const relayer2Keypair = generateECDSAKeypair();

        const signature1 = generateSignature(eventData, relayer1Keypair.privateKey);
        const signature2 = generateSignature(eventData, relayer2Keypair.privateKey);

        await program.methods
          .submitSignature(
            eventData.sourceContract,
            eventData.targetContract,
            eventData.chainId,
            eventData.blockHeight,
            eventData.amount,
            eventData.receiverAddress,
            eventData.nonce,
            Buffer.from(signature1)
          )
          .accounts({
            relayer: relayer1.publicKey,
            receiverState: receiverState,
            vault: vault.publicKey,
            usdcMint: usdcMint.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([relayer1])
          .rpc();

        await program.methods
          .submitSignature(
            eventData.sourceContract,
            eventData.targetContract,
            eventData.chainId,
            eventData.blockHeight,
            eventData.amount,
            eventData.receiverAddress,
            eventData.nonce,
            Buffer.from(signature2)
          )
          .accounts({
            relayer: relayer2.publicKey,
            receiverState: receiverState,
            vault: vault.publicKey,
            usdcMint: usdcMint.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([relayer2])
          .rpc();

        const endTime = Date.now();
        const latency = endTime - startTime;
        expect(latency).to.be.lessThan(300000);
      });
    });

    describe("PT-004: 吞吐量测试", () => {
      it.skip("should measure throughput", async () => {
        const startTime = Date.now();
        const receiverAddress = user2.publicKey.toBase58();
        let successCount = 0;

        for (let i = 0; i < 100; i++) {
          try {
            await program.methods
              .stake(TEST_AMOUNT, receiverAddress)
              .accounts({
                user: user1.publicKey,
                senderState: senderState,
                vault: vault.publicKey,
                usdcMint: usdcMint.publicKey,
                systemProgram: SystemProgram.programId,
              })
              .signers([user1])
              .rpc();
            successCount++;
          } catch (err) {
          }
        }

        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000 / 60;
        const throughput = successCount / duration;
        expect(throughput).to.be.greaterThan(100);
      });
    });
  });

  describe("Cryptographic Helper Tests", () => {
    describe("Hash Consistency Test", () => {
      it.skip("should produce consistent hash for same event data", () => {
        const eventData: StakeEventData = {
          sourceContract: peerContract.publicKey,
          targetContract: receiverState,
          chainId: SOURCE_CHAIN_ID,
          blockHeight: new BN(8000),
          amount: TEST_AMOUNT,
          receiverAddress: user2.publicKey.toBase58(),
          nonce: new BN(40),
        };

        const hash1 = hashEventData(eventData);
        const hash2 = hashEventData(eventData);
        expect(hash1.toString("hex")).to.equal(hash2.toString("hex"));
      });
    });

    describe("ECDSA Signature Generation and Verification Test", () => {
      it.skip("should generate and verify valid signature", () => {
        const eventData: StakeEventData = {
          sourceContract: peerContract.publicKey,
          targetContract: receiverState,
          chainId: SOURCE_CHAIN_ID,
          blockHeight: new BN(8001),
          amount: TEST_AMOUNT,
          receiverAddress: user2.publicKey.toBase58(),
          nonce: new BN(41),
        };

        const keypair = generateECDSAKeypair();
        const signature = generateSignature(eventData, keypair.privateKey);
        const isValid = verifySignature(eventData, signature, keypair.publicKey);
        expect(isValid).to.be.true;
      });

      it.skip("should reject invalid signature", () => {
        const eventData: StakeEventData = {
          sourceContract: peerContract.publicKey,
          targetContract: receiverState,
          chainId: SOURCE_CHAIN_ID,
          blockHeight: new BN(8002),
          amount: TEST_AMOUNT,
          receiverAddress: user2.publicKey.toBase58(),
          nonce: new BN(42),
        };

        const keypair1 = generateECDSAKeypair();
        const keypair2 = generateECDSAKeypair();
        const signature = generateSignature(eventData, keypair1.privateKey);
        const isValid = verifySignature(eventData, signature, keypair2.publicKey);
        expect(isValid).to.be.false;
      });
    });

    describe("Threshold Calculation Test", () => {
      it.skip("should calculate correct threshold for 3 relayers", () => {
        const threshold = calculateThreshold(3);
        expect(threshold).to.equal(2);
      });

      it.skip("should calculate correct threshold for 4 relayers", () => {
        const threshold = calculateThreshold(4);
        expect(threshold).to.equal(3);
      });

      it.skip("should calculate correct threshold for 5 relayers", () => {
        const threshold = calculateThreshold(5);
        expect(threshold).to.equal(4);
      });

      it.skip("should calculate correct threshold for 18 relayers", () => {
        const threshold = calculateThreshold(18);
        expect(threshold).to.equal(13);
      });
    });
  });
});


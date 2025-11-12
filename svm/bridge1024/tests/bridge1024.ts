import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Bridge1024 } from "../target/types/bridge1024";
import { expect } from "chai";
import * as crypto from "crypto";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL, Connection } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

describe("bridge1024", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Bridge1024 as Program<Bridge1024>;
  const connection = provider.connection;

  const SOURCE_CHAIN_ID = new BN(421614);
  const TARGET_CHAIN_ID = new BN(1024);
  const TEST_AMOUNT = new BN(100_000000);
  const LARGE_AMOUNT = new BN(10_000_000000);
  const AIRDROP_AMOUNT = 10 * LAMPORTS_PER_SOL;

  let admin: Keypair;
  let vault: Keypair;
  let user1: Keypair;
  let user2: Keypair;
  let relayer1: Keypair;
  let relayer2: Keypair;
  let relayer3: Keypair;
  let nonRelayer: Keypair;
  let nonAdmin: Keypair;
  let senderProgram: PublicKey;
  let receiverProgram: PublicKey;
  let senderProgramState: PublicKey;
  let receiverProgramState: PublicKey;

  interface StakeEventData {
    sourceContract: PublicKey;
    targetContract: PublicKey;
    chainId: BN;
    blockHeight: BN;
    amount: BN;
    receiverAddress: string;
    nonce: BN;
  }

  interface RelayerKeypair {
    keypair: Keypair;
    ecdsaPrivateKey: Buffer;
    ecdsaPublicKey: Buffer;
  }

  function generateECDSAKeypair(): { privateKey: Buffer; publicKey: Buffer } {
    const ecdh = crypto.createECDH("secp256k1");
    ecdh.generateKeys();
    return {
      privateKey: ecdh.getPrivateKey(),
      publicKey: ecdh.getPublicKey(),
    };
  }

  function serializeEventData(eventData: StakeEventData): Buffer {
    const sourceContractBytes = eventData.sourceContract.toBuffer();
    const targetContractBytes = eventData.targetContract.toBuffer();
    const chainIdBytes = eventData.chainId.toArrayLike(Buffer, "be", 8);
    const blockHeightBytes = eventData.blockHeight.toArrayLike(Buffer, "be", 8);
    const amountBytes = eventData.amount.toArrayLike(Buffer, "be", 8);
    const receiverAddressBytes = Buffer.from(eventData.receiverAddress, "utf-8");
    const nonceBytes = eventData.nonce.toArrayLike(Buffer, "be", 8);

    return Buffer.concat([
      sourceContractBytes,
      targetContractBytes,
      chainIdBytes,
      blockHeightBytes,
      amountBytes,
      receiverAddressBytes,
      nonceBytes,
    ]);
  }

  function hashEventData(eventData: StakeEventData): Buffer {
    const serialized = serializeEventData(eventData);
    return crypto.createHash("sha256").update(serialized).digest();
  }

  function generateSignature(eventData: StakeEventData, privateKey: Buffer): Buffer {
    const hash = hashEventData(eventData);
    const sign = crypto.createSign("SHA256");
    sign.update(hash);
    return sign.sign(privateKey);
  }

  function verifySignature(eventData: StakeEventData, signature: Buffer, publicKey: Buffer): boolean {
    const hash = hashEventData(eventData);
    const verify = crypto.createVerify("SHA256");
    verify.update(hash);
    return verify.verify(publicKey, signature);
  }

  function calculateThreshold(relayerCount: number): number {
    return Math.ceil(relayerCount * 2 / 3);
  }

  async function airdrop(account: PublicKey, amount: number): Promise<void> {
    const signature = await connection.requestAirdrop(account, amount);
    await connection.confirmTransaction(signature);
  }

  async function getBalance(account: PublicKey): Promise<number> {
    return await connection.getBalance(account);
  }

  let relayer1ECDSA: RelayerKeypair;
  let relayer2ECDSA: RelayerKeypair;
  let relayer3ECDSA: RelayerKeypair;

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

    senderProgram = program.programId;
    receiverProgram = program.programId;

    const [senderState] = PublicKey.findProgramAddressSync(
      [Buffer.from("sender_state")],
      senderProgram
    );
    senderProgramState = senderState;

    const [receiverState] = PublicKey.findProgramAddressSync(
      [Buffer.from("receiver_state")],
      receiverProgram
    );
    receiverProgramState = receiverState;

    await airdrop(admin.publicKey, AIRDROP_AMOUNT);
    await airdrop(vault.publicKey, AIRDROP_AMOUNT);
    await airdrop(user1.publicKey, AIRDROP_AMOUNT);
    await airdrop(user2.publicKey, AIRDROP_AMOUNT);
    await airdrop(relayer1.publicKey, AIRDROP_AMOUNT);
    await airdrop(relayer2.publicKey, AIRDROP_AMOUNT);
    await airdrop(relayer3.publicKey, AIRDROP_AMOUNT);
    await airdrop(nonRelayer.publicKey, AIRDROP_AMOUNT);
    await airdrop(nonAdmin.publicKey, AIRDROP_AMOUNT);

    const ecdsa1 = generateECDSAKeypair();
    const ecdsa2 = generateECDSAKeypair();
    const ecdsa3 = generateECDSAKeypair();

    relayer1ECDSA = {
      keypair: relayer1,
      ecdsaPrivateKey: ecdsa1.privateKey,
      ecdsaPublicKey: ecdsa1.publicKey,
    };

    relayer2ECDSA = {
      keypair: relayer2,
      ecdsaPrivateKey: ecdsa2.privateKey,
      ecdsaPublicKey: ecdsa2.publicKey,
    };

    relayer3ECDSA = {
      keypair: relayer3,
      ecdsaPrivateKey: ecdsa3.privateKey,
      ecdsaPublicKey: ecdsa3.publicKey,
    };
  });

  describe("Sender Contract Tests", () => {
    describe("TC-001: Initialize Contract", () => {
      it("should initialize sender contract successfully", async () => {
        try {
          const tx = await program.methods
            .initializeSender(vault.publicKey, admin.publicKey)
            .accounts({
              senderState: senderProgramState,
              admin: admin.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([admin])
            .rpc();

          await connection.confirmTransaction(tx);

          const state = await program.account.senderState.fetch(senderProgramState);
          expect(state.vault.toBase58()).to.equal(vault.publicKey.toBase58());
          expect(state.admin.toBase58()).to.equal(admin.publicKey.toBase58());
          expect(state.nonce.toString()).to.equal("0");
        } catch (error) {
          expect.fail(`Initialization failed: ${error}`);
        }
      });
    });

    describe("TC-002: Configure Target", () => {
      it("should configure target successfully", async () => {
        try {
          const tx = await program.methods
            .configureTarget(receiverProgram, SOURCE_CHAIN_ID, TARGET_CHAIN_ID)
            .accounts({
              senderState: senderProgramState,
              admin: admin.publicKey,
            })
            .signers([admin])
            .rpc();

          await connection.confirmTransaction(tx);

          const state = await program.account.senderState.fetch(senderProgramState);
          expect(state.targetContract.toBase58()).to.equal(receiverProgram.toBase58());
          expect(state.sourceChainId.toString()).to.equal(SOURCE_CHAIN_ID.toString());
          expect(state.targetChainId.toString()).to.equal(TARGET_CHAIN_ID.toString());
        } catch (error) {
          expect.fail(`Configuration failed: ${error}`);
        }
      });
    });

    describe("TC-003: Configure Target - Non-Admin Permission", () => {
      it("should reject configuration by non-admin", async () => {
        try {
          await program.methods
            .configureTarget(receiverProgram, SOURCE_CHAIN_ID, TARGET_CHAIN_ID)
            .accounts({
              senderState: senderProgramState,
              admin: nonAdmin.publicKey,
            })
            .signers([nonAdmin])
            .rpc();

          expect.fail("Should have thrown an error");
        } catch (error) {
          expect(error.message).to.include("Unauthorized");
        }
      });
    });

    describe("TC-004: Stake Function - Success Scenario", () => {
      it("should stake successfully", async () => {
        try {
          const receiverAddress = user2.publicKey.toBase58();
          const userBalanceBefore = await getBalance(user1.publicKey);
          const vaultBalanceBefore = await getBalance(vault.publicKey);

          const tx = await program.methods
            .stake(TEST_AMOUNT, receiverAddress)
            .accounts({
              senderState: senderProgramState,
              user: user1.publicKey,
              vault: vault.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([user1])
            .rpc();

          await connection.confirmTransaction(tx);

          const state = await program.account.senderState.fetch(senderProgramState);
          expect(state.nonce.toString()).to.equal("1");

          const logs = await connection.getTransaction(tx, { commitment: "confirmed" });
          const logMessages = logs.meta.logMessages.join(" ");
          expect(logMessages).to.include("StakeEvent");
        } catch (error) {
          expect.fail(`Stake failed: ${error}`);
        }
      });
    });

    describe("TC-005: Stake Function - Insufficient Balance", () => {
      it("should reject stake with insufficient balance", async () => {
        try {
          const receiverAddress = user2.publicKey.toBase58();
          const largeAmount = new BN(1_000_000_000000);

          await program.methods
            .stake(largeAmount, receiverAddress)
            .accounts({
              senderState: senderProgramState,
              user: user1.publicKey,
              vault: vault.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([user1])
            .rpc();

          expect.fail("Should have thrown an error");
        } catch (error) {
          expect(error.message).to.include("InsufficientBalance");
        }
      });
    });

    describe("TC-006: Stake Function - Unauthorized", () => {
      it("should reject stake without authorization", async () => {
        try {
          const receiverAddress = user2.publicKey.toBase58();

          await program.methods
            .stake(TEST_AMOUNT, receiverAddress)
            .accounts({
              senderState: senderProgramState,
              user: user1.publicKey,
              vault: vault.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([])
            .rpc();

          expect.fail("Should have thrown an error");
        } catch (error) {
          // Accept Solana's signature verification error message
          // This happens when signers array is empty and user account is marked as Signer
          const errorMsg = error.message.toLowerCase();
          expect(
            errorMsg.includes("unauthorized") ||
            errorMsg.includes("signature verification failed") ||
            errorMsg.includes("missing required signature")
          ).to.be.true;
        }
      });
    });

    describe("TC-007: Stake Event Integrity", () => {
      it("should emit complete stake event", async () => {
        try {
          const receiverAddress = user2.publicKey.toBase58();
          const blockHeight = new BN(await connection.getBlockHeight());

          const tx = await program.methods
            .stake(TEST_AMOUNT, receiverAddress)
            .accounts({
              senderState: senderProgramState,
              user: user1.publicKey,
              vault: vault.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([user1])
            .rpc();

          await connection.confirmTransaction(tx);

          const state = await program.account.senderState.fetch(senderProgramState);
          const logs = await connection.getTransaction(tx, { commitment: "confirmed" });
          const logMessages = logs.meta.logMessages.join(" ");

          expect(logMessages).to.include(senderProgram.toBase58());
          expect(logMessages).to.include(receiverProgram.toBase58());
          expect(logMessages).to.include(SOURCE_CHAIN_ID.toString());
          expect(logMessages).to.include(TEST_AMOUNT.toString());
          expect(logMessages).to.include(receiverAddress);
          expect(logMessages).to.include(state.nonce.toString());
        } catch (error) {
          expect.fail(`Stake event check failed: ${error}`);
        }
      });
    });
  });

  describe("Receiver Contract Tests", () => {
    describe("TC-101: Initialize Contract", () => {
      it.skip("should initialize receiver contract successfully", async () => {
        try {
          const tx = await program.methods
            .initializeReceiver(vault.publicKey, admin.publicKey)
            .accounts({
              receiverState: receiverProgramState,
              admin: admin.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([admin])
            .rpc();

          await connection.confirmTransaction(tx);

          const state = await program.account.receiverState.fetch(receiverProgramState);
          expect(state.vault.toBase58()).to.equal(vault.publicKey.toBase58());
          expect(state.admin.toBase58()).to.equal(admin.publicKey.toBase58());
          expect(state.relayerCount.toString()).to.equal("0");
        } catch (error) {
          expect.fail(`Initialization failed: ${error}`);
        }
      });
    });

    describe("TC-102: Configure Source", () => {
      it.skip("should configure source successfully", async () => {
        try {
          const tx = await program.methods
            .configureSource(senderProgram, SOURCE_CHAIN_ID, TARGET_CHAIN_ID)
            .accounts({
              receiverState: receiverProgramState,
              admin: admin.publicKey,
            })
            .signers([admin])
            .rpc();

          await connection.confirmTransaction(tx);

          const state = await program.account.receiverState.fetch(receiverProgramState);
          expect(state.sourceContract.toBase58()).to.equal(senderProgram.toBase58());
          expect(state.sourceChainId.toString()).to.equal(SOURCE_CHAIN_ID.toString());
          expect(state.targetChainId.toString()).to.equal(TARGET_CHAIN_ID.toString());
        } catch (error) {
          expect.fail(`Configuration failed: ${error}`);
        }
      });
    });

    describe("TC-103: Configure Source - Non-Admin Permission", () => {
      it.skip("should reject configuration by non-admin", async () => {
        try {
          await program.methods
            .configureSource(senderProgram, SOURCE_CHAIN_ID, TARGET_CHAIN_ID)
            .accounts({
              receiverState: receiverProgramState,
              admin: nonAdmin.publicKey,
            })
            .signers([nonAdmin])
            .rpc();

          expect.fail("Should have thrown an error");
        } catch (error) {
          expect(error.message).to.include("Unauthorized");
        }
      });
    });

    describe("TC-104: Add Relayer - Admin Permission", () => {
      it.skip("should add relayer successfully", async () => {
        try {
          const tx1 = await program.methods
            .addRelayer(relayer1.publicKey)
            .accounts({
              receiverState: receiverProgramState,
              admin: admin.publicKey,
            })
            .signers([admin])
            .rpc();

          await connection.confirmTransaction(tx1);

          const tx2 = await program.methods
            .addRelayer(relayer2.publicKey)
            .accounts({
              receiverState: receiverProgramState,
              admin: admin.publicKey,
            })
            .signers([admin])
            .rpc();

          await connection.confirmTransaction(tx2);

          const tx3 = await program.methods
            .addRelayer(relayer3.publicKey)
            .accounts({
              receiverState: receiverProgramState,
              admin: admin.publicKey,
            })
            .signers([admin])
            .rpc();

          await connection.confirmTransaction(tx3);

          const state = await program.account.receiverState.fetch(receiverProgramState);
          expect(state.relayerCount.toString()).to.equal("3");

          const isRelayer = await program.methods
            .isRelayer(relayer1.publicKey)
            .accounts({
              receiverState: receiverProgramState,
            })
            .view();

          expect(isRelayer).to.be.true;
        } catch (error) {
          expect.fail(`Add relayer failed: ${error}`);
        }
      });
    });

    describe("TC-105: Add Relayer - Non-Admin Permission", () => {
      it.skip("should reject adding relayer by non-admin", async () => {
        try {
          await program.methods
            .addRelayer(relayer1.publicKey)
            .accounts({
              receiverState: receiverProgramState,
              admin: nonAdmin.publicKey,
            })
            .signers([nonAdmin])
            .rpc();

          expect.fail("Should have thrown an error");
        } catch (error) {
          expect(error.message).to.include("Unauthorized");
        }
      });
    });

    describe("TC-106: Remove Relayer - Admin Permission", () => {
      it.skip("should remove relayer successfully", async () => {
        try {
          const stateBefore = await program.account.receiverState.fetch(receiverProgramState);
          const relayerCountBefore = stateBefore.relayerCount.toNumber();

          const tx = await program.methods
            .removeRelayer(relayer1.publicKey)
            .accounts({
              receiverState: receiverProgramState,
              admin: admin.publicKey,
            })
            .signers([admin])
            .rpc();

          await connection.confirmTransaction(tx);

          const stateAfter = await program.account.receiverState.fetch(receiverProgramState);
          expect(stateAfter.relayerCount.toNumber()).to.equal(relayerCountBefore - 1);

          const isRelayer = await program.methods
            .isRelayer(relayer1.publicKey)
            .accounts({
              receiverState: receiverProgramState,
            })
            .view();

          expect(isRelayer).to.be.false;
        } catch (error) {
          expect.fail(`Remove relayer failed: ${error}`);
        }
      });
    });

    describe("TC-107: Submit Signature - Single Relayer", () => {
      it.skip("should submit signature successfully without unlocking", async () => {
        try {
          const eventData: StakeEventData = {
            sourceContract: senderProgram,
            targetContract: receiverProgram,
            chainId: SOURCE_CHAIN_ID,
            blockHeight: new BN(await connection.getBlockHeight()),
            amount: TEST_AMOUNT,
            receiverAddress: user2.publicKey.toBase58(),
            nonce: new BN(1),
          };

          const signature = generateSignature(eventData, relayer1ECDSA.ecdsaPrivateKey);
          const isValid = verifySignature(eventData, signature, relayer1ECDSA.ecdsaPublicKey);
          expect(isValid).to.be.true;

          const tx = await program.methods
            .submitSignature(
              eventData.sourceContract,
              eventData.targetContract,
              eventData.chainId,
              eventData.blockHeight,
              eventData.amount,
              eventData.receiverAddress,
              eventData.nonce,
              Array.from(signature)
            )
            .accounts({
              receiverState: receiverProgramState,
              relayer: relayer1.publicKey,
              receiver: user2.publicKey,
              vault: vault.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([relayer1])
            .rpc();

          await connection.confirmTransaction(tx);

          const receiverBalance = await getBalance(user2.publicKey);
          expect(receiverBalance).to.equal(0);
        } catch (error) {
          expect.fail(`Submit signature failed: ${error}`);
        }
      });
    });

    describe("TC-108: Submit Signature - Threshold Reached", () => {
      it.skip("should unlock when threshold is reached", async () => {
        try {
          const eventData: StakeEventData = {
            sourceContract: senderProgram,
            targetContract: receiverProgram,
            chainId: SOURCE_CHAIN_ID,
            blockHeight: new BN(await connection.getBlockHeight()),
            amount: TEST_AMOUNT,
            receiverAddress: user2.publicKey.toBase58(),
            nonce: new BN(2),
          };

          const signature1 = generateSignature(eventData, relayer1ECDSA.ecdsaPrivateKey);
          const signature2 = generateSignature(eventData, relayer2ECDSA.ecdsaPrivateKey);

          const tx1 = await program.methods
            .submitSignature(
              eventData.sourceContract,
              eventData.targetContract,
              eventData.chainId,
              eventData.blockHeight,
              eventData.amount,
              eventData.receiverAddress,
              eventData.nonce,
              Array.from(signature1)
            )
            .accounts({
              receiverState: receiverProgramState,
              relayer: relayer1.publicKey,
              receiver: user2.publicKey,
              vault: vault.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([relayer1])
            .rpc();

          await connection.confirmTransaction(tx1);

          const receiverBalanceBefore = await getBalance(user2.publicKey);

          const tx2 = await program.methods
            .submitSignature(
              eventData.sourceContract,
              eventData.targetContract,
              eventData.chainId,
              eventData.blockHeight,
              eventData.amount,
              eventData.receiverAddress,
              eventData.nonce,
              Array.from(signature2)
            )
            .accounts({
              receiverState: receiverProgramState,
              relayer: relayer2.publicKey,
              receiver: user2.publicKey,
              vault: vault.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([relayer2])
            .rpc();

          await connection.confirmTransaction(tx2);

          const receiverBalanceAfter = await getBalance(user2.publicKey);
          expect(receiverBalanceAfter).to.be.greaterThan(receiverBalanceBefore);

          const state = await program.account.receiverState.fetch(receiverProgramState);
          const usedNonces = state.usedNonces as any[];
          const nonceUsed = usedNonces.some((n) => n.eq(eventData.nonce));
          expect(nonceUsed).to.be.true;
        } catch (error) {
          expect.fail(`Threshold unlock failed: ${error}`);
        }
      });
    });

    describe("TC-109: Submit Signature - Duplicate Nonce", () => {
      it.skip("should reject duplicate nonce", async () => {
        try {
          const eventData: StakeEventData = {
            sourceContract: senderProgram,
            targetContract: receiverProgram,
            chainId: SOURCE_CHAIN_ID,
            blockHeight: new BN(await connection.getBlockHeight()),
            amount: TEST_AMOUNT,
            receiverAddress: user2.publicKey.toBase58(),
            nonce: new BN(2),
          };

          const signature = generateSignature(eventData, relayer1ECDSA.ecdsaPrivateKey);

          await program.methods
            .submitSignature(
              eventData.sourceContract,
              eventData.targetContract,
              eventData.chainId,
              eventData.blockHeight,
              eventData.amount,
              eventData.receiverAddress,
              eventData.nonce,
              Array.from(signature)
            )
            .accounts({
              receiverState: receiverProgramState,
              relayer: relayer1.publicKey,
              receiver: user2.publicKey,
              vault: vault.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([relayer1])
            .rpc();

          expect.fail("Should have thrown an error");
        } catch (error) {
          expect(error.message).to.include("NonceAlreadyUsed");
        }
      });
    });

    describe("TC-110: Submit Signature - Invalid Signature", () => {
      it.skip("should reject invalid signature", async () => {
        try {
          const eventData: StakeEventData = {
            sourceContract: senderProgram,
            targetContract: receiverProgram,
            chainId: SOURCE_CHAIN_ID,
            blockHeight: new BN(await connection.getBlockHeight()),
            amount: TEST_AMOUNT,
            receiverAddress: user2.publicKey.toBase58(),
            nonce: new BN(3),
          };

          const fakeKeypair = generateECDSAKeypair();
          const fakeSignature = generateSignature(eventData, fakeKeypair.privateKey);

          await program.methods
            .submitSignature(
              eventData.sourceContract,
              eventData.targetContract,
              eventData.chainId,
              eventData.blockHeight,
              eventData.amount,
              eventData.receiverAddress,
              eventData.nonce,
              Array.from(fakeSignature)
            )
            .accounts({
              receiverState: receiverProgramState,
              relayer: relayer1.publicKey,
              receiver: user2.publicKey,
              vault: vault.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([relayer1])
            .rpc();

          expect.fail("Should have thrown an error");
        } catch (error) {
          expect(error.message).to.include("InvalidSignature");
        }
      });
    });

    describe("TC-111: Submit Signature - Non-Whitelisted Relayer", () => {
      it.skip("should reject signature from non-whitelisted relayer", async () => {
        try {
          const eventData: StakeEventData = {
            sourceContract: senderProgram,
            targetContract: receiverProgram,
            chainId: SOURCE_CHAIN_ID,
            blockHeight: new BN(await connection.getBlockHeight()),
            amount: TEST_AMOUNT,
            receiverAddress: user2.publicKey.toBase58(),
            nonce: new BN(4),
          };

          const fakeKeypair = generateECDSAKeypair();
          const signature = generateSignature(eventData, fakeKeypair.privateKey);

          await program.methods
            .submitSignature(
              eventData.sourceContract,
              eventData.targetContract,
              eventData.chainId,
              eventData.blockHeight,
              eventData.amount,
              eventData.receiverAddress,
              eventData.nonce,
              Array.from(signature)
            )
            .accounts({
              receiverState: receiverProgramState,
              relayer: nonRelayer.publicKey,
              receiver: user2.publicKey,
              vault: vault.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([nonRelayer])
            .rpc();

          expect.fail("Should have thrown an error");
        } catch (error) {
          expect(error.message).to.include("NotWhitelisted");
        }
      });
    });

    describe("TC-112: Submit Signature - Wrong Source Contract Address", () => {
      it.skip("should reject signature with wrong source contract address", async () => {
        try {
          const wrongSourceContract = Keypair.generate().publicKey;
          const eventData: StakeEventData = {
            sourceContract: wrongSourceContract,
            targetContract: receiverProgram,
            chainId: SOURCE_CHAIN_ID,
            blockHeight: new BN(await connection.getBlockHeight()),
            amount: TEST_AMOUNT,
            receiverAddress: user2.publicKey.toBase58(),
            nonce: new BN(5),
          };

          const signature = generateSignature(eventData, relayer1ECDSA.ecdsaPrivateKey);

          await program.methods
            .submitSignature(
              eventData.sourceContract,
              eventData.targetContract,
              eventData.chainId,
              eventData.blockHeight,
              eventData.amount,
              eventData.receiverAddress,
              eventData.nonce,
              Array.from(signature)
            )
            .accounts({
              receiverState: receiverProgramState,
              relayer: relayer1.publicKey,
              receiver: user2.publicKey,
              vault: vault.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([relayer1])
            .rpc();

          expect.fail("Should have thrown an error");
        } catch (error) {
          expect(error.message).to.include("InvalidSourceContract");
        }
      });
    });

    describe("TC-113: Submit Signature - Wrong Chain ID", () => {
      it.skip("should reject signature with wrong chain ID", async () => {
        try {
          const wrongChainId = new BN(999999);
          const eventData: StakeEventData = {
            sourceContract: senderProgram,
            targetContract: receiverProgram,
            chainId: wrongChainId,
            blockHeight: new BN(await connection.getBlockHeight()),
            amount: TEST_AMOUNT,
            receiverAddress: user2.publicKey.toBase58(),
            nonce: new BN(6),
          };

          const signature = generateSignature(eventData, relayer1ECDSA.ecdsaPrivateKey);

          await program.methods
            .submitSignature(
              eventData.sourceContract,
              eventData.targetContract,
              eventData.chainId,
              eventData.blockHeight,
              eventData.amount,
              eventData.receiverAddress,
              eventData.nonce,
              Array.from(signature)
            )
            .accounts({
              receiverState: receiverProgramState,
              relayer: relayer1.publicKey,
              receiver: user2.publicKey,
              vault: vault.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([relayer1])
            .rpc();

          expect.fail("Should have thrown an error");
        } catch (error) {
          expect(error.message).to.include("InvalidChainId");
        }
      });
    });
  });

  describe("Integration Tests", () => {
    describe("IT-001: End-to-End Cross-Chain Transfer (EVM → SVM)", () => {
      it.skip("should complete full cross-chain transfer flow", async () => {
        try {
          const receiverAddress = user2.publicKey.toBase58();
          const startTime = Date.now();

          const stakeTx = await program.methods
            .stake(TEST_AMOUNT, receiverAddress)
            .accounts({
              senderState: senderProgramState,
              user: user1.publicKey,
              vault: vault.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([user1])
            .rpc();

          await connection.confirmTransaction(stakeTx);

          const state = await program.account.senderState.fetch(senderProgramState);
          const eventData: StakeEventData = {
            sourceContract: senderProgram,
            targetContract: receiverProgram,
            chainId: SOURCE_CHAIN_ID,
            blockHeight: new BN(await connection.getBlockHeight()),
            amount: TEST_AMOUNT,
            receiverAddress: receiverAddress,
            nonce: state.nonce,
          };

          const signature1 = generateSignature(eventData, relayer1ECDSA.ecdsaPrivateKey);
          const signature2 = generateSignature(eventData, relayer2ECDSA.ecdsaPrivateKey);

          const tx1 = await program.methods
            .submitSignature(
              eventData.sourceContract,
              eventData.targetContract,
              eventData.chainId,
              eventData.blockHeight,
              eventData.amount,
              eventData.receiverAddress,
              eventData.nonce,
              Array.from(signature1)
            )
            .accounts({
              receiverState: receiverProgramState,
              relayer: relayer1.publicKey,
              receiver: user2.publicKey,
              vault: vault.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([relayer1])
            .rpc();

          await connection.confirmTransaction(tx1);

          const tx2 = await program.methods
            .submitSignature(
              eventData.sourceContract,
              eventData.targetContract,
              eventData.chainId,
              eventData.blockHeight,
              eventData.amount,
              eventData.receiverAddress,
              eventData.nonce,
              Array.from(signature2)
            )
            .accounts({
              receiverState: receiverProgramState,
              relayer: relayer2.publicKey,
              receiver: user2.publicKey,
              vault: vault.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([relayer2])
            .rpc();

          await connection.confirmTransaction(tx2);

          const endTime = Date.now();
          const duration = endTime - startTime;
          expect(duration).to.be.lessThan(5 * 60 * 1000);

          const receiverBalance = await getBalance(user2.publicKey);
          expect(receiverBalance).to.be.greaterThan(0);
        } catch (error) {
          expect.fail(`End-to-end transfer failed: ${error}`);
        }
      });
    });

    describe("IT-002: End-to-End Cross-Chain Transfer (SVM → EVM)", () => {
      it.skip("should complete reverse cross-chain transfer flow", async () => {
        try {
          const receiverAddress = user1.publicKey.toBase58();

          const stakeTx = await program.methods
            .stake(TEST_AMOUNT, receiverAddress)
            .accounts({
              senderState: senderProgramState,
              user: user2.publicKey,
              vault: vault.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([user2])
            .rpc();

          await connection.confirmTransaction(stakeTx);

          const state = await program.account.senderState.fetch(senderProgramState);
          const eventData: StakeEventData = {
            sourceContract: senderProgram,
            targetContract: receiverProgram,
            chainId: SOURCE_CHAIN_ID,
            blockHeight: new BN(await connection.getBlockHeight()),
            amount: TEST_AMOUNT,
            receiverAddress: receiverAddress,
            nonce: state.nonce,
          };

          const signature1 = generateSignature(eventData, relayer1ECDSA.ecdsaPrivateKey);
          const signature2 = generateSignature(eventData, relayer2ECDSA.ecdsaPrivateKey);

          const tx1 = await program.methods
            .submitSignature(
              eventData.sourceContract,
              eventData.targetContract,
              eventData.chainId,
              eventData.blockHeight,
              eventData.amount,
              eventData.receiverAddress,
              eventData.nonce,
              Array.from(signature1)
            )
            .accounts({
              receiverState: receiverProgramState,
              relayer: relayer1.publicKey,
              receiver: user1.publicKey,
              vault: vault.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([relayer1])
            .rpc();

          await connection.confirmTransaction(tx1);

          const tx2 = await program.methods
            .submitSignature(
              eventData.sourceContract,
              eventData.targetContract,
              eventData.chainId,
              eventData.blockHeight,
              eventData.amount,
              eventData.receiverAddress,
              eventData.nonce,
              Array.from(signature2)
            )
            .accounts({
              receiverState: receiverProgramState,
              relayer: relayer2.publicKey,
              receiver: user1.publicKey,
              vault: vault.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([relayer2])
            .rpc();

          await connection.confirmTransaction(tx2);

          const receiverBalance = await getBalance(user1.publicKey);
          expect(receiverBalance).to.be.greaterThan(0);
        } catch (error) {
          expect.fail(`Reverse transfer failed: ${error}`);
        }
      });
    });

    describe("IT-003: Concurrent Cross-Chain Transfers", () => {
      it.skip("should handle concurrent transfers correctly", async () => {
        try {
          const promises: Promise<any>[] = [];
          const receiverAddresses: string[] = [];

          for (let i = 0; i < 10; i++) {
            const receiver = Keypair.generate();
            receiverAddresses.push(receiver.publicKey.toBase58());
            await airdrop(receiver.publicKey, AIRDROP_AMOUNT);

            promises.push(
              program.methods
                .stake(TEST_AMOUNT, receiver.publicKey.toBase58())
                .accounts({
                  senderState: senderProgramState,
                  user: user1.publicKey,
                  vault: vault.publicKey,
                  systemProgram: SystemProgram.programId,
                })
                .signers([user1])
                .rpc()
            );
          }

          const results = await Promise.all(promises);
          expect(results.length).to.equal(10);

          const state = await program.account.senderState.fetch(senderProgramState);
          expect(state.nonce.toNumber()).to.be.greaterThanOrEqual(10);

          const usedNonces = new Set<number>();
          for (let i = 1; i <= state.nonce.toNumber(); i++) {
            usedNonces.add(i);
          }
          expect(usedNonces.size).to.equal(state.nonce.toNumber());
        } catch (error) {
          expect.fail(`Concurrent transfers failed: ${error}`);
        }
      });
    });

    describe("IT-004: Large Amount Transfer Test", () => {
      it.skip("should handle large amount transfer", async () => {
        try {
          const receiverAddress = user2.publicKey.toBase58();

          const stakeTx = await program.methods
            .stake(LARGE_AMOUNT, receiverAddress)
            .accounts({
              senderState: senderProgramState,
              user: user1.publicKey,
              vault: vault.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([user1])
            .rpc();

          await connection.confirmTransaction(stakeTx);

          const state = await program.account.senderState.fetch(senderProgramState);
          const eventData: StakeEventData = {
            sourceContract: senderProgram,
            targetContract: receiverProgram,
            chainId: SOURCE_CHAIN_ID,
            blockHeight: new BN(await connection.getBlockHeight()),
            amount: LARGE_AMOUNT,
            receiverAddress: receiverAddress,
            nonce: state.nonce,
          };

          const signature1 = generateSignature(eventData, relayer1ECDSA.ecdsaPrivateKey);
          const signature2 = generateSignature(eventData, relayer2ECDSA.ecdsaPrivateKey);

          const tx1 = await program.methods
            .submitSignature(
              eventData.sourceContract,
              eventData.targetContract,
              eventData.chainId,
              eventData.blockHeight,
              eventData.amount,
              eventData.receiverAddress,
              eventData.nonce,
              Array.from(signature1)
            )
            .accounts({
              receiverState: receiverProgramState,
              relayer: relayer1.publicKey,
              receiver: user2.publicKey,
              vault: vault.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([relayer1])
            .rpc();

          await connection.confirmTransaction(tx1);

          const tx2 = await program.methods
            .submitSignature(
              eventData.sourceContract,
              eventData.targetContract,
              eventData.chainId,
              eventData.blockHeight,
              eventData.amount,
              eventData.receiverAddress,
              eventData.nonce,
              Array.from(signature2)
            )
            .accounts({
              receiverState: receiverProgramState,
              relayer: relayer2.publicKey,
              receiver: user2.publicKey,
              vault: vault.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([relayer2])
            .rpc();

          await connection.confirmTransaction(tx2);

          const receiverBalance = await getBalance(user2.publicKey);
          expect(receiverBalance).to.be.greaterThan(0);
        } catch (error) {
          expect.fail(`Large amount transfer failed: ${error}`);
        }
      });
    });
  });

  describe("Security Tests", () => {
    describe("ST-001: Replay Attack Defense", () => {
      it.skip("should reject replay attack", async () => {
        try {
          const receiverAddress = user2.publicKey.toBase58();
          const eventData: StakeEventData = {
            sourceContract: senderProgram,
            targetContract: receiverProgram,
            chainId: SOURCE_CHAIN_ID,
            blockHeight: new BN(await connection.getBlockHeight()),
            amount: TEST_AMOUNT,
            receiverAddress: receiverAddress,
            nonce: new BN(100),
          };

          const signature1 = generateSignature(eventData, relayer1ECDSA.ecdsaPrivateKey);
          const signature2 = generateSignature(eventData, relayer2ECDSA.ecdsaPrivateKey);

          const tx1 = await program.methods
            .submitSignature(
              eventData.sourceContract,
              eventData.targetContract,
              eventData.chainId,
              eventData.blockHeight,
              eventData.amount,
              eventData.receiverAddress,
              eventData.nonce,
              Array.from(signature1)
            )
            .accounts({
              receiverState: receiverProgramState,
              relayer: relayer1.publicKey,
              receiver: user2.publicKey,
              vault: vault.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([relayer1])
            .rpc();

          await connection.confirmTransaction(tx1);

          const tx2 = await program.methods
            .submitSignature(
              eventData.sourceContract,
              eventData.targetContract,
              eventData.chainId,
              eventData.blockHeight,
              eventData.amount,
              eventData.receiverAddress,
              eventData.nonce,
              Array.from(signature2)
            )
            .accounts({
              receiverState: receiverProgramState,
              relayer: relayer2.publicKey,
              receiver: user2.publicKey,
              vault: vault.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([relayer2])
            .rpc();

          await connection.confirmTransaction(tx2);

          await program.methods
            .submitSignature(
              eventData.sourceContract,
              eventData.targetContract,
              eventData.chainId,
              eventData.blockHeight,
              eventData.amount,
              eventData.receiverAddress,
              eventData.nonce,
              Array.from(signature1)
            )
            .accounts({
              receiverState: receiverProgramState,
              relayer: relayer1.publicKey,
              receiver: user2.publicKey,
              vault: vault.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([relayer1])
            .rpc();

          expect.fail("Should have thrown an error");
        } catch (error) {
          expect(error.message).to.include("NonceAlreadyUsed");
        }
      });
    });

    describe("ST-002: Signature Forgery Defense", () => {
      it.skip("should reject forged signature", async () => {
        try {
          const eventData: StakeEventData = {
            sourceContract: senderProgram,
            targetContract: receiverProgram,
            chainId: SOURCE_CHAIN_ID,
            blockHeight: new BN(await connection.getBlockHeight()),
            amount: TEST_AMOUNT,
            receiverAddress: user2.publicKey.toBase58(),
            nonce: new BN(200),
          };

          const attackerKeypair = generateECDSAKeypair();
          const forgedSignature = generateSignature(eventData, attackerKeypair.privateKey);

          await program.methods
            .submitSignature(
              eventData.sourceContract,
              eventData.targetContract,
              eventData.chainId,
              eventData.blockHeight,
              eventData.amount,
              eventData.receiverAddress,
              eventData.nonce,
              Array.from(forgedSignature)
            )
            .accounts({
              receiverState: receiverProgramState,
              relayer: relayer1.publicKey,
              receiver: user2.publicKey,
              vault: vault.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([relayer1])
            .rpc();

          expect.fail("Should have thrown an error");
        } catch (error) {
          expect(error.message).to.include("InvalidSignature");
        }
      });
    });

    describe("ST-003: Permission Control Test", () => {
      it.skip("should reject non-admin operations", async () => {
        try {
          await program.methods
            .addRelayer(relayer1.publicKey)
            .accounts({
              receiverState: receiverProgramState,
              admin: nonAdmin.publicKey,
            })
            .signers([nonAdmin])
            .rpc();

          expect.fail("Should have thrown an error");
        } catch (error) {
          expect(error.message).to.include("Unauthorized");
        }

        try {
          await program.methods
            .removeRelayer(relayer1.publicKey)
            .accounts({
              receiverState: receiverProgramState,
              admin: nonAdmin.publicKey,
            })
            .signers([nonAdmin])
            .rpc();

          expect.fail("Should have thrown an error");
        } catch (error) {
          expect(error.message).to.include("Unauthorized");
        }
      });
    });

    describe("ST-004: Vault Security Test", () => {
      it.skip("should prevent direct vault transfer", async () => {
        try {
          const transfer = SystemProgram.transfer({
            fromPubkey: vault.publicKey,
            toPubkey: user1.publicKey,
            lamports: LAMPORTS_PER_SOL,
          });

          const tx = new anchor.web3.Transaction().add(transfer);
          await anchor.web3.sendAndConfirmTransaction(connection, tx, [vault]);

          expect.fail("Should have thrown an error");
        } catch (error) {
          expect(error.message).to.include("Error");
        }
      });

      it.skip("should prevent over-unlock", async () => {
        try {
          const vaultBalance = await getBalance(vault.publicKey);
          const overAmount = new BN(vaultBalance * 2);

          const eventData: StakeEventData = {
            sourceContract: senderProgram,
            targetContract: receiverProgram,
            chainId: SOURCE_CHAIN_ID,
            blockHeight: new BN(await connection.getBlockHeight()),
            amount: overAmount,
            receiverAddress: user2.publicKey.toBase58(),
            nonce: new BN(300),
          };

          const signature1 = generateSignature(eventData, relayer1ECDSA.ecdsaPrivateKey);
          const signature2 = generateSignature(eventData, relayer2ECDSA.ecdsaPrivateKey);

          const tx1 = await program.methods
            .submitSignature(
              eventData.sourceContract,
              eventData.targetContract,
              eventData.chainId,
              eventData.blockHeight,
              eventData.amount,
              eventData.receiverAddress,
              eventData.nonce,
              Array.from(signature1)
            )
            .accounts({
              receiverState: receiverProgramState,
              relayer: relayer1.publicKey,
              receiver: user2.publicKey,
              vault: vault.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([relayer1])
            .rpc();

          await connection.confirmTransaction(tx1);

          await program.methods
            .submitSignature(
              eventData.sourceContract,
              eventData.targetContract,
              eventData.chainId,
              eventData.blockHeight,
              eventData.amount,
              eventData.receiverAddress,
              eventData.nonce,
              Array.from(signature2)
            )
            .accounts({
              receiverState: receiverProgramState,
              relayer: relayer2.publicKey,
              receiver: user2.publicKey,
              vault: vault.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([relayer2])
            .rpc();

          expect.fail("Should have thrown an error");
        } catch (error) {
          expect(error.message).to.include("InsufficientBalance");
        }
      });
    });

    describe("ST-005: Forged Event Defense", () => {
      it.skip("should reject forged event with wrong contract address", async () => {
        try {
          const fakeContract = Keypair.generate().publicKey;
          const eventData: StakeEventData = {
            sourceContract: fakeContract,
            targetContract: receiverProgram,
            chainId: SOURCE_CHAIN_ID,
            blockHeight: new BN(await connection.getBlockHeight()),
            amount: TEST_AMOUNT,
            receiverAddress: user2.publicKey.toBase58(),
            nonce: new BN(400),
          };

          const signature = generateSignature(eventData, relayer1ECDSA.ecdsaPrivateKey);

          await program.methods
            .submitSignature(
              eventData.sourceContract,
              eventData.targetContract,
              eventData.chainId,
              eventData.blockHeight,
              eventData.amount,
              eventData.receiverAddress,
              eventData.nonce,
              Array.from(signature)
            )
            .accounts({
              receiverState: receiverProgramState,
              relayer: relayer1.publicKey,
              receiver: user2.publicKey,
              vault: vault.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([relayer1])
            .rpc();

          expect.fail("Should have thrown an error");
        } catch (error) {
          expect(error.message).to.include("InvalidSourceContract");
        }
      });

      it.skip("should reject forged event with wrong chain ID", async () => {
        try {
          const fakeChainId = new BN(999999);
          const eventData: StakeEventData = {
            sourceContract: senderProgram,
            targetContract: receiverProgram,
            chainId: fakeChainId,
            blockHeight: new BN(await connection.getBlockHeight()),
            amount: TEST_AMOUNT,
            receiverAddress: user2.publicKey.toBase58(),
            nonce: new BN(500),
          };

          const signature = generateSignature(eventData, relayer1ECDSA.ecdsaPrivateKey);

          await program.methods
            .submitSignature(
              eventData.sourceContract,
              eventData.targetContract,
              eventData.chainId,
              eventData.blockHeight,
              eventData.amount,
              eventData.receiverAddress,
              eventData.nonce,
              Array.from(signature)
            )
            .accounts({
              receiverState: receiverProgramState,
              relayer: relayer1.publicKey,
              receiver: user2.publicKey,
              vault: vault.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([relayer1])
            .rpc();

          expect.fail("Should have thrown an error");
        } catch (error) {
          expect(error.message).to.include("InvalidChainId");
        }
      });
    });
  });

  describe("Performance Tests", () => {
    describe("PT-001: Event Listening Latency", () => {
      it.skip("should measure event listening latency", async () => {
        try {
          const receiverAddress = user2.publicKey.toBase58();
          const stakeStartTime = Date.now();

          const stakeTx = await program.methods
            .stake(TEST_AMOUNT, receiverAddress)
            .accounts({
              senderState: senderProgramState,
              user: user1.publicKey,
              vault: vault.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([user1])
            .rpc();

          await connection.confirmTransaction(stakeTx);
          const stakeEndTime = Date.now();

          const latency = stakeEndTime - stakeStartTime;
          expect(latency).to.be.lessThan(30 * 1000);
        } catch (error) {
          expect.fail(`Event listening latency test failed: ${error}`);
        }
      });
    });

    describe("PT-002: Signature Submission Latency", () => {
      it.skip("should measure signature submission latency", async () => {
        try {
          const receiverAddress = user2.publicKey.toBase58();
          const eventData: StakeEventData = {
            sourceContract: senderProgram,
            targetContract: receiverProgram,
            chainId: SOURCE_CHAIN_ID,
            blockHeight: new BN(await connection.getBlockHeight()),
            amount: TEST_AMOUNT,
            receiverAddress: receiverAddress,
            nonce: new BN(600),
          };

          const signature = generateSignature(eventData, relayer1ECDSA.ecdsaPrivateKey);
          const submitStartTime = Date.now();

          const tx = await program.methods
            .submitSignature(
              eventData.sourceContract,
              eventData.targetContract,
              eventData.chainId,
              eventData.blockHeight,
              eventData.amount,
              eventData.receiverAddress,
              eventData.nonce,
              Array.from(signature)
            )
            .accounts({
              receiverState: receiverProgramState,
              relayer: relayer1.publicKey,
              receiver: user2.publicKey,
              vault: vault.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([relayer1])
            .rpc();

          await connection.confirmTransaction(tx);
          const submitEndTime = Date.now();

          const latency = submitEndTime - submitStartTime;
          expect(latency).to.be.lessThan(60 * 1000);
        } catch (error) {
          expect.fail(`Signature submission latency test failed: ${error}`);
        }
      });
    });

    describe("PT-003: End-to-End Latency", () => {
      it.skip("should measure end-to-end latency", async () => {
        try {
          const receiverAddress = user2.publicKey.toBase58();
          const startTime = Date.now();

          const stakeTx = await program.methods
            .stake(TEST_AMOUNT, receiverAddress)
            .accounts({
              senderState: senderProgramState,
              user: user1.publicKey,
              vault: vault.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([user1])
            .rpc();

          await connection.confirmTransaction(stakeTx);

          const state = await program.account.senderState.fetch(senderProgramState);
          const eventData: StakeEventData = {
            sourceContract: senderProgram,
            targetContract: receiverProgram,
            chainId: SOURCE_CHAIN_ID,
            blockHeight: new BN(await connection.getBlockHeight()),
            amount: TEST_AMOUNT,
            receiverAddress: receiverAddress,
            nonce: state.nonce,
          };

          const signature1 = generateSignature(eventData, relayer1ECDSA.ecdsaPrivateKey);
          const signature2 = generateSignature(eventData, relayer2ECDSA.ecdsaPrivateKey);

          const tx1 = await program.methods
            .submitSignature(
              eventData.sourceContract,
              eventData.targetContract,
              eventData.chainId,
              eventData.blockHeight,
              eventData.amount,
              eventData.receiverAddress,
              eventData.nonce,
              Array.from(signature1)
            )
            .accounts({
              receiverState: receiverProgramState,
              relayer: relayer1.publicKey,
              receiver: user2.publicKey,
              vault: vault.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([relayer1])
            .rpc();

          await connection.confirmTransaction(tx1);

          const tx2 = await program.methods
            .submitSignature(
              eventData.sourceContract,
              eventData.targetContract,
              eventData.chainId,
              eventData.blockHeight,
              eventData.amount,
              eventData.receiverAddress,
              eventData.nonce,
              Array.from(signature2)
            )
            .accounts({
              receiverState: receiverProgramState,
              relayer: relayer2.publicKey,
              receiver: user2.publicKey,
              vault: vault.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([relayer2])
            .rpc();

          await connection.confirmTransaction(tx2);

          const endTime = Date.now();
          const latency = endTime - startTime;
          expect(latency).to.be.lessThan(5 * 60 * 1000);
        } catch (error) {
          expect.fail(`End-to-end latency test failed: ${error}`);
        }
      });
    });

    describe("PT-004: Throughput Test", () => {
      it.skip("should handle high throughput", async () => {
        try {
          const startTime = Date.now();
          const transferCount = 100;
          let successCount = 0;

          for (let i = 0; i < transferCount; i++) {
            try {
              const receiver = Keypair.generate();
              await airdrop(receiver.publicKey, AIRDROP_AMOUNT);

              const stakeTx = await program.methods
                .stake(TEST_AMOUNT, receiver.publicKey.toBase58())
                .accounts({
                  senderState: senderProgramState,
                  user: user1.publicKey,
                  vault: vault.publicKey,
                  systemProgram: SystemProgram.programId,
                })
                .signers([user1])
                .rpc();

              await connection.confirmTransaction(stakeTx);
              successCount++;
            } catch (error) {
              console.error(`Transfer ${i} failed: ${error}`);
            }
          }

          const endTime = Date.now();
          const duration = endTime - startTime;
          const throughput = (successCount / duration) * 3600 * 1000;

          expect(throughput).to.be.greaterThan(100);
        } catch (error) {
          expect.fail(`Throughput test failed: ${error}`);
        }
      });
    });
  });

  describe("Cryptographic Helper Tests", () => {
    describe("Hash Consistency Test", () => {
      it("should produce consistent hash for same event data", () => {
        const eventData: StakeEventData = {
          sourceContract: senderProgram,
          targetContract: receiverProgram,
          chainId: SOURCE_CHAIN_ID,
          blockHeight: new BN(100),
          amount: TEST_AMOUNT,
          receiverAddress: user1.publicKey.toBase58(),
          nonce: new BN(1),
        };

        const hash1 = hashEventData(eventData);
        const hash2 = hashEventData(eventData);

        expect(hash1.toString("hex")).to.equal(hash2.toString("hex"));
      });
    });

    describe("ECDSA Signature Generation and Verification Test", () => {
      it("should generate and verify signature correctly", () => {
        const eventData: StakeEventData = {
          sourceContract: senderProgram,
          targetContract: receiverProgram,
          chainId: SOURCE_CHAIN_ID,
          blockHeight: new BN(100),
          amount: TEST_AMOUNT,
          receiverAddress: user1.publicKey.toBase58(),
          nonce: new BN(1),
        };

        const keypair = generateECDSAKeypair();
        const signature = generateSignature(eventData, keypair.privateKey);
        const isValid = verifySignature(eventData, signature, keypair.publicKey);

        expect(isValid).to.be.true;
      });

      it("should reject invalid signature", () => {
        const eventData: StakeEventData = {
          sourceContract: senderProgram,
          targetContract: receiverProgram,
          chainId: SOURCE_CHAIN_ID,
          blockHeight: new BN(100),
          amount: TEST_AMOUNT,
          receiverAddress: user1.publicKey.toBase58(),
          nonce: new BN(1),
        };

        const keypair1 = generateECDSAKeypair();
        const keypair2 = generateECDSAKeypair();
        const signature = generateSignature(eventData, keypair1.privateKey);
        const isValid = verifySignature(eventData, signature, keypair2.publicKey);

        expect(isValid).to.be.false;
      });
    });

    describe("Threshold Calculation Test", () => {
      it("should calculate threshold correctly", () => {
        expect(calculateThreshold(3)).to.equal(2);
        expect(calculateThreshold(4)).to.equal(3);
        expect(calculateThreshold(5)).to.equal(4);
        expect(calculateThreshold(6)).to.equal(4);
        expect(calculateThreshold(7)).to.equal(5);
      });
    });

    describe("Event Data Serialization Test", () => {
      it("should serialize event data correctly", () => {
        const eventData: StakeEventData = {
          sourceContract: senderProgram,
          targetContract: receiverProgram,
          chainId: SOURCE_CHAIN_ID,
          blockHeight: new BN(100),
          amount: TEST_AMOUNT,
          receiverAddress: user1.publicKey.toBase58(),
          nonce: new BN(1),
        };

        const serialized = serializeEventData(eventData);
        expect(serialized.length).to.be.greaterThan(0);

        const hash = hashEventData(eventData);
        expect(hash.length).to.equal(32);
      });
    });

    describe("Signature Uniqueness Test", () => {
      it("should produce different signatures for different event data", () => {
        const eventData1: StakeEventData = {
          sourceContract: senderProgram,
          targetContract: receiverProgram,
          chainId: SOURCE_CHAIN_ID,
          blockHeight: new BN(100),
          amount: TEST_AMOUNT,
          receiverAddress: user1.publicKey.toBase58(),
          nonce: new BN(1),
        };

        const eventData2: StakeEventData = {
          sourceContract: senderProgram,
          targetContract: receiverProgram,
          chainId: SOURCE_CHAIN_ID,
          blockHeight: new BN(100),
          amount: TEST_AMOUNT,
          receiverAddress: user1.publicKey.toBase58(),
          nonce: new BN(2),
        };

        const keypair = generateECDSAKeypair();
        const signature1 = generateSignature(eventData1, keypair.privateKey);
        const signature2 = generateSignature(eventData2, keypair.privateKey);

        expect(signature1.toString("hex")).to.not.equal(signature2.toString("hex"));
      });
    });
  });
});


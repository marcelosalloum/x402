import {
  rpc,
  Networks,
  Keypair,
  nativeToScVal,
  TransactionBuilder,
  Contract,
} from "@stellar/stellar-sdk";
import { getCryptoPrice } from "./utils.js";

const STROOPS_PER_XLM = 10_000_000;

export type StellarNetwork = "stellar-testnet" | "stellar-mainnet";

interface NetworkConfig {
  rpcUrl: string;
  networkPassphrase: string;
  nativeXlmTokenContract: string;
  testWallet: {
    secret: string;
    public: string;
  };
}

const testWallets = {
  source: {
    secret: "SBZHWNUIF546QRIUMZ2JA5U42WSNWOZPRSSSRSMA4GF2HFGKOHFOO5XH",
    public: "GAQPBE3LXAMZZ2KBRDAILOZ26Q5Y7VGUP7V3C3JTJF4IUZDB75FTMFIE",
  },
  destination: {
    public: "GCHEI4PQEFJOA27MNZRPQNLGURS6KASW76X5UZCUZIXCOJLKXYCXOR2W",
  },
};

const networkConfigs: Record<StellarNetwork, NetworkConfig> = {
  "stellar-testnet": {
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: Networks.TESTNET,
    nativeXlmTokenContract:
      "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    testWallet: testWallets.source,
  },
  "stellar-mainnet": {
    rpcUrl: "https://mainnet.sorobanrpc.com",
    networkPassphrase: Networks.PUBLIC,
    nativeXlmTokenContract:
      "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA",
    testWallet: testWallets.source,
  },
};

export interface StellarCostEstimate {
  network: StellarNetwork;
  tokenLabel: string;
  tokenContract: string;
  xlmUsdPrice: number;
  simulatedFeeStroops: number;
  simulatedFeeXlm: string;
  simulatedFeeUsdc: string;
  isSponsored: boolean;
  isSimulated: boolean;
}

export async function getStellarFeeCost(
  network: StellarNetwork = "stellar-testnet",
  isSponsored: boolean = false,
  customRpcUrl?: string,
  tokenContractOverride?: string
): Promise<StellarCostEstimate> {
  const config = networkConfigs[network];

  const livePrice = await getCryptoPrice("XLM");
  const xlmUsdPrice = livePrice > 0 ? livePrice : 0.25;

  const tokenContract = tokenContractOverride ?? config.nativeXlmTokenContract;
  const tokenLabel = tokenContractOverride ? "custom-token" : "native-xlm";

  if (isSponsored) {
    return {
      network,
      tokenLabel,
      tokenContract,
      xlmUsdPrice,
      simulatedFeeStroops: 0,
      simulatedFeeXlm: "0",
      simulatedFeeUsdc: "0.000000",
      isSponsored: true,
      isSimulated: false,
    };
  }

  const rpcUrl = customRpcUrl ?? config.rpcUrl;
  const server = new rpc.Server(rpcUrl);

  let simulatedFee = 0;
  let isSimulated = false;

  try {
    const sourceKeypair = Keypair.fromSecret(config.testWallet.secret);
    const destinationPublic = testWallets.destination.public;

    const sourceAccount = await server.getAccount(sourceKeypair.publicKey());

    const contract = new Contract(tokenContract);
    const transferOp = contract.call(
      "transfer",
      nativeToScVal(sourceKeypair.publicKey(), { type: "address" }),
      nativeToScVal(destinationPublic, { type: "address" }),
      nativeToScVal("1000000", { type: "i128" })
    );

    const transaction = new TransactionBuilder(sourceAccount, {
      fee: "100",
      networkPassphrase: config.networkPassphrase,
    })
      .addOperation(transferOp)
      .setTimeout(30)
      .build();

    const simulation = await server.simulateTransaction(transaction);

    if (rpc.Api.isSimulationSuccess(simulation)) {
      const resourceFee = Number(simulation.minResourceFee);
      const feeStats = await server.getFeeStats();
      const inclusionFee = Number(
        feeStats.sorobanInclusionFee.p95 || feeStats.sorobanInclusionFee.max
      );

      simulatedFee = resourceFee + inclusionFee;
      isSimulated = true;
    } else {
      console.warn("❌ Simulation failed - using fallback fee");
      simulatedFee = 70000;
    }
  } catch (error) {
    console.error(
      "❌ Simulation crashed:",
      error instanceof Error ? error.message : error
    );
    simulatedFee = 92000;
  }

  const feeXlm = simulatedFee / STROOPS_PER_XLM;

  return {
    network,
    tokenLabel,
    tokenContract,
    xlmUsdPrice,
    simulatedFeeStroops: simulatedFee,
    simulatedFeeXlm: feeXlm.toFixed(7),
    simulatedFeeUsdc: (feeXlm * xlmUsdPrice).toFixed(6),
    isSponsored: false,
    isSimulated,
  };
}


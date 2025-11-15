import { describe, it, expect } from "vitest";
import { Api } from "@stellar/stellar-sdk/rpc";
import { handleSimulationResult } from "./shared";
import { SorobanDataBuilder, xdr } from "@stellar/stellar-sdk";

describe("Stellar Shared Utilities", () => {
  describe("handleSimulationResult", () => {
    it("should throw error when simulation is undefined", () => {
      expect(() => handleSimulationResult(undefined)).toThrow("Simulation result is undefined");
    });

    it("should throw error when simulation has type RESTORE", () => {
      const mockRestoreSimulation: Api.SimulateTransactionResponse = {
        id: "test-id",
        latestLedger: 12345,
        events: [],
        _parsed: true,
        result: {
          auth: [],
          retval: xdr.ScVal.scvVoid(),
        },
        restorePreamble: {
          minResourceFee: "100",
          transactionData: new SorobanDataBuilder(),
        },
        transactionData: new SorobanDataBuilder(),
        minResourceFee: "100",
      } as Api.SimulateTransactionRestoreResponse;

      expect(() => handleSimulationResult(mockRestoreSimulation)).toThrow(
        /Stellar simulation result has type "RESTORE"/,
      );
    });

    it("should throw error when simulation has type ERROR", () => {
      const mockErrorSimulation: Api.SimulateTransactionResponse = {
        id: "test-id",
        latestLedger: 12345,
        _parsed: true,
        error: "Transaction simulation failed: insufficient balance",
      } as Api.SimulateTransactionErrorResponse;

      expect(() => handleSimulationResult(mockErrorSimulation)).toThrow(
        /Stellar simulation failed with error message: Transaction simulation failed: insufficient balance/,
      );
    });

    it("should handle simulation with empty error message", () => {
      const mockErrorSimulation: Api.SimulateTransactionResponse = {
        id: "test-id",
        latestLedger: 12345,
        _parsed: true,
        error: "",
      } as Api.SimulateTransactionErrorResponse;

      expect(() => handleSimulationResult(mockErrorSimulation)).toThrow(
        /Stellar simulation failed/,
      );
    });

    it("should not throw error when simulation is successful", () => {
      const mockSuccessSimulation: Api.SimulateTransactionResponse = {
        id: "test-id",
        latestLedger: 12345,
        events: [],
        _parsed: true,
        transactionData: new SorobanDataBuilder(),
        minResourceFee: "100",
      } as Api.SimulateTransactionSuccessResponse;

      expect(() => handleSimulationResult(mockSuccessSimulation)).not.toThrow();
    });
  });
});

import { describe, expect, it } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { createStellarSigner, isEd25519Signer } from "./signer";

describe("Stellar Ed25519 Signer", () => {
  const validSecret = "SA6LFVPCYMDQILBRXQ2B2HRPK6DV2TX4FTQQQHWFPSCSY4H2RTCD3XAK";
  const validPublicKey = "GDEDUVINLPX4AN7HYK3MZGY6YDQSNVJT657CVWHEM3QMAH4QHSGLIHVI";

  describe("createStellarSigner", () => {
    it("should create a valid signer from a valid secret key", () => {
      const signer = createStellarSigner(validSecret);

      expect(signer).toBeDefined();
      expect(signer).toBeInstanceOf(Keypair);
      expect(signer.publicKey()).toBe(validPublicKey);
      expect(signer.secret()).toBe(validSecret);
    });

    it("should create signers with different public keys for different secret keys", () => {
      const secret1 = "SA6LFVPCYMDQILBRXQ2B2HRPK6DV2TX4FTQQQHWFPSCSY4H2RTCD3XAK";
      const secret2 = "SBFCBBFETW6U5HSOADUUXTQMUEXK7DIQLLATM6OVKKBQNG3I3EWIYJAW";

      const signer1 = createStellarSigner(secret1);
      const signer2 = createStellarSigner(secret2);

      expect(signer1.publicKey()).not.toBe(signer2.publicKey());
      expect(signer1.secret()).toBe(secret1);
      expect(signer2.secret()).toBe(secret2);
    });

    it("should throw error for invalid secret key format", () => {
      const invalidSecret = "INVALID_SECRET_KEY";
      expect(() => createStellarSigner(invalidSecret)).toThrow();
    });

    it("should throw error for empty string", () => {
      expect(() => createStellarSigner("")).toThrow();
    });

    it("should throw error for public key instead of secret key", () => {
      expect(() => createStellarSigner(validPublicKey)).toThrow();
    });

    it("should throw error for malformed secret key", () => {
      const malformedSecret = "SA6LFVPCYMDQILBRXQ2B2HRPK6DV2TX4FTQQQHWFPSCSY4H2RTCD3XA";
      expect(() => createStellarSigner(malformedSecret)).toThrow();
    });
  });

  describe("isEd25519Signer", () => {
    describe("returns true for valid signers", () => {
      it("should return true for a Keypair created from a valid secret key", () => {
        const signer = createStellarSigner(validSecret);
        expect(isEd25519Signer(signer)).toBe(true);
      });

      it("should return true for a Keypair created directly with Keypair.fromSecret", () => {
        const signer = Keypair.fromSecret(validSecret);
        expect(isEd25519Signer(signer)).toBe(true);
      });

      it("should return true for a randomly generated Keypair", () => {
        const signer = Keypair.random();
        expect(isEd25519Signer(signer)).toBe(true);
      });
    });

    describe("returns false for invalid signers", () => {
      it("should return false for a Keypair created from public key only", () => {
        const publicOnlyKeypair = Keypair.fromPublicKey(validPublicKey);
        expect(isEd25519Signer(publicOnlyKeypair)).toBe(false);
      });

      it("should return false for null", () => {
        expect(isEd25519Signer(null)).toBe(false);
      });

      it("should return false for undefined", () => {
        expect(isEd25519Signer(undefined)).toBe(false);
      });

      it("should return false for a string", () => {
        expect(isEd25519Signer(validSecret)).toBe(false);
      });

      it("should return false for an object with similar structure but not a Keypair", () => {
        const fakeKeypair = {
          publicKey: () => validPublicKey,
          secret: () => validSecret,
        };
        expect(isEd25519Signer(fakeKeypair)).toBe(false);
      });
    });
  });
});

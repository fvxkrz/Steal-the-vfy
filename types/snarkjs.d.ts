declare module 'snarkjs' {
  export const groth16: {
    fullProve(input: Record<string, string | string[]>, wasm: string, zkey: string,
      logger?: unknown, witnessOptions?: unknown, options?: { singleThread?: boolean }): Promise<{
        proof: Record<string, unknown>; publicSignals: string[];
      }>;
    verify(vk: Record<string, unknown>, signals: string[], proof: Record<string, unknown>,
      logger?: unknown, options?: { singleThread?: boolean }): Promise<boolean>;
  };
  export const zKey: { exportVerificationKey(path: string): Promise<Record<string, unknown>> };
}

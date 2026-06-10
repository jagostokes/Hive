// verifiers: objective, deterministic checks of sub-agent output. A verified
// failure is what triggers escalation to a stronger model.
export {
  sqlVerifier,
  insightVerifier,
  planVerifier,
  renderVerifier,
  type VerifierResult,
  type SqlVerifierOptions,
  type PoolLike,
  type PoolClientLike,
  type QueryResultLike,
  type ResultSchema,
} from "./verifiers.js";

// Verifier genesis (recursive testing): the system that grows new tests.
export {
  synthesizeVerifier,
  validatePredicate,
  performGenesis,
  runSynthesizedVerifiers,
  saveSynthesizedVerifier,
  loadActiveVerifiers,
  loadAllVerifiers,
  recordVerifierOutcome,
  deactivateVerifier,
  type SynthesizedVerifier,
  type GenesisInput,
  type GenesisResult,
  type ValidationResult,
  type SynthesizedCheckResult,
} from "./verifierGenesis.js";

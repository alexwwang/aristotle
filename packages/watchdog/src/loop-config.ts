/**
 * Loop configuration for TDD Pipeline Checkpoint Integration.
 *
 * Parses loopPhases config from watchdog.jsonc, produces PhaseLoopMap
 * for use in transitions, intercept-rules, and checkpoint modules.
 *
 * Shared contracts defined per Phase 2 Technical Solution §Shared Contracts.
 */

/** Loop type for a pipeline phase. Determines validation + apply behavior. */
export type LoopType = 'ralph' | 'followup'

/** Phase → LoopType mapping. Immutable per pipeline run. */
export type PhaseLoopMap = Record<number, LoopType>

/** Result of parsing loopPhases config. */
export interface LoopConfigResult {
  loopPhaseMap: PhaseLoopMap
  /** undefined when loopPhases config is missing. PipelineState writes totalPhases as fallback. */
  maxPhase: number | undefined
}

/** Error from invalid loopPhases config. */
export interface LoopConfigError {
  error: true
  message: string
}

/** Type guard: distinguish LoopConfigError from LoopConfigResult. */
export function isLoopConfigError(result: LoopConfigResult | LoopConfigError): result is LoopConfigError {
  return typeof result === 'object' && result !== null && 'error' in result && result.error === true
}

/** Config validation error — thrown when loopPhases config is present but invalid. */
export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigValidationError'
  }
}

/** Helper: create an error result. */
function configError(message: string): LoopConfigError {
  return { error: true, message }
}

/** Valid loopType strings. */
const VALID_LOOP_TYPES = new Set<string>(['ralph', 'followup'])

/**
 * Parse and validate loopPhases config from watchdog.jsonc.
 * Returns LoopConfigResult on success or LoopConfigError on validation failure.
 */
export function parseLoopPhases(loopPhases: unknown): LoopConfigResult | LoopConfigError {
  // Step 1: Handle missing/undefined config → empty map + undefined maxPhase
  if (loopPhases === undefined) {
    return { loopPhaseMap: {}, maxPhase: undefined }
  }

  // Step 2: Reject null
  if (loopPhases === null) {
    return configError('loopPhases config must be an object, got null')
  }

  // Step 3: Reject non-objects (primitives) and arrays separately for precise messages
  if (typeof loopPhases !== 'object') {
    return configError(`loopPhases config must be an object, got ${typeof loopPhases}`)
  }
  if (Array.isArray(loopPhases)) {
    return configError('loopPhases config must be a plain object (e.g. {ralph:[1,2,3], followup:[4]}), not an array')
  }

  const config = loopPhases as Record<string, unknown>

  // Step 4: Reject empty object (no keys)
  if (Object.keys(config).length === 0) {
    return configError('loopPhases config is empty — must contain at least one loopType group (ralph and/or followup)')
  }

  // Step 5: Validate all keys are known loopTypes
  for (const key of Object.keys(config)) {
    if (!VALID_LOOP_TYPES.has(key)) {
      return configError(`Unknown loopType "${key}" in loopPhases config. Valid types: ralph, followup`)
    }
  }

  // Step 6: Validate each value is an array
  for (const [key, value] of Object.entries(config)) {
    if (!Array.isArray(value)) {
      return configError(`loopPhases.${key} must be an array of phase numbers, got ${typeof value}`)
    }
  }

  // Step 7: Validate array elements are positive integers
  for (const [key, arr] of Object.entries(config)) {
    for (let i = 0; i < (arr as unknown[]).length; i++) {
      const el = (arr as unknown[])[i]
      if (typeof el !== 'number' || !Number.isInteger(el)) {
        return configError(`loopPhases.${key}[${i}] must be an integer, got ${el}`)
      }
      if ((el as number) <= 0) {
        return configError(`loopPhases.${key}[${i}] must be a positive integer, got ${el}`)
      }
    }
  }

  // Step 8: Reject empty arrays
  for (const [key, arr] of Object.entries(config)) {
    if ((arr as unknown[]).length === 0) {
      return configError(`loopPhases.${key} is an empty array — each group must contain at least one phase`)
    }
  }

  // Step 9: Reject duplicates within group
  for (const [key, arr] of Object.entries(config)) {
    const seen = new Set<number>()
    for (const el of arr as number[]) {
      if (seen.has(el)) {
        return configError(`loopPhases.${key} contains duplicate phase ${el}`)
      }
      seen.add(el)
    }
  }

  // Step 10: Build unified map and check for overlaps across groups
  const map: PhaseLoopMap = {}
  for (const [loopType, arr] of Object.entries(config)) {
    for (const phase of arr as number[]) {
      if (phase in map) {
        return configError(`Phase ${phase} appears in both "${map[phase]}" and "${loopType}" groups (overlapping). Each phase must belong to exactly one loopType.`)
      }
      map[phase] = loopType as LoopType
    }
  }

  // Step 11: Check for gaps in phase sequence (minPhase must be 1)
  const allPhases = Object.keys(map).map(Number).sort((a, b) => a - b)
  if (allPhases[0] !== 1) {
    return configError(`Phase sequence must start at 1, but first phase is ${allPhases[0]}`)
  }
  for (let i = 1; i < allPhases.length; i++) {
    if (allPhases[i] !== allPhases[i - 1] + 1) {
      return configError(`Gap in phase sequence: phases ${allPhases[i - 1]} and ${allPhases[i]} are not consecutive`)
    }
  }

  // Step 12: Phase 4 must be ralph (TDD invariant — Phase 4 is always test code review)
  if (map[4] === 'followup') {
    return configError('Phase 4 cannot be followup — Phase 4 (Test Code) always requires a Ralph review loop')
  }

  // Compute maxPhase from the highest phase number
  const maxPhase = allPhases.length > 0 ? allPhases[allPhases.length - 1] : undefined

  return { loopPhaseMap: map, maxPhase }
}

/**
 * Get the loop type for a given phase from state.
 * Returns 'ralph' for any phase not in the map (legacy fallback).
 * Works with structural type — only needs { loopPhaseMap?: PhaseLoopMap }.
 */
export function getLoopType(state: { loopPhaseMap?: PhaseLoopMap }, phase: number): LoopType {
  const map = state.loopPhaseMap
  if (!map) return 'ralph'
  // JSON.parse produces string keys; number access coerces to string lookup
  const value = map[phase]
  if (value === undefined) return 'ralph'
  // Design note: returns raw value without validating known LoopType strings.
  // Safe because parseLoopPhases (step 5) guarantees only 'ralph'|'followup'.
  // Defense-in-depth option: add `else if (value === 'ralph')` guard in callers
  // (e.g. ralph_loop_start validate) to reject unknown values — currently not
  // needed since corrupted loopPhaseMap is not producible through normal flow.
  return value
}



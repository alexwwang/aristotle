/**
 * TaskTemplateRegistry — stores and retrieves task template schemas.
 * Phase 5 implementation: 11 templates (T-1..T-10 + T-7b).
 */

export interface TemplateSchema {
  id: string
  name: string
  trigger: string
  subagent_type: string
  timeout: number
  input_schema: Record<string, unknown>
  output_schema: Record<string, unknown>
  role_definition: string
  instruction_template: string
  is_mcp_internal: boolean
}

export interface ValidationResult {
  valid: boolean
  errors?: string[]
}

// Per-template parameter schemas (Phase 2 spec §Per-Template Parameter Naming Convention)
// Each schema lists required params with their JS types ('number'|'string'|'object'|'array')
interface ParamSpec {
  type: 'number' | 'string' | 'object' | 'array' | 'boolean'
}

const T1_PARAMS: Record<string, ParamSpec> = {
  phase: { type: 'number' },
  round: { type: 'number' },
  runId: { type: 'string' },
  projectId: { type: 'string' },
  scope: { type: 'string' },
}

const T2_PARAMS: Record<string, ParamSpec> = {
  phase: { type: 'number' },
  round: { type: 'number' },
  runId: { type: 'string' },
  projectId: { type: 'string' },
}

const T3_PARAMS: Record<string, ParamSpec> = {
  file_path: { type: 'string' },
  size: { type: 'number' },
  language: { type: 'string' },
}

const T4_PARAMS: Record<string, ParamSpec> = {
  files: { type: 'array' },
  run_id: { type: 'string' },
  phase: { type: 'number' },
  violation_type: { type: 'string' },
  boundary_commit: { type: 'string' },
}

const T5_PARAMS: Record<string, ParamSpec> = {
  violationType: { type: 'string' },
  occurrences: { type: 'number' },
  patternWindow: { type: 'number' },
  runId: { type: 'string' },
  phase: { type: 'number' },
}

const T6_PARAMS: Record<string, ParamSpec> = {
  phase: { type: 'number' },
  run_id: { type: 'string' },
  events: { type: 'array' },
}

const T7_PARAMS: Record<string, ParamSpec> = {
  module_path: { type: 'string' },
  requirements: { type: 'string' },
  design_doc: { type: 'string' },
  language: { type: 'string' },
}

const T7B_PARAMS: Record<string, ParamSpec> = {
  violation_type: { type: 'string' },
  files: { type: 'array' },
  phase: { type: 'number' },
  run_id: { type: 'string' },
}

const T7B_OPTIONAL = new Set<string>(['design_doc_path'])

const T8_PARAMS: Record<string, ParamSpec> = {
  module_path: { type: 'string' },
  test_files: { type: 'array' },
  design_doc: { type: 'string' },
  language: { type: 'string' },
}

const T9_PARAMS: Record<string, ParamSpec> = {
  raw_findings: { type: 'array' },
  location_map: { type: 'object' },
  review_scope: { type: 'object' },
}

const T10_PARAMS: Record<string, ParamSpec> = {
  confirmed_findings: { type: 'array' },
  deliverable: { type: 'object' },
  context: { type: 'object' },
}

// T-1 optional location_map (Dual-Pass mode only)
const T1_OPTIONAL = new Set<string>(['location_map'])

function makeInputSchema(params: Record<string, ParamSpec>, optional: Set<string> = new Set()): Record<string, unknown> {
  const required: string[] = []
  const properties: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(params)) {
    properties[k] = { type: v.type }
    if (!optional.has(k)) required.push(k)
  }
  return { type: 'object', properties, required }
}

const T1_INPUT = makeInputSchema(T1_PARAMS, T1_OPTIONAL)
const T2_INPUT = makeInputSchema(T2_PARAMS)
const T3_INPUT = makeInputSchema(T3_PARAMS)
const T4_INPUT = makeInputSchema(T4_PARAMS)
const T5_INPUT = makeInputSchema(T5_PARAMS)
const T6_INPUT = makeInputSchema(T6_PARAMS)
const T7_INPUT = makeInputSchema(T7_PARAMS)
const T7B_INPUT = makeInputSchema(T7B_PARAMS, T7B_OPTIONAL)
const T8_INPUT = makeInputSchema(T8_PARAMS)
const T9_INPUT = makeInputSchema(T9_PARAMS)
const T10_INPUT = makeInputSchema(T10_PARAMS)

const T2_ROLE = `You are a strict code reviewer with deep expertise in software quality, security, and TDD methodology.

## Your Role
- You review code changes against design requirements and TDD protocol
- You classify findings by severity: C (Critical), H (High), M (Medium), P (Proposal), L (Low), I (Info)
- You provide specific, actionable suggestions with file locations

## Your Constraints
- Focus only on the review scope provided
- Do not modify any files — you are read-only
- Return findings as structured JSON array

## Output Format
Return a JSON array of findings:
[{"id": "F-01", "severity": "C|H|M|P|L|I", "description": "...", "location": "file:line", "suggestion": "..."}]

If no issues found, return an empty array: []`

const T1_INSTR = `## Task
Gather comprehensive context about the current TDD pipeline phase.

## Context
Phase {phase}, Round {round}, Project: {projectId}, Scope: {scope}
TDD Protocol: Red-Green-Refactor discipline applies to all phases.

## Instructions
1. Read design documents in design_plan/ directory
2. Check test results from previous rounds
3. Review audit history in .tdd-pipeline/
4. Verify phase checklist completion

## Output Format
Return JSON: {code_changes: [...], test_results: {...}, audit_history: [...], design_doc: "...", phase_checklist: [...]}`

const T2_INSTR = `## Task
Review the current TDD pipeline deliverable against requirements and TDD protocol.

## Context
Phase: {phase}, Round: {round}, Run: {runId}, Project: {projectId}
TDD Protocol: Red-Green-Refactor. Tests must fail before implementation (Red), pass after (Green), then refactor.

## Instructions
1. Read the deliverable files
2. Check tests are written before business code
3. Verify test coverage matches requirements
4. Identify TDD violations and code quality issues

## Output Format
Return JSON array of findings with severity, description, location, suggestion.`

const T3_INSTR = `## Task
Split the oversized file into cohesive modules.

## Context
File: {file_path}, Size: {size} bytes, Language: {language}
TDD Protocol: Refactor step — preserve behavior, do not break existing tests.

## Instructions
1. Analyze the file structure
2. Identify cohesive module boundaries
3. Generate the split plan
4. Verify tests pass after split

## Output Format
Return JSON with status (success|unsplittable|tests_failed|rollback_failed), split_plan, new_files, tests_pass.`

const T4_INSTR = ''

const T5_INSTR = `## Task
Generate a pattern-cycle briefing for the main agent.

## Context
Violation: {violationType}, Occurrences: {occurrences}/{patternWindow}, Run: {runId}, Phase: {phase}
TDD Protocol: Repeated violations indicate a process gap; briefing guides remediation.

## Instructions
1. Summarize the repeated violation pattern
2. Recommend corrective action
3. Provide next-step guidance

## Output Format
Return JSON: {briefing_text, violation_type, phase, occurrences, run_id}`

const T6_INSTR = ''

const T7_INSTR = `## Task
Write tests for the module per requirements and design.

## Context
Module: {module_path}, Requirements: {requirements}, Design: {design_doc}, Language: {language}
TDD Protocol: Red phase — write failing tests first; do not implement business code.

## Instructions
1. Read requirements and design doc
2. Write test cases covering all scenarios
3. Verify all tests fail (Red) before implementation
4. Return test file paths

## Output Format
Return JSON: {test_files: [...], all_failing: bool, status: "success"} | {status: "invalid_test", test_file, message}`

const T7B_INSTR = `## Task
Write tests targeting the violation (REGRESSION/MODIFIED_TEST/MISSING_TEST).

## Context
Violation: {violation_type}, Files: {files}, Phase: {phase}, Run: {run_id}
TDD Protocol: Red phase — failing tests must precede fixes.

## Instructions
1. Read quarantined / referenced files
2. Write tests reproducing the violation
3. Verify tests fail before fix
4. Return test file paths

## Output Format
Return JSON: {test_files: [...], status: "success"|"invalid_test"|"blocked", message?, all_failing: bool, phase_results?}`

const T8_INSTR = `## Task
Write implementation making all tests pass.

## Context
Module: {module_path}, Tests: {test_files}, Design: {design_doc}, Language: {language}
TDD Protocol: Green phase — implement the minimum code to pass tests, then refactor.

## Instructions
1. Read failing tests
2. Implement business code to pass each test
3. Run tests to verify all pass (Green)
4. Refactor while keeping tests green

## Output Format
Return JSON: {impl_files: [...], all_passing: bool, status: "success"|"impl_blocked", failing_tests?}`

const T9_INSTR = `## Task
precision_filter — confirm, downgrade, or reject each finding.

## Context
raw_findings, location_map, review_scope provided.
TDD Protocol: Precision pass validates Recall findings against file evidence.

## Instructions
1. For each finding, verify location exists in location_map
2. Apply verdict: CONFIRM, DOWNGRADE (with original_severity), or REJECT
3. Enforce scope boundary (out_of_scope → DOWNGRADE/REJECT)

## Output Format
Return JSON: {confirmed_findings: [{id, adjusted_severity, original_severity?, description, location, verdict, verdict_reason}]}`

const T10_INSTR = `## Task
eval_fix — produce adopt/reject/modify/defer decisions for each finding.

## Context
confirmed_findings, deliverable, context provided.
TDD Protocol: Eval-Fix generates actionable fix suggestions for Main Agent.

## Instructions
1. For each confirmed finding, decide ADOPT/REJECT/MODIFY/DEFER
2. Provide fix_code or fix_suggestion for ADOPT/MODIFY
3. DEFER only for P/L/I severity (never C/H/M)
4. DEFER requires defer_target ("Phase N" or "Phase N Round M")

## Output Format
Return JSON: {decisions: [{finding_id, decision, rationale, fix_code?, original_code?, fix_suggestion?, defer_target?, deferral_reason?}]}`

function makeSchema(
  id: string,
  name: string,
  trigger: string,
  subagent_type: string,
  timeout: number,
  input_schema: Record<string, unknown>,
  role_definition: string,
  instruction_template: string,
  is_mcp_internal: boolean,
): TemplateSchema {
  const output_schema: Record<string, unknown> = { type: 'object' }
  return {
    id, name, trigger, subagent_type, timeout,
    input_schema, output_schema,
    role_definition, instruction_template, is_mcp_internal,
  }
}

const TEMPLATES: Record<string, TemplateSchema> = {
  'T-1': makeSchema('T-1', 'fact_gather', 'Ralph loop round start', 'explore', 55, T1_INPUT, T2_ROLE, T1_INSTR, false),
  'T-2': makeSchema('T-2', 'reviewer', 'Watchdog intercepts Task', 'reviewer', 285, T2_INPUT, T2_ROLE, T2_INSTR, false),
  'T-3': makeSchema('T-3', 'file_split', 'FILE_TOO_LARGE >100KB', 'deep', 120, T3_INPUT, T2_ROLE, T3_INSTR, false),
  'T-4': makeSchema('T-4', 'quarantine', 'MCP intervene (violation handler)', 'MCP-internal', 30, T4_INPUT, '', T4_INSTR, true),
  'T-5': makeSchema('T-5', 'briefing', 'Pattern cycle >=3/10 rounds', 'oracle', 30, T5_INPUT, T2_ROLE, T5_INSTR, false),
  'T-6': makeSchema('T-6', 'ki_update', 'Phase boundary check (compliance)', 'MCP-internal', 15, T6_INPUT, '', T6_INSTR, true),
  'T-7': makeSchema('T-7', 'test_write', 'Phase 4 normal flow (test_write)', 'build', 180, T7_INPUT, T2_ROLE, T7_INSTR, false),
  'T-7b': makeSchema('T-7b', 'violation_test_write', 'REGRESSION/MODIFIED_TEST/MISSING_TEST', 'build', 180, T7B_INPUT, T2_ROLE, T7B_INSTR, false),
  'T-8': makeSchema('T-8', 'impl_write', 'Phase 5 normal flow (impl_write)', 'build', 180, T8_INPUT, T2_ROLE, T8_INSTR, false),
  'T-9': makeSchema('T-9', 'precision_filter', 'Dual-Pass Review Step C', 'oracle', 60, T9_INPUT, T2_ROLE, T9_INSTR, false),
  'T-10': makeSchema('T-10', 'eval_fix', 'Dual-Pass Review Step D1', 'build', 120, T10_INPUT, T2_ROLE, T10_INSTR, false),
}

// Template-specific required params (for validate_params)
const PARAM_SPECS: Record<string, { params: Record<string, ParamSpec>; optional: Set<string> }> = {
  'T-1': { params: T1_PARAMS, optional: T1_OPTIONAL },
  'T-2': { params: T2_PARAMS, optional: new Set() },
  'T-3': { params: T3_PARAMS, optional: new Set() },
  'T-4': { params: T4_PARAMS, optional: new Set() },
  'T-5': { params: T5_PARAMS, optional: new Set() },
  'T-6': { params: T6_PARAMS, optional: new Set() },
  'T-7': { params: T7_PARAMS, optional: new Set() },
  'T-7b': { params: T7B_PARAMS, optional: T7B_OPTIONAL },
  'T-8': { params: T8_PARAMS, optional: new Set() },
  'T-9': { params: T9_PARAMS, optional: new Set() },
  'T-10': { params: T10_PARAMS, optional: new Set() },
}

function jsTypeOf(v: unknown): string {
  if (Array.isArray(v)) return 'array'
  if (v === null) return 'null'
  return typeof v
}

export class TaskTemplateRegistry {
  get_template(id: string): TemplateSchema {
    const t = TEMPLATES[id]
    if (!t) throw new Error(`Template not found: ${id}`)
    return t
  }

  list_templates(): string[] {
    return Object.keys(TEMPLATES)
  }

  validate_params(templateId: string, params: Record<string, unknown>): ValidationResult {
    if (!TEMPLATES[templateId]) {
      return { valid: false, errors: [`Template not found: ${templateId}`] }
    }
    const spec = PARAM_SPECS[templateId]
    const errors: string[] = []

    for (const [name, ptype] of Object.entries(spec.params)) {
      if (!spec.optional.has(name)) {
        if (!(name in params)) {
          errors.push(`Missing required param: ${name}`)
        }
      }
    }

    for (const [name, ptype] of Object.entries(spec.params)) {
      if (name in params) {
        const actual = jsTypeOf(params[name])
        if (actual !== ptype.type) {
          errors.push(`Param ${name} expected ${ptype.type}, got ${actual}`)
        }
      }
    }

    const allowed = new Set<string>(Object.keys(spec.params))
    for (const opt of spec.optional) allowed.add(opt)
    for (const key of Object.keys(params)) {
      if (!allowed.has(key)) {
        errors.push(`Unexpected param: ${key}`)
      }
    }

    return errors.length === 0 ? { valid: true } : { valid: false, errors }
  }
}

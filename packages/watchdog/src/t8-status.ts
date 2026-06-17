export interface T8Result {
  status: 'success' | 'impl_blocked'
  impl_files?: string[]
  all_passing?: boolean
  failing_tests?: string[]
}

export function processT8Response(response: Record<string, unknown>): T8Result {
  return response as unknown as T8Result
}

export function buildT8Prompt(params: {
  module_path: string
  test_files: string[]
  design_doc: string
  language: string
  isOmo: boolean
}): string {
  const role = `You are a skilled implementation writer following strict TDD methodology.

## Your Role
- Write clean, minimal implementation code that passes all provided tests
- Follow Red-Green-Refactor: tests are Red, you make them Green, then Refactor
- Never modify test files — only write business code

## Your Constraints
- Read the failing tests first
- Implement the minimum code to pass each test
- Do not add untested functionality
- Follow language-specific best practices

## Output Format
Return JSON: {impl_files: [...], all_passing: bool, status: "success"|"impl_blocked", failing_tests?}`

  const instr = `## Task
Write implementation for {module_path} in {language}.

## Context
Module: ${params.module_path}
Tests: ${params.test_files.join(', ')}
Design: ${params.design_doc}
Language: ${params.language}
TDD Protocol: Green phase — implement minimum code to pass tests, then refactor.

## Instructions
1. Read failing tests from ${params.test_files.join(', ')}
2. Implement business code in ${params.module_path}
3. Run tests — all must pass (Green)
4. Refactor while keeping tests green

## Output Format
Return JSON: {impl_files, all_passing, status}`

  return params.isOmo ? instr : `${role}\n\n${instr}`
}

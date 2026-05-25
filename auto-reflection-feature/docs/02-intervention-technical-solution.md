# Technical Design: Watchdog Intervention for TDD Pipeline

> **Version**: v1.0
> **Status**: Draft - Pending Ralph Loop Review
> **Branch**: feature/watchdog-intervention
> **Phase**: 2 (Technical Solution)
> **Based on**: intervention-requirements-v1.md (v1.4, gate passed)

---

## Why Articulation

Phase 2 protects traceability of architectural decisions. Core risks:

1. **Module boundary errors**: Unclear responsibility split between Intervener and existing 5 modules
2. **Over-engineering**: 13 violation types may cause module bloat
3. **Insufficient interface abstraction**: Integration points with TDD Pipeline undefined, hard to test

Approach: One InterventionCoordinator as entry point with 4 internal sub-components. Each has single responsibility and minimal API surface.

---

## Architecture Overview

```
TDD Pipeline
    |
    | ViolationEvent (from GPAV/Watchdog)
    v
+------------------------------------------+
| InterventionCoordinator                   |
|  (entry point, routing, priority)        |
|                                          |
|  +---> PromptValidator    (V-13)        |
|  +---> RollbackEngine     (V-4,V-5)     |
|  +---> KiDocManager       (V-8,V-9,V-12)|
|  +---> CommitGuard        (V-10,V-11)   |
|                                          |
|  Uses existing modules:                  |
|  +---> ViolationFilter    (watchdog.py)  |
|  +---> AutoReflector      (reflector.py) |
|  +---> RuleGenerator      (rule_gen.py)  |
|  +---> AutoCommitter      (committer.py) |
+------------------------------------------+
    |
    | TDDViolationError (raised to pipeline)
    v
TDD Pipeline (blocked, receives retry instruction)
```

**Data Flow**: ViolationEvent -> InterventionCoordinator -> classify by priority -> dispatch to sub-component -> execute auto-fix (if applicable) -> update ki doc -> commit -> raise TDDViolationError -> pipeline retries.

---

## Component Breakdown

| Component | Priority | Responsibilities | Serves ACs | Interface | Dependencies |
|-----------|----------|-----------------|------------|-----------|-------------|
| InterventionCoordinator | Key | Route violation to handler, enforce priority, manage lifecycle | AC-I21, AC-I4, AC-I8, AC-I10 | intervene(event) -> InterventionResult | All sub-components |
| PromptValidator | Key | Scan Ralph Loop prompts for forbidden patterns (bilingual EN+ZH) | AC-I17, AC-I18, AC-I19 | validate(prompt) -> ValidationResult | None |
| RollbackEngine | Key | Execute destructive auto-fixes (delete impl, restore test), git safety | AC-I5, AC-I6, AC-I7, AC-I22 | rollback(event, plan) -> RollbackResult | git CLI |
| KiDocManager | Key | Update ki document, enforce assessment, handle merge rule | AC-I11, AC-I12, AC-I13, AC-I20 | record_intervention(), assess(), ensure_updated() | Filesystem |
| CommitGuard | Peripheral | Ensure phase/loop boundaries committed, handle empty diff | AC-I14, AC-I15, AC-I16 | ensure_committed(context) -> CommitResult | git CLI |

### Priority Classification Rationale

- **Key** (4): Directly serve core ACs, involved in destructive operations or validation logic
- **Peripheral** (1): CommitGuard wraps existing AutoCommitter; failure is recoverable, non-destructive

### Traceability Matrix (Phase 1 AC to Phase 2 Component)

| Phase 1 AC | Component | Classification |
|------------|-----------|---------------|
| AC-I1..I4 (Process) | InterventionCoordinator | Core -> Key |
| AC-I5 (delete impl) | RollbackEngine | Core -> Key |
| AC-I6 (restore test) | RollbackEngine | Core -> Key |
| AC-I7 (MISSING_TEST) | InterventionCoordinator | Core -> Key |
| AC-I8..I10 (phases) | InterventionCoordinator | Core -> Key |
| AC-I11..I12 (ki doc) | KiDocManager | Core -> Key |
| AC-I13 (assessment) | KiDocManager | Core -> Key |
| AC-I14..I16 (commits) | CommitGuard | Core -> Peripheral (justified: wraps existing, non-destructive) |
| AC-I17..I19 (prompt) | PromptValidator | Core -> Key |
| AC-I20 (ki outdated) | KiDocManager | Core -> Key |
| AC-I21 (SYNC mode) | InterventionCoordinator | Core -> Key |
| AC-I22 (rollback granularity) | RollbackEngine | Core -> Key |

---

## Data Models

### ViolationEvent (existing, from watchdog.py)
```python
@dataclass
class ViolationEvent:
    violation_type: str       # V-1..V-13 names
    affected_file_path: str
    timestamp: str            # ISO 8601
    context: Dict[str, Any]   # phase, operation, rounds, issues, etc.
```

### InterventionPlan (new)
```python
@dataclass
class InterventionPlan:
    target_phase: int
    auto_fix: bool
    needs_rollback: bool
    is_destructive: bool
    instruction: str          # instruction for LLM to retry
```

### InterventionResult (new)
```python
@dataclass
class InterventionResult:
    violation_code: str
    target_phase: int
    auto_fix_applied: bool
    auto_fix_details: str
    instruction: str
    ki_doc_updated: bool
    committed: bool
```

### ValidationResult (new, for V-13)
```python
@dataclass
class ValidationResult:
    is_valid: bool
    matches: List[PatternMatch]

@dataclass
class PatternMatch:
    category: str             # FP-1..FP-7
    pattern: str              # matched text
    line_number: int
    language: str             # en or zh
```

### RollbackResult (new)
```python
@dataclass
class RollbackResult:
    success: bool
    action: str
    files_affected: List[str]
    git_hash: Optional[str]
```

### PipelineContext (new)
```python
@dataclass
class PipelineContext:
    current_phase: int
    req_number: str           # e.g. INT-001
    loop_round: Optional[int] # None if not in Ralph Loop
    stage: str                # phase_boundary, loop_boundary, intervention
    boundary_commit_hash: Optional[str]  # Phase 4->5 boundary for V-5
    phase5_test_results: Optional[List[TestResult]]  # For V-7 regression
```

### CommitResult (new)
```python
@dataclass
class CommitResult:
    success: bool
    action: str               # "committed", "skip (empty diff)"
    hash: Optional[str]
```

---

## Key Decisions

| Decision | Rationale | Alternatives Rejected |
|----------|-----------|----------------------|
| Single coordinator pattern | All 13 violation types share same lifecycle. One entry point simplifies integration. | Observer/event-bus: over-engineered for MVP |
| Sub-components as internal classes | Tight coupling acceptable - shared ViolationEvent context | Plugin registration: adds indirection without benefit |
| Git CLI for rollback | git checkout/stash are atomic, well-tested, repo already git-managed | Python git libs: adds dependency, CLI available |
| File-based ki document | Append-only markdown. No DB needed. Simple and transparent. | SQLite/YAML: over-engineered, loses readability |
| Regex + lookaround for V-13 | Pattern-matching requirement. Regex sufficient for MVP. | LLM semantic detection: expensive, unreliable. v2. |
| Exception-based blocking | SYNC mode requires immediate blocking. Simplest mechanism. | Return code + poll: adds complexity |
| Pre-rollback commit | Before destructive op, commit current state. Work never lost. | Backup branches: creates clutter |

---

## InterventionCoordinator Design

```python
class InterventionCoordinator:
    def __init__(self, context: PipelineContext):
        self.context = context
        self.prompt_validator = PromptValidator()
        self.rollback_engine = RollbackEngine()
        self.ki_doc = KiDocManager()
        self.commit_guard = CommitGuard()

    def intervene(self, event: ViolationEvent) -> None:
        # 1. Validate event
        if not self._is_valid_event(event):
            return

        # 2. Prompt validation if applicable
        if self._needs_prompt_validation(event):
            result = self.prompt_validator.validate(event.context.get("prompt", ""))
            if not result.is_valid:
                plan = self._build_plan(event)
                self.ki_doc.record_intervention(event, plan, None, result)
                self.commit_guard.ensure_committed(self.context)
                raise TDDViolationError(event, plan)

        # 3. Build plan
        plan = self._build_plan(event)

        # 4. Pre-rollback commit (safety net for destructive ops)
        if plan.is_destructive:
            self.commit_guard.ensure_committed(self.context)

        # 5. Execute rollback
        rollback_result = None
        if plan.auto_fix and plan.needs_rollback:
            rollback_result = self.rollback_engine.rollback(event, plan)

        # 6. Ki doc update
        self.ki_doc.record_intervention(event, plan, rollback_result)

        # 7. Post-intervention commit
        self.commit_guard.ensure_committed(self.context)

        # 8. Block pipeline
        raise TDDViolationError(event, plan)

    def _build_plan(self, event: ViolationEvent) -> InterventionPlan:
        phase = event.context.get("phase", 0)
        PLANS = {
            "SKIP_REVIEW":          InterventionPlan(phase, False, False, False, "Execute Ralph Loop Review"),
            "INSUFFICIENT_REVIEW":   InterventionPlan(phase, False, False, False, "Continue Ralph Loop until 2 consecutive ZERO_C_H_M"),
            "UNFIXED_ISSUES":        InterventionPlan(phase, False, False, False, "Fix issues before proceeding"),
            "INVALID_REVIEW_PROMPT": InterventionPlan(phase, False, False, False, "Reconstruct compliant review prompt"),
            "SKIP_RED_PHASE":        InterventionPlan(4, True, True, True, "Write failing test before implementation"),
            "MODIFIED_TEST":         InterventionPlan(5, True, True, True, "Write implementation to make ORIGINAL test pass"),
            "MISSING_TEST":          InterventionPlan(4, False, False, False, "Write test for this module first"),
            "REGRESSION":            InterventionPlan(5, False, False, False, "Fix implementation to resolve regression"),
            "MISSING_KI_DOC":        InterventionPlan(phase, True, False, False, "(auto-fixed)"),
            "KI_DOC_OUTDATED":       InterventionPlan(phase, True, False, False, "(auto-fixed)"),
            "UNCOMMITTED_PHASE":     InterventionPlan(phase, True, False, False, "(auto-fixed)"),
            "UNCOMMITTED_REVIEW":    InterventionPlan(phase, True, False, False, "(auto-fixed)"),
            "MISSING_KI_ASSESSMENT": InterventionPlan(phase, True, False, False, "(auto-fixed)"),
        }
        return PLANS.get(event.violation_type,
            InterventionPlan(phase, False, False, False, f"Unknown: {event.violation_type}"))
```

---

## PromptValidator Design

```python
class PromptValidator:
    # English: word boundary matching
    EN_PATTERNS = {
        "FP-1": [r"\bstop condition\b", r"\bgate pass\b", r"\b2 consecutive rounds\b"],
        "FP-2": [r"\bcumulative tally\b", r"\brunning total\b"],
        "FP-3": [r"\bprior round\b", r"\bprevious round\b", r"\blast round\b"],
        "FP-4": [r"\bfix list\b", r"\bfixes applied\b"],
        "FP-5": [r"\bround N\b", r"\bround count\b"],
        "FP-6": [r"\bloop state\b", r"\bgate status\b"],
        "FP-7": [r"\bonly check \w+\b", r"\blimit scope to\b", r"\bdo not review\b"],
    }

    # Chinese: lookaround (CJK boundary)
    ZH_PATTERNS = {
        "FP-1": ["(?<![\w\u4e00-\u9fff])停止条件(?![\w\u4e00-\u9fff])",
                  "(?<![\w\u4e00-\u9fff])连续2轮(?![\w\u4e00-\u9fff])",
                  "(?<![\w\u4e00-\u9fff])审查达标(?![\w\u4e00-\u9fff])"],
        "FP-2": ["(?<![\w\u4e00-\u9fff])累计计数(?![\w\u4e00-\u9fff])"],
        "FP-3": ["(?<![\w\u4e00-\u9fff])上一轮(?![\w\u4e00-\u9fff])"],
        "FP-4": ["(?<![\w\u4e00-\u9fff])修复列表(?![\w\u4e00-\u9fff])"],
        "FP-5": ["(?<![\w\u4e00-\u9fff])第\d+轮(?![\w\u4e00-\u9fff])"],
        "FP-6": ["(?<![\w\u4e00-\u9fff])循环状态(?![\w\u4e00-\u9fff])"],
        "FP-7": ["(?<![\w\u4e00-\u9fff])不要审查(?![\w\u4e00-\u9fff])"],
    }

    EXEMPT = [r"```[\s\S]*?```", r"`[^`]+`"]  # code blocks, inline code

    def validate(self, prompt: str) -> ValidationResult:
        sanitized = self._strip_exempt(prompt)
        matches = self._match_en(sanitized) + self._match_zh(sanitized)
        return ValidationResult(is_valid=len(matches) == 0, matches=matches)

    def _strip_exempt(self, text: str) -> str:
        import re
        for pattern in self.EXEMPT:
            text = re.sub(pattern, "", text)
        return text

    def _match_en(self, text: str) -> List[PatternMatch]:
        import re
        matches = []
        for category, patterns in self.EN_PATTERNS.items():
            for p in patterns:
                for m in re.finditer(p, text, re.IGNORECASE):
                    matches.append(PatternMatch(category, m.group(), self._line_num(text, m.start()), "en"))
        return matches

    def _match_zh(self, text: str) -> List[PatternMatch]:
        import re
        matches = []
        for category, patterns in self.ZH_PATTERNS.items():
            for p in patterns:
                for m in re.finditer(p, text):
                    matches.append(PatternMatch(category, m.group(), self._line_num(text, m.start()), "zh"))
        return matches
```

---

## RollbackEngine Design

```python
class RollbackEngine:
    def rollback(self, event: ViolationEvent, plan: InterventionPlan) -> RollbackResult:
        handlers = {
            "SKIP_RED_PHASE": self._delete_implementation,
            "MODIFIED_TEST": self._restore_test,
        }
        handler = handlers.get(event.violation_type)
        if handler:
            return handler(event)
        return RollbackResult(True, "no-op", [], None)

    def _delete_implementation(self, event) -> RollbackResult:
        filepath = event.affected_file_path
        if self._is_tracked(filepath):
            subprocess.run(["git", "checkout", "HEAD", "--", filepath], check=True)
        elif os.path.exists(filepath):
            os.remove(filepath)
        return RollbackResult(True, "deleted implementation", [filepath], None)

    def _restore_test(self, event) -> RollbackResult:
        filepath = event.affected_file_path
        if not self._is_tracked(filepath):
            return RollbackResult(False, "skip (untracked)", [], None)
        subprocess.run(["git", "checkout", "HEAD", "--", filepath], check=True)
        return RollbackResult(True, "restored test", [filepath], None)

    def _is_tracked(self, filepath: str) -> bool:
        result = subprocess.run(["git", "ls-files", filepath], capture_output=True, text=True)
        return result.stdout.strip() != ""
```

---

## KiDocManager Design

```python
class KiDocManager:
    KI_DOC_PATH = "auto-reflection-feature/docs/04-review-records.md"

    def record_intervention(self, event, plan, rollback_result, validation_result=None):
        entry = self._format_intervention_entry(event, plan, rollback_result, validation_result)
        self._append(entry)

    def ensure_assessment(self, phase, next_phase, status, issues):
        entry = self._format_assessment_entry(phase, next_phase, status, issues)
        self._append(entry)

    def ensure_updated(self, last_intervention_ts):
        # V-9: compare newest ki entry timestamp with last intervention
        pass

    def handle_boundary_merge(self, violations, context):
        # Merge Rule: V-10/V-11 -> V-12 -> V-8/V-9
        pass

    def _append(self, entry: str):
        path = Path(self.KI_DOC_PATH)
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("# Review Records\n\n")
        with open(path, "a") as f:
            f.write(entry)
```

---

## CommitGuard Design

```python
class CommitGuard:
    PHASE_NAMES = {
        1: "PHASE-1-DESIGN", 2: "PHASE-2-SOLUTION", 3: "PHASE-3-TEST-PLAN",
        4: "PHASE-4-RED", 5: "PHASE-5-GREEN", 6: "PHASE-6-PRETEST", 7: "PHASE-7-AUDIT"
    }

    def ensure_committed(self, context: PipelineContext) -> CommitResult:
        if self._is_clean():
            return CommitResult(True, "skip (empty diff)", None)
        msg = self._build_message(context)
        subprocess.run(["git", "add", "-A"], check=True)
        subprocess.run(["git", "commit", "-m", msg], check=True)
        h = subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True)
        return CommitResult(True, "committed", h.stdout.strip())

    def _is_clean(self) -> bool:
        r1 = subprocess.run(["git", "diff", "--quiet"], capture_output=True)
        r2 = subprocess.run(["git", "diff", "--cached", "--quiet"], capture_output=True)
        return r1.returncode == 0 and r2.returncode == 0

    def _build_message(self, context: PipelineContext) -> str:
        name = self.PHASE_NAMES.get(context.current_phase, f"PHASE-{context.current_phase}")
        if context.loop_round is not None:
            return f"{context.req_number}: {name} [Loop {context.loop_round}] auto-commit"
        return f"{context.req_number}: {name} auto-commit"
```

---

## Failure Mode Handling

| Failure Scenario | Priority | Design Response |
|-----------------|----------|-----------------|
| Git checkout fails (rollback) | Key | RollbackResult.success=False, log error, allow pipeline to proceed with warning |
| Ki doc write fails | Peripheral | Log error, continue. Best-effort. |
| Prompt too long for regex | Peripheral | Truncate to 10KB, log truncation |
| Multiple violations same event | Key | Priority table (P1>P2>P3>P4>P5), handle highest only |
| Unknown violation_type | Peripheral | Log warning, no-op, do not block |
| Empty diff at boundary | Peripheral | Skip commit, log |
| Git unavailable | Key | Log error, raise TDDViolationError without auto-fix |

---

## Non-functional Constraints

| Dimension | Requirement | Design Response |
|-----------|-------------|-----------------|
| Concurrency | SYNC: block immediately | TDDViolationError (synchronous exception) |
| Reversibility | Destructive ops reversible | Pre-rollback commit; git reflog |
| Data isolation | No sensitive data in LLM | ViolationEvent: paths + metadata only |
| Resources | Regex scan < 100ms | Pre-compiled patterns, strip exempt, short-circuit |
| Extension | New violation types easy | Plan builder dict; add entry = add support |
| Latency | Intervention < 500ms | File I/O + git CLI fast; regex < 100ms |
| Cost | No third-party | All local git + filesystem |

---

## Observability

| Signal | Log | Alert |
|--------|-----|-------|
| Intervention triggered | violation_code, phase, auto_fix_applied | > 5 per pipeline |
| Auto-fix failed | violation_code, error, rollback_result | Any failure |
| Prompt blocked | matched patterns, FP categories | > 3 per pipeline |
| Commit skipped | empty diff at boundary | > 3 consecutive |

---

## Extension Points (v2)

1. New violation type: Add to _build_plan dict
2. New auto-fix: Add handler to RollbackEngine
3. New validation: Add pattern to PromptValidator
4. Async mode: Replace raise with queue dispatch
5. Config: Add param to __init__ (enabled, mode, thresholds)

---

## Existing Module Dependencies

| Module | Used By | Interface |
|--------|---------|-----------|
| watchdog.py (ViolationFilter) | InterventionCoordinator | filter(event) |
| watchdog.py (ViolationEvent) | All | Data class |
| committer.py (AutoCommitter) | CommitGuard | validate_schema() |

Intervention is orthogonal to existing auto-reflection pipeline. Sits between watchdog detection and reflection, adding block/rollback/retry.

---

## Open Technical Questions

1. **V-5 last legitimate commit**: HEAD may include Phase 5 changes. Resolution: Store boundary commit hash in PipelineContext at stage transition, use instead of HEAD.

2. **V-7 regression detection**: Needs Phase 5 vs Phase 6 test results. Resolution: PipelineContext stores phase5_test_results.

---

*Document created: 2026-05-25*
*Phase: 2 (Technical Solution)*
*Next: Ralph Loop Review*

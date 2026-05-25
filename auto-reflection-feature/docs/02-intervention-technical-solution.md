# Technical Design: Watchdog Intervention for TDD Pipeline

> **Version**: v1.2
> **Status**: Ralph Loop Review R2 fixes applied
> **Branch**: feature/watchdog-intervention
> **Phase**: 2 (Technical Solution)
> **Based on**: intervention-requirements-v1.md (v1.4, gate passed)
> **Changelog v1.2**: R2 fixes — all R1 structural changes properly applied; FP patterns completed; RollbackEngine context access fixed; VIOLATION_PRIORITY added; intervene_batch added; _validate_path added; regex pre-compiled; TestResult defined; git add -u; error handling

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
TDD Pipeline / Watchdog
    |
    | ViolationEvent (from GPAV/Watchdog, ALL 13 types)
    v
+------------------------------------------+
| InterventionCoordinator                   |
|  (entry point, routing, priority)        |
|  - Priority sort (P1>P2>P3>P4>P5)       |
|  - Merge Rule for same-boundary events   |
|  - Path validation for all file ops      |
|                                          |
|  +---> PromptValidator    (V-13)        |
|  +---> RollbackEngine     (V-4,V-5,V-7) |
|  +---> KiDocManager       (V-8,V-9,V-12)|
|  +---> CommitGuard        (V-10,V-11)   |
|                                          |
|  Uses existing modules (MODIFIED):       |
|  +---> ViolationFilter (watchdog.py)     |
|  |       [CHANGED: passes all 13 types]  |
|  +---> AutoReflector   (reflector.py)    |
|  +---> RuleGenerator   (rule_generator.py)|
|  +---> AutoCommitter   (committer.py)    |
+------------------------------------------+
    |
    | TDDViolationError(event, plan, result)
    v
TDD Pipeline (blocked, receives retry instruction + InterventionResult)
```

**Data Flow**: ViolationEvent -> InterventionCoordinator (priority sort) -> classify -> dispatch to sub-component -> execute auto-fix (if applicable) -> update ki doc -> commit -> raise TDDViolationError with InterventionResult -> pipeline retries.

**Multi-violation Data Flow**: List[ViolationEvent] -> InterventionCoordinator.intervene_batch() -> merge same-boundary V-8/V-9/V-10/V-11/V-12 per Merge Rule -> handle highest priority -> single ki doc entry.

---

## Component Breakdown

| Component | Priority | Responsibilities | Serves ACs | Interface | Dependencies |
|-----------|----------|-----------------|------------|-----------|-------------|
| InterventionCoordinator | Key | Route violation to handler, enforce priority, batch processing, Merge Rule | AC-I21, AC-I1..I4, AC-I7..I10 | intervene(event), intervene_batch(events) | All sub-components |
| PromptValidator | Key | Scan Ralph Loop prompts for forbidden patterns (bilingual EN+ZH) | AC-I17, AC-I18, AC-I19 | validate(prompt) -> ValidationResult | None |
| RollbackEngine | Key | Execute destructive auto-fixes, git safety, path validation | AC-I5, AC-I6, AC-I9, AC-I22 | rollback(event, plan, context) -> RollbackResult | git CLI, PipelineContext |
| KiDocManager | Key | Update ki document, enforce assessment, handle merge rule | AC-I11, AC-I12, AC-I13, AC-I20 | record_intervention(), assess(), ensure_updated() | Filesystem |
| CommitGuard | Peripheral | Ensure phase/loop boundaries committed, targeted staging | AC-I14, AC-I15, AC-I16 | ensure_committed(context) -> CommitResult | git CLI |

### Traceability Matrix (Phase 1 AC to Phase 2 Component)

| Phase 1 AC | Component | Classification |
|------------|-----------|---------------|
| AC-I1..I4 (Process: V-1,V-2,V-3) | InterventionCoordinator | Key |
| AC-I5 (delete impl: V-4) | RollbackEngine | Key |
| AC-I6 (restore test: V-5) | RollbackEngine | Key |
| AC-I7 (MISSING_TEST: V-6) | InterventionCoordinator | Key |
| AC-I8..I10 (phases) | InterventionCoordinator + RollbackEngine | Key |
| AC-I9 (REGRESSION: V-7) | RollbackEngine | Key |
| AC-I11..I12 (ki doc: V-8) | KiDocManager | Key |
| AC-I13 (assessment: V-12) | KiDocManager | Key |
| AC-I14..I16 (commits: V-10,V-11) | CommitGuard | Peripheral |
| AC-I17..I19 (prompt: V-13) | PromptValidator | Key |
| AC-I20 (ki outdated: V-9) | KiDocManager | Key |
| AC-I21 (SYNC mode) | InterventionCoordinator | Key |
| AC-I22 (rollback granularity) | RollbackEngine | Key |

---

## Data Models

### ViolationEvent (existing, from watchdog.py)
```python
@dataclass
class ViolationEvent:
    violation_type: str       # V-1..V-13 names
    affected_file_path: str
    timestamp: str            # ISO 8601 (UTC)
    context: Dict[str, Any]   # phase, operation, rounds, issues, etc.
```

### InterventionPlan (new, replaces RemediationPlan)
```python
@dataclass
class InterventionPlan:
    target_phase: int
    auto_fix: bool
    needs_rollback: bool
    is_destructive: bool
    instruction: str
```

**Migration note**: Replaces `RemediationPlan` in `intervener.py`. Key differences: added `needs_rollback`, `is_destructive`, `instruction`. `TDDViolationError` now carries `InterventionResult`.

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
    rollback_result: Optional[RollbackResult]
    validation_result: Optional[ValidationResult]
```

### ValidationResult (for V-13)
```python
@dataclass
class ValidationResult:
    is_valid: bool
    matches: List[PatternMatch]

@dataclass
class PatternMatch:
    category: str             # FP-1..FP-7
    pattern: str
    line_number: int
    language: str             # en or zh
```

### RollbackResult
```python
@dataclass
class RollbackResult:
    success: bool
    action: str
    files_affected: List[str]
    git_hash: Optional[str]
    partial_failure: bool = False
    failed_files: List[str] = field(default_factory=list)
```

### PipelineContext
```python
@dataclass
class PipelineContext:
    current_phase: int
    req_number: str           # e.g. INT-001
    loop_round: Optional[int] # None if not in Ralph Loop
    stage: str                # "phase_boundary" | "loop_boundary" | "intervention"
    boundary_commit_hash: Optional[str]  # Phase 4->5 boundary for V-5
    phase5_test_results: Optional[List[TestResult]]  # For V-7 regression
    ki_doc_path: str = "auto-reflection-feature/docs/04-review-records.md"
```

### TestResult (for V-7 regression detection)
```python
@dataclass
class TestResult:
    test_name: str
    passed: bool
    error_message: Optional[str]
    execution_time: Optional[float]
```

### CommitResult
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
| Single coordinator pattern | All 13 violation types share same lifecycle | Observer/event-bus: over-engineered for MVP |
| Sub-components as internal classes | Tight coupling acceptable | Plugin registration: adds indirection |
| Git CLI for rollback | git checkout/rm are atomic, well-tested | Python git libs: adds dependency |
| File-based ki document | Append-only markdown. Simple and transparent. | SQLite/YAML: over-engineered |
| Regex + lookaround for V-13 | Pattern-matching sufficient for MVP | LLM semantic detection: v2 |
| Exception-based blocking | SYNC mode requires immediate blocking | Return code + poll: adds complexity |
| Pre-rollback commit | Before destructive op, work never lost | Backup branches: creates clutter |
| ViolationFilter expansion | Must pass all 13 types (was only 3) | Separate filter per category |
| boundary_commit_hash for V-5 | HEAD may include Phase 5 modifications | Always HEAD: incorrect |
| Path validation | Prevent path traversal before git ops | Trust internal paths: security risk |
| git add -u instead of -A | Only stage tracked files, not untracked | git add -A: stages unrelated files |

---

## Violation Priority Table

```python
VIOLATION_PRIORITY = {
    # P1 - Behavioral (highest)
    "SKIP_RED_PHASE": 1, "MODIFIED_TEST": 1, "MISSING_TEST": 1,
    # P2 - Process
    "SKIP_REVIEW": 2, "INSUFFICIENT_REVIEW": 2, "UNFIXED_ISSUES": 2,
    "INVALID_REVIEW_PROMPT": 2,
    # P3 - Regression
    "REGRESSION": 3,
    # P4 - Compliance
    "MISSING_KI_DOC": 4, "KI_DOC_OUTDATED": 4,
    "UNCOMMITTED_PHASE": 4, "UNCOMMITTED_REVIEW": 4,
    # P5 - Assessment (lowest)
    "MISSING_KI_ASSESSMENT": 5,
}
```

---

## InterventionCoordinator Design

```python
class InterventionCoordinator:
    def __init__(self, context: PipelineContext):
        self.context = context
        self.prompt_validator = PromptValidator()
        self.rollback_engine = RollbackEngine()
        self.ki_doc = KiDocManager(context.ki_doc_path)
        self.commit_guard = CommitGuard()

    def intervene(self, event: ViolationEvent) -> None:
        # 1. Validate event
        if not self._is_valid_event(event):
            return

        # 2. Unknown type: log warning, do NOT block
        if event.violation_type not in VIOLATION_PRIORITY:
            logger.warning(f"Unknown violation_type: {event.violation_type}")
            return

        # 3. Prompt validation if applicable
        if self._needs_prompt_validation(event):
            result = self.prompt_validator.validate(event.context.get("prompt", ""))
            if not result.is_valid:
                plan = self._build_plan(event)
                self.ki_doc.record_intervention(event, plan, None, result)
                self.commit_guard.ensure_committed(self.context)
                raise TDDViolationError(event, plan, InterventionResult(
                    violation_code=event.violation_type, target_phase=plan.target_phase,
                    auto_fix_applied=False, auto_fix_details="", instruction=plan.instruction,
                    ki_doc_updated=True, committed=True, rollback_result=None, validation_result=result))

        # 4. Build plan
        plan = self._build_plan(event)

        # 5. Pre-rollback commit (safety net for destructive ops)
        if plan.is_destructive:
            self.commit_guard.ensure_committed(self.context)

        # 6. Execute rollback
        rollback_result = None
        if plan.auto_fix and plan.needs_rollback:
            rollback_result = self.rollback_engine.rollback(event, plan, self.context)

        # 7. Ki doc update
        self.ki_doc.record_intervention(event, plan, rollback_result)

        # 8. Post-intervention commit
        self.commit_guard.ensure_committed(self.context)

        # 9. Block pipeline with result
        raise TDDViolationError(event, plan, InterventionResult(
            violation_code=event.violation_type, target_phase=plan.target_phase,
            auto_fix_applied=rollback_result is not None and rollback_result.success,
            auto_fix_details=rollback_result.action if rollback_result else "",
            instruction=plan.instruction, ki_doc_updated=True, committed=True,
            rollback_result=rollback_result, validation_result=None))

    def intervene_batch(self, events: List[ViolationEvent]) -> None:
        """Merge Rule: V-10/V-11 -> V-12 -> V-8/V-9, handle highest priority."""
        if not events:
            return
        sorted_events = sorted(events, key=lambda e: VIOLATION_PRIORITY.get(e.violation_type, 99))
        mergeable = [e for e in sorted_events if e.violation_type in
                     {"MISSING_KI_DOC", "KI_DOC_OUTDATED", "UNCOMMITTED_PHASE",
                      "UNCOMMITTED_REVIEW", "MISSING_KI_ASSESSMENT"}]
        non_mergeable = [e for e in sorted_events if e not in mergeable]
        if mergeable:
            self._handle_merged(mergeable)
        if non_mergeable:
            self.intervene(non_mergeable[0])

    def _handle_merged(self, events):
        # Step 1: V-10/V-11 (commit first)
        for e in events if e.violation_type in {"UNCOMMITTED_PHASE", "UNCOMMITTED_REVIEW"}:
            self.commit_guard.ensure_committed(self.context)
        # Step 2: V-12 (assessment)
        for e in events if e.violation_type == "MISSING_KI_ASSESSMENT":
            self.ki_doc.ensure_assessment(self.context.current_phase, self.context.current_phase + 1, "ASSESSING", [])
        # Step 3: V-8/V-9 (ki doc) + single merged entry
        for e in events if e.violation_type in {"MISSING_KI_DOC", "KI_DOC_OUTDATED"}:
            self.ki_doc.record_intervention(e, self._build_plan(e), None)
        self.ki_doc.record_merge(events, self.context)

    def _is_valid_event(self, event: ViolationEvent) -> bool:
        if not event.violation_type:
            return False
        if not event.affected_file_path and event.violation_type not in (
            "SKIP_REVIEW", "INSUFFICIENT_REVIEW", "UNFIXED_ISSUES",
            "MISSING_KI_DOC", "KI_DOC_OUTDATED", "UNCOMMITTED_PHASE",
            "UNCOMMITTED_REVIEW", "MISSING_KI_ASSESSMENT", "INVALID_REVIEW_PROMPT"):
            return False
        if "phase" not in event.context:
            return False
        return True

    def _needs_prompt_validation(self, event: ViolationEvent) -> bool:
        return event.violation_type == "INVALID_REVIEW_PROMPT"

    def _build_plan(self, event: ViolationEvent) -> InterventionPlan:
        phase = event.context.get("phase", 0)
        PLANS = {
            "SKIP_REVIEW":           InterventionPlan(phase, False, False, False, "Execute Ralph Loop Review"),
            "INSUFFICIENT_REVIEW":    InterventionPlan(phase, False, False, False, "Continue Ralph Loop until 2 consecutive ZERO_C_H_M"),
            "UNFIXED_ISSUES":         InterventionPlan(phase, False, False, False, "Fix issues before proceeding"),
            "INVALID_REVIEW_PROMPT":  InterventionPlan(phase, False, False, False, "Reconstruct compliant review prompt"),
            "SKIP_RED_PHASE":         InterventionPlan(4, True, True, True, "Write failing test before implementation"),
            "MODIFIED_TEST":          InterventionPlan(5, True, True, True, "Write implementation to make ORIGINAL test pass"),
            "MISSING_TEST":           InterventionPlan(4, False, False, False, "Write test for this module first"),
            "REGRESSION":             InterventionPlan(5, False, False, False, "Fix implementation to resolve regression"),
            "MISSING_KI_DOC":         InterventionPlan(phase, True, False, False, "(auto-fixed)"),
            "KI_DOC_OUTDATED":        InterventionPlan(phase, True, False, False, "(auto-fixed)"),
            "UNCOMMITTED_PHASE":      InterventionPlan(phase, True, False, False, "(auto-fixed)"),
            "UNCOMMITTED_REVIEW":     InterventionPlan(phase, True, False, False, "(auto-fixed)"),
            "MISSING_KI_ASSESSMENT":  InterventionPlan(phase, True, False, False, "(auto-fixed)"),
        }
        return PLANS.get(event.violation_type,
            InterventionPlan(phase, False, False, False, f"Unknown: {event.violation_type}"))
```

---

## PromptValidator Design

```python
import re

class PromptValidator:
    # Pre-compiled English patterns
    EN_COMPILED = {
        "FP-1": [re.compile(p, re.IGNORECASE) for p in [
            r"\bstop condition\b", r"\bgate pass\b", r"\b2 consecutive rounds\b"]],
        "FP-2": [re.compile(p, re.IGNORECASE) for p in [
            r"\bcumulative tally\b", r"\brunning total\b", r"\btotal [CHM]\b"]],
        "FP-3": [re.compile(p, re.IGNORECASE) for p in [
            r"\bprior round\b", r"\bprevious round\b", r"\blast round\b",
            r"\bround \d+ found\b"]],
        "FP-4": [re.compile(p, re.IGNORECASE) for p in [
            r"\bfix list\b", r"\bfixes applied\b", r"\baddressed items\b", r"\bresolved issues\b"]],
        "FP-5": [re.compile(p, re.IGNORECASE) for p in [
            r"\bround \d+\b", r"\bround count\b", r"\bthis is round\b", r"\bloop round\b"]],
        "FP-6": [re.compile(p, re.IGNORECASE) for p in [
            r"\bloop state\b", r"\bgate status\b", r"\bpass.?fail status\b"]],
        "FP-7": [re.compile(p, re.IGNORECASE) for p in [
            r"\bonly check \w+\b", r"\blimit scope to\b", r"\bfocus only on\b", r"\bdo not review\b"]],
    }

    # Pre-compiled Chinese patterns (complete per Phase 1)
    ZH_COMPILED = {k: [re.compile(p) for p in ps] for k, ps in {
        "FP-1": [
            r"(?<![\w\u4e00-\u9fff])停止条件(?![\w\u4e00-\u9fff])",
            r"(?<![\w\u4e00-\u9fff])连续2轮(?![\w\u4e00-\u9fff])",
            r"(?<![\w\u4e00-\u9fff])连续两轮(?![\w\u4e00-\u9fff])",
            r"(?<![\w\u4e00-\u9fff])审查达标(?![\w\u4e00-\u9fff])",
            r"(?<![\w\u4e00-\u9fff])质量达标(?![\w\u4e00-\u9fff])",
        ],
        "FP-2": [
            r"(?<![\w\u4e00-\u9fff])累计计数(?![\w\u4e00-\u9fff])",
            r"(?<![\w\u4e00-\u9fff])累计统计(?![\w\u4e00-\u9fff])",
            r"(?<![\w\u4e00-\u9fff])总[CHM]数(?![\w\u4e00-\u9fff])",
        ],
        "FP-3": [
            r"(?<![\w\u4e00-\u9fff])上一轮(?![\w\u4e00-\u9fff])",
            r"(?<![\w\u4e00-\u9fff])前一轮(?![\w\u4e00-\u9fff])",
            r"(?<![\w\u4e00-\u9fff])上轮发现(?![\w\u4e00-\u9fff])",
            r"(?<![\w\u4e00-\u9fff])之前发现(?![\w\u4e00-\u9fff])",
        ],
        "FP-4": [
            r"(?<![\w\u4e00-\u9fff])修复列表(?![\w\u4e00-\u9fff])",
            r"(?<![\w\u4e00-\u9fff])已修复(?![\w\u4e00-\u9fff])",
            r"(?<![\w\u4e00-\u9fff])已解决(?![\w\u4e00-\u9fff])",
            r"(?<![\w\u4e00-\u9fff])修改清单(?![\w\u4e00-\u9fff])",
        ],
        "FP-5": [
            r"(?<![\w\u4e00-\u9fff])第\d+轮(?![\w\u4e00-\u9fff])",
            r"(?<![\w\u4e00-\u9fff])第几轮(?![\w\u4e00-\u9fff])",
            r"(?<![\w\u4e00-\u9fff])当前轮次(?![\w\u4e00-\u9fff])",
        ],
        "FP-6": [
            r"(?<![\w\u4e00-\u9fff])循环状态(?![\w\u4e00-\u9fff])",
            r"(?<![\w\u4e00-\u9fff])审查状态(?![\w\u4e00-\u9fff])",
            r"(?<![\w\u4e00-\u9fff])是否通过(?![\w\u4e00-\u9fff])",
        ],
        "FP-7": [
            r"(?<![\w\u4e00-\u9fff])不要审查(?![\w\u4e00-\u9fff])",
            r"(?<![\w\u4e00-\u9fff])限制范围(?![\w\u4e00-\u9fff])",
            r"(?<![\w\u4e00-\u9fff])跳过审查(?![\w\u4e00-\u9fff])",
        ],
    }.items()}

    # Exempt contexts: code blocks, inline code, quoted reference (Detection Rule 3)
    _CODE_BLOCK_RE = re.compile(r"```[\s\S]*?```", re.DOTALL)
    _INLINE_CODE_RE = re.compile(r"`[^`]+`")
    _QUOTED_RE = re.compile(r'"[^"]*"|' + r"'[^']*'")

    def validate(self, prompt: str) -> ValidationResult:
        text = self._CODE_BLOCK_RE.sub("", prompt)
        text = self._INLINE_CODE_RE.sub("", text)
        text = self._QUOTED_RE.sub("", text)
        matches = self._match_compiled(text, self.EN_COMPILED, "en") + \
                  self._match_compiled(text, self.ZH_COMPILED, "zh")
        return ValidationResult(is_valid=len(matches) == 0, matches=matches)

    def _match_compiled(self, text, compiled_map, lang):
        matches = []
        for category, cps in compiled_map.items():
            for cp in cps:
                for m in cp.finditer(text):
                    matches.append(PatternMatch(category, m.group(), text[:m.start()].count("\n") + 1, lang))
        return matches
```

---

## RollbackEngine Design

```python
class RollbackEngine:
    def rollback(self, event, plan, context: PipelineContext) -> RollbackResult:
        handlers = {
            "SKIP_RED_PHASE": self._delete_implementation,
            "MODIFIED_TEST": self._restore_test,
        }
        handler = handlers.get(event.violation_type)
        if handler:
            return handler(event, context)
        return RollbackResult(True, "no-op", [], None)

    def _delete_implementation(self, event, context) -> RollbackResult:
        filepath = event.affected_file_path
        if not self._validate_path(filepath):
            return RollbackResult(False, "path validation failed", [], None)
        if self._is_tracked(filepath):
            r = subprocess.run(["git", "rm", "-f", filepath], capture_output=True, text=True)
            if r.returncode != 0:
                return RollbackResult(False, f"git rm failed: {r.stderr}", [], None)
        elif os.path.exists(filepath):
            os.remove(filepath)
        return RollbackResult(True, "deleted implementation", [filepath], None)

    def _restore_test(self, event, context: PipelineContext) -> RollbackResult:
        filepath = event.affected_file_path
        if not self._validate_path(filepath):
            return RollbackResult(False, "path validation failed", [], None)
        if not self._is_tracked(filepath):
            return RollbackResult(False, "skip (untracked)", [], None)
        commit_ref = context.boundary_commit_hash or "HEAD"
        r = subprocess.run(["git", "checkout", commit_ref, "--", filepath], capture_output=True, text=True)
        if r.returncode != 0:
            return RollbackResult(False, f"git checkout failed: {r.stderr}", [], None)
        h = subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True)
        return RollbackResult(True, f"restored test from {commit_ref}", [filepath], h.stdout.strip())

    def _validate_path(self, filepath: str) -> bool:
        repo_root = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True).stdout.strip()
        abs_path = os.path.abspath(filepath)
        return abs_path.startswith(repo_root) and ".." not in filepath

    def _is_tracked(self, filepath: str) -> bool:
        r = subprocess.run(["git", "ls-files", filepath], capture_output=True, text=True)
        return r.stdout.strip() != ""
```

---

## KiDocManager Design

```python
class KiDocManager:
    def __init__(self, ki_doc_path: str):
        self.ki_doc_path = ki_doc_path

    def record_intervention(self, event, plan, rollback_result, validation_result=None):
        self._append(self._format_intervention_entry(event, plan, rollback_result, validation_result))

    def ensure_assessment(self, phase, next_phase, status, issues):
        self._append(self._format_assessment_entry(phase, next_phase, status, issues))

    def ensure_updated(self, last_intervention_ts):
        newest_ts = self._parse_newest_timestamp()
        return not (newest_ts and newest_ts < last_intervention_ts)

    def record_merge(self, events, context):
        self._append(self._format_merge_entry(events, context))

    def _parse_newest_timestamp(self):
        p = Path(self.ki_doc_path)
        if not p.exists(): return None
        matches = re.findall(r"\*\*Timestamp\*\*:\s*(\d{4}-\d{2}-\d{2}T[\d:]+[+-]\d{2}:\d{2})", p.read_text())
        return matches[-1] if matches else None

    def _append(self, entry):
        p = Path(self.ki_doc_path)
        if not p.exists():
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text("# Review Records\n\n")
        with open(p, "a") as f:
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
        subprocess.run(["git", "add", "-u"], capture_output=True, text=True)  # tracked files only
        r = subprocess.run(["git", "commit", "-m", msg], capture_output=True, text=True)
        if r.returncode != 0:
            return CommitResult(False, f"commit failed: {r.stderr}", None)
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
| Git checkout/rm fails (rollback) | Key | Return RollbackResult(success=False), log error. Coordinator checks result before blocking. |
| Ki doc write fails | Peripheral | Log error, continue. Best-effort. |
| Prompt too long for regex | Peripheral | Truncate to 10KB, log truncation |
| Multiple violations same event | Key | intervene_batch(): priority table (P1>P2>P3>P4>P5), handle highest only |
| Unknown violation_type | Peripheral | Log warning, return (no block) |
| Empty diff at boundary | Peripheral | Skip commit, log |
| Git unavailable | Key | Log error, raise TDDViolationError without auto-fix |
| Partial rollback failure | Key | RollbackResult.partial_failure=True, failed_files list |
| Path validation failure | Key | Return RollbackResult(success=False), log warning |
| Git index locked | Peripheral | Retry once after 1s, then raise without auto-fix |

---

## Non-functional Constraints

| Dimension | Requirement | Design Response |
|-----------|-------------|-----------------|
| Concurrency | SYNC: block immediately | TDDViolationError (synchronous exception) |
| Reversibility | Destructive ops reversible | Pre-rollback commit; git reflog |
| Data isolation | No sensitive data in LLM | ViolationEvent: paths + metadata only |
| Resources | Regex scan < 100ms | Pre-compiled patterns at class load |
| Extension | New violation types easy | Plan builder dict; add entry = add support |
| Latency | Intervention < 500ms | File I/O + git CLI fast; regex < 100ms |
| Cost | No third-party | All local git + filesystem |
| Security | Path traversal prevention | _validate_path() on all file ops |

---

## Observability

| Signal | Log | Alert |
|--------|-----|-------|
| Intervention triggered | violation_code, phase, auto_fix_applied | > 5 per pipeline |
| Auto-fix failed | violation_code, error, rollback_result | Any failure |
| Prompt blocked | matched patterns, FP categories | > 3 per pipeline |
| Commit skipped | empty diff at boundary | > 3 consecutive |
| Unknown violation dropped | violation_type, warning | > 3 per pipeline |

---

## Existing Module Dependencies

| Module | Used By | Change Required |
|--------|---------|-----------------|
| watchdog.py (ViolationFilter) | InterventionCoordinator | **CHANGED**: Must pass all 13 types (was only 3) |
| watchdog.py (ViolationEvent) | All | None |
| committer.py (AutoCommitter) | CommitGuard | None |
| rule_generator.py | None (not used) | Listed for reference only |

**Migration Note**: `WatchdogIntervener` -> `InterventionCoordinator`. `RemediationPlan` -> `InterventionPlan`. `TDDViolationError` gains 3rd arg `InterventionResult`. Phase name [3] unified to `PHASE-3-TEST-PLAN`. MISSING_TEST auto_fix=False (was True with skeleton).

---

## Open Technical Questions (resolved)

1. **V-5 last legitimate commit**: Resolved via `PipelineContext.boundary_commit_hash`.
2. **V-7 regression detection**: Resolved via `PipelineContext.phase5_test_results`. V-7 plan uses `auto_fix=False` (mark + flag, no git rollback).

---

*Document created: 2026-05-25*
*Version: v1.2 (R2: all R1/R2 fixes applied)*
*Phase: 2 (Technical Solution)*
*Next: Ralph Loop R3 Review*

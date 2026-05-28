# Technical Design: Watchdog Intervention for TDD Pipeline

> **Version**: v1.7
> **Status**: Updated post Phase 5 R5 — design aligned with implementation
> **Branch**: feature/watchdog-intervention
> **Phase**: 2 (Technical Solution)
> **Based on**: intervention-requirements-v1.md (v1.4, gate passed)
> **Changelog v1.6**: R5 design alignment — ZH bare patterns (was lookaround), dynamic target_phase (was hardcoded), REGRESSION instruction clarified, dual field model documented
> **Changelog v1.5**: KI-10 multi-file rollback pseudocode, _validate_path leading-dash check
> **Changelog v1.4**: R4 fixes — intervene_batch priority: non-mergeable first (F-12); assessment priority breakdown (F-13)

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
    affected_file_paths: List[str] = field(default_factory=list)  # Multi-file rollback (KI-10)
```
**Design note**: `affected_file_path` (singular) is used for single-file operations. `affected_file_paths` (plural) is used for multi-file rollback via RollbackEngine. When `affected_file_paths` is non-empty, RollbackEngine iterates per-file; otherwise falls back to `affected_file_path`.

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
    metadata: Dict[str, Any] = field(default_factory=dict)  # round_results, etc. for assessment
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
| Regex for V-13 (bare patterns for ZH, word-boundary for EN) | Bare ZH patterns avoid false negatives from CJK adjacency; EN uses \b | LLM semantic detection: v2; ZH lookaround: causes false negatives |
| Exception-based blocking | SYNC mode requires immediate blocking | Return code + poll: adds complexity |
| Pre-rollback commit | Before destructive op, work never lost | Backup branches: creates clutter |
| ViolationFilter expansion | Must pass all 13 types (was only 3) | Separate filter per category |
| boundary_commit_hash for V-5 | HEAD may include Phase 5 modifications | Always HEAD: incorrect |
| Path validation | Prevent path traversal before git ops | Trust internal paths: security risk |
| git add -u instead of -A | Only stage tracked files, not untracked | git add -A: stages unrelated files |
| Pre-rollback uses `git add <file>` | Before rollback to earlier phase, stage affected files specifically (tracked or untracked) to preserve work per AC-I22 | git add -u misses untracked new files |

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
            else:
                return  # Watchdog false positive — prompt is actually clean. logger.info("V-13 false positive cleared")

        # 4. Build plan
        plan = self._build_plan(event)

        # 5. Pre-rollback commit (safety net for destructive ops + phase rollback)
        if plan.is_destructive or plan.target_phase < self.context.current_phase:
            # Stage ALL affected files (handles untracked files per AC-I22, multi-file per KI-10)
            files_to_stage = list(event.affected_file_paths) if event.affected_file_paths else (
                [event.affected_file_path] if event.affected_file_path else []
            )
            for fp in files_to_stage:
                subprocess.run(["git", "add", fp], capture_output=True, text=True)
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
        """Merge Rule: V-10/V-11 -> V-12 -> V-8/V-9, handle highest priority.
        Mergeable violations deferred when non-mergeable exists — REQUIRES Watchdog to re-emit all remaining violations on next scan."""
        if not events:
            return
        sorted_events = sorted(events, key=lambda e: VIOLATION_PRIORITY.get(e.violation_type, 99))
        mergeable = [e for e in sorted_events if e.violation_type in
                     {"MISSING_KI_DOC", "KI_DOC_OUTDATED", "UNCOMMITTED_PHASE",
                      "UNCOMMITTED_REVIEW", "MISSING_KI_ASSESSMENT"}]
        non_mergeable = [e for e in sorted_events if e not in mergeable]
        # Mergeable violations deferred when non-mergeable exists — pipeline retry re-triggers detection
        if non_mergeable:
            self.intervene(non_mergeable[0])
        elif mergeable:
            self._handle_merged(mergeable)

    def _handle_merged(self, events):
        # Step 1: V-10/V-11 (commit first)
        for e in events:
            if e.violation_type in {"UNCOMMITTED_PHASE", "UNCOMMITTED_REVIEW"}:
                self.commit_guard.ensure_committed(self.context)
        # Step 2: V-12 (assessment)
        for e in events:
            if e.violation_type == "MISSING_KI_ASSESSMENT":
                status, issues, priority_counts = self._compute_assessment()
                self.ki_doc.ensure_assessment(self.context.current_phase, self.context.current_phase + 1, status, issues, priority_counts)
        # Step 3: V-8/V-9 (ki doc) — single merged entry only
        ki_events = [e for e in events if e.violation_type in {"MISSING_KI_DOC", "KI_DOC_OUTDATED"}]
        if ki_events:
            self.ki_doc.record_merge(events, self.context)
        # Step 4: Commit ki doc changes
        self.commit_guard.ensure_committed(self.context)
        # Step 5: Block pipeline (AC-I21: all violations block)
        merged_result = InterventionResult(
            violation_code="MERGED:" + ",".join(e.violation_type for e in events),
            target_phase=self.context.current_phase,
            auto_fix_applied=True, auto_fix_details="merged auto-fix",
            instruction="(auto-fixed)", ki_doc_updated=True, committed=True,
            rollback_result=None, validation_result=None)
        raise TDDViolationError(events[0], self._build_plan(events[0]), merged_result)

    def _compute_assessment(self):
        # Derive assessment status from Ralph Loop results in context
        round_results = self.context.metadata.get("round_results", [])
        last_round = round_results[-1] if round_results else {}
        c, h, m = last_round.get("C", 0), last_round.get("H", 0), last_round.get("M", 0)
        p_count = last_round.get("P", 0)
        l_count = last_round.get("L", 0)
        priority_counts = {"P0": c, "P1": h, "P2": m, "P3": p_count, "P4": l_count}
        if c > 0 or h > 0:
            return "FAIL", [f"{c}C/{h}H/{m}M unresolved"], priority_counts
        elif m > 0:
            return "CONDITIONAL", [f"{m}M unresolved"], priority_counts
        return "PASS", [], priority_counts

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
            # Behavioral: target_phase from event context (Watchdog sets correct phase; _is_valid_event validates "phase" key exists)
            "SKIP_RED_PHASE":         InterventionPlan(event.context.get("phase", 4), True, True, True, "Write failing test before implementation"),
            "MODIFIED_TEST":          InterventionPlan(event.context.get("phase", 5), True, True, True, "Write implementation to make ORIGINAL test pass"),
            "MISSING_TEST":           InterventionPlan(event.context.get("phase", 4), False, False, False, "Write test for this module first"),
            # AC-I10: always Phase 5 (Green phase, fix implementation) — not dynamic
            "REGRESSION":             InterventionPlan(5, False, False, False, "Regression detected — return to Phase 5 and fix the failing implementation"),
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

    # Pre-compiled Chinese patterns
    # Design Decision: bare patterns (no lookaround) for Chinese.
    # Rationale: Lookaround assertions (?<![\w\u4e00-\u9fff])...(?![\w\u4e00-\u9fff]) caused
    # false negatives — CJK characters immediately adjacent to target phrases prevented matching.
    # Chinese text has no spaces between words, so forbidden phrases are always adjacent to CJK chars.
    # Bare patterns match correctly in all tested scenarios.
    ZH_COMPILED = {k: [re.compile(p) for p in ps] for k, ps in {
        "FP-1": [
            r"停止条件",
            r"连续2轮",
            r"连续两轮",
            r"审查达标",
            r"质量达标",
        ],
        "FP-2": [
            r"累计计数",
            r"累计统计",
            r"总[CHM]数",
        ],
        "FP-3": [
            r"上一轮",
            r"前一轮",
            r"上轮发现",
            r"之前发现",
        ],
        "FP-4": [
            r"修复列表",
            r"已修复",
            r"已解决",
            r"修改清单",
        ],
        "FP-5": [
            r"第\d+轮",
            r"第几轮",
            r"当前轮次",
            r"loop轮次",
        ],
        "FP-6": [
            r"循环状态",
            r"审查状态",
            r"是否通过",
        ],
        "FP-7": [
            r"只检查[\w\u4e00-\u9fff]+",
            r"不要审查",
            r"限制范围",
            r"跳过审查",
        ],
    }.items()}

    # Exempt contexts: code blocks, inline code, quoted reference (Detection Rule 3), headings (Detection Rule 4)
    _CODE_BLOCK_RE = re.compile(r"```[\s\S]*?```", re.DOTALL)
    _INLINE_CODE_RE = re.compile(r"`[^`]+`")
    _QUOTED_RE = re.compile(r'"[^"]*"|' + r"'[^']*'")
    _HEADING_RE = re.compile(r"^#{1,6}\s+.*$", re.MULTILINE)

    def validate(self, prompt: str) -> ValidationResult:
        text = self._CODE_BLOCK_RE.sub("", prompt)
        text = self._INLINE_CODE_RE.sub("", text)
        text = self._QUOTED_RE.sub("", text)
        text = self._HEADING_RE.sub("", text)
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
        if not handler:
            return RollbackResult(True, "no-op", [], None)

        # Multi-file rollback via affected_file_paths (KI-10)
        all_paths = list(event.affected_file_paths) if event.affected_file_paths else (
            [event.affected_file_path] if event.affected_file_path else []
        )

        if len(all_paths) > 1:
            succeeded, failed = [], []
            for fp in all_paths:
                single_event = ViolationEvent(
                    event.violation_type, fp, event.timestamp, event.context, [])
                result = handler(single_event, context)
                (succeeded if result.success else failed).append(fp)
            if failed and succeeded:
                return RollbackResult(True, "partial rollback", succeeded, None,
                                      partial_failure=True, failed_files=failed)
            elif failed:
                return RollbackResult(False, "all files failed", [], None)
            return RollbackResult(True, "all files rolled back", succeeded, None)

        return handler(event, context)

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
        commit_ref = context.boundary_commit_hash or "HEAD"  # Key Decision: HEAD is fallback if boundary not set
        if not context.boundary_commit_hash:
            logger.warning("V-5: boundary_commit_hash not set, falling back to HEAD")
        r = subprocess.run(["git", "checkout", commit_ref, "--", filepath], capture_output=True, text=True)
        if r.returncode != 0:
            return RollbackResult(False, f"git checkout failed: {r.stderr}", [], None)
        h = subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True)
        return RollbackResult(True, f"restored test from {commit_ref}", [filepath], h.stdout.strip())

    def _validate_path(self, filepath: str) -> bool:
        if filepath.startswith("-"):
            return False
        r = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True)
        if r.returncode != 0:
            return False  # git unavailable
        repo_root = r.stdout.strip()
        if not repo_root:
            return False  # empty repo root
        abs_path = os.path.normpath(os.path.join(repo_root, filepath))
        return (abs_path == repo_root or abs_path.startswith(repo_root + os.sep)) and ".." not in filepath

    def _is_tracked(self, filepath: str) -> bool:
        r = subprocess.run(["git", "ls-files", filepath], capture_output=True, text=True)
        if r.returncode != 0:
            return False
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

    def ensure_assessment(self, phase, next_phase, status, issues, priority_counts=None):
        self._append(self._format_assessment_entry(phase, next_phase, status, issues, priority_counts))

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

## Requirements Deviations (v1.4 → v1.6)

| AC | Requirements Say | Implementation Does | Rationale |
|----|-----------------|---------------------|-----------|
| AC-I19 | "Chinese forbidden patterns detected using lookaround-based matching" | Bare patterns (no lookaround) for ZH | Lookaround `(?<![\w\u4e00-\u9fff])...(?![\w\u4e00-\u9fff])` caused false negatives — Chinese forbidden phrases are always adjacent to CJK characters (no spaces). Bare patterns match correctly in all tested scenarios. 30 ZH tests GREEN. |
| AC-I8 | "target_phase = 4 (Red phase, write test first)" — hardcoded | `event.context.get("phase", 4)` — dynamic from event context | `_is_valid_event` validates "phase" key exists. Watchdog always sets correct phase. Dynamic approach preserves flexibility if phase detection evolves. Default fallback matches spec value. |
| AC-I9 | "rollback to Phase 5, require fix implementation" | `target_phase=5, auto_fix=False, needs_rollback=False` — flags for LLM resolution | V-7 has no system auto-fix (can't automatically fix regressions). Pipeline is correctly blocked via TDDViolationError. LLM receives instruction to return to Phase 5 and fix. |

---

*Document created: 2026-05-25*
*Version: v1.7 (Phase 2: formal deviation table added, Key Decisions updated, REGRESSION instruction strengthened, pre-rollback multi-file fix)*
*Phase: 2 (Technical Solution)*
*Next: Phase 2 re-review → Phase 3-5 validation → Phase 6 Pre-Release Testing*

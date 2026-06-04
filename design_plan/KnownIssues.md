# Known Issues — quality-assurance-implementation-plan.md

> Ralph Loop Review for TDD Phase 2 Technical Solution.
> Populated retroactively from Rounds 1–5 review records (附录 E–I).
> Protocol: `ralph-continuation.md` §Known Issues Lifecycle.

## KI-001
- **Raised in**: Round 1
- **Severity**: L
- **Source**: R1 Precision REJECT (1 of 11 rejected)
- **Location**: 附录 E
- **Description**: Recall finding rejected by Precision — exact topic unknown (session transcript not recoverable). REJECT count = 11 in R1.
- **Why deferred**: Precision subagent determined the finding was a false positive.
- **Plan**: No action unless re-raised in future round.
- **Re-raised-in**: —

## KI-002
- **Raised in**: Round 2
- **Severity**: L
- **Source**: R2 Precision REJECT (4 rejected) + MERGE (2 merged: F-7→F-1, F-15→F-14)
- **Location**: 附录 F
- **Description**: 4 findings rejected + 2 merged by Precision. Exact topics unknown (session transcript not recoverable).
- **Why deferred**: Precision subagent determined findings were false positives or duplicates.
- **Plan**: No action unless re-raised in future round.
- **Re-raised-in**: —

## KI-003
- **Raised in**: Round 3
- **Severity**: L (×10) + I (×3)
- **Source**: R3 Precision — 10 CONFIRM L + 3 CONFIRM I + 1 REJECT (dup)
- **Location**: 附录 G
- **Description**: R3 produced many L/I findings. Only 7 M-level were adopted. Per §附录 G 校准说明: "L 级 findings (F-7, F-8, F-9, F-11-13, F-15, F-17, F-20-22) 保留记录但不做修复，属于实施细节或风险提示。I 级 findings (F-16, F-18, F-23) 保留记录但不做修复，属于信息备注。"
- **Why deferred**: L = 实施细节或风险提示；I = 信息备注。Phase 2 范畴内不修复。
- **Plan**: Carry into Phase 3 implementation as advisory notes.
- **Re-raised-in**: —

## KI-004
- **Raised in**: Round 4
- **Severity**: L (×1) + REJECT (×2)
- **Source**: R4 Precision — 1 CONFIRM L + 2 REJECT
- **Location**: 附录 H
- **Description**: R4-F10 (L, B 级 consecutiveZero 描述修正) was adopted. 2 findings rejected by Precision. Exact topics unknown.
- **Why deferred**: Precision determined false positives.
- **Plan**: No action unless re-raised.
- **Re-raised-in**: —

## KI-005
- **Raised in**: Round 5
- **Severity**: L (×2)
- **Source**: R5 Precision — 2 CONFIRM L (R5-F3, R5-F4)
- **Location**: 附录 I
- **Description**: R5-F3 (S 级终止 phaseStatus 值) and R5-F4 (Reviewer Prompt 时序约束) were adopted as Low fixes.
- **Why deferred**: Already adopted and fixed in v1.9.
- **Plan**: Closed.
- **Re-raised-in**: —

---

## KI Re-evaluation Log

| Round | KIs Evaluated | Result |
|-------|---------------|--------|
| R3 | — | (First KI evaluation round; KIs established from R1-R3 findings) |
| R6 | — | (Skipped — protocol violation: KI document did not exist at R6 time) |
| R8 | KI-001 through KI-005 | Pending evaluation in R8 |
| R10 | — | (R10 跳过；下次重评估为 R11) |

## Final Evaluation

(To be completed at loop end)

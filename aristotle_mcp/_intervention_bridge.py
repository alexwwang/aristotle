"""Bridge module exposing InterventionCoordinator.intervene_from_signal to TS.

This module is invoked via `python -m aristotle_mcp._cli intervene_batch`.
Reads JSON payload from stdin, builds PipelineContext + per-violation signals,
calls InterventionCoordinator.intervene_from_signal for each, and emits a
structured JSON response on stdout.

Input JSON schema:
    {
        "context": {
            "project_id": "...",
            "run_id": "...",
            "phase": N,
            "current_phase": N,
            "ki_doc_path": "..."
        },
        "violations": [
            {
                "signal": "skip-red-phase",
                "context": {...},
                "affected_file_path": "...",
                "affected_file_paths": [...]
            }
        ]
    }

Output JSON schema:
    {
        "results": [
            {
                "violation_type": "...",
                "action": "...",
                "success": bool,
                "user_message": "...",
                "files_affected": [...],
                "pipeline_action": "..."
            }
        ],
        "total": N,
        "succeeded": N,
        "failed": N,
        "error": null | str
    }

Fault tolerance: any internal error returns an empty result with `error` set,
so the TS watchdog never crashes when Python is unavailable or input is bad.
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any, Dict, List

# Make intervention/src/ importable as bare module names
# (intervention_coordinator, intervention_types, signal_mapper, etc.)
_INTERVENTION_SRC = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "intervention",
    "src",
)
if _INTERVENTION_SRC not in sys.path:
    sys.path.append(_INTERVENTION_SRC)


def _empty_result(error: Any = None) -> Dict[str, Any]:
    return {
        "results": [],
        "total": 0,
        "succeeded": 0,
        "failed": 0,
        "error": str(error) if error else None,
    }


def _build_context(context_in: Dict[str, Any]):
    """Build a PipelineContext from the input context dict."""
    from intervention_types import PipelineContext

    current_phase = context_in.get("current_phase", context_in.get("phase", 0))
    if not isinstance(current_phase, int) or isinstance(current_phase, bool):
        current_phase = 0

    req_number = context_in.get("run_id")
    if req_number is None:
        req_number = context_in.get("req_number", "")
    ki_doc_path = context_in.get("ki_doc_path")
    if not ki_doc_path:
        ki_doc_path = os.path.join(
            os.path.dirname(_INTERVENTION_SRC), ".ki-docs"
        )

    return PipelineContext(
        current_phase=current_phase,
        req_number=str(req_number),
        ki_doc_path=ki_doc_path,
    )


def _result_to_dict(result: Any) -> Dict[str, Any]:
    """Convert an InterventionResult (either variant) into a JSON-safe dict."""
    files_affected: List[str] = []
    files = getattr(result, "files_affected", None)
    if isinstance(files, list):
        files_affected = [str(f) for f in files if f]

    return {
        "violation_type": getattr(result, "violation_type", "") or getattr(result, "violation_code", ""),
        "action": getattr(result, "action", ""),
        "success": bool(getattr(result, "success", False)),
        "user_message": getattr(result, "user_message", "") or getattr(result, "instruction", ""),
        "files_affected": files_affected,
        "pipeline_action": getattr(result, "pipeline_action", None),
    }


def run_intervene_batch(data_json: str) -> Dict[str, Any]:
    """Entry point invoked by _cli.py 'intervene_batch' subcommand.

    Parses `data_json` (JSON string), dispatches each violation to
    InterventionCoordinator.intervene_from_signal, and returns a structured
    result dict.

    NOTE: Despite the similar name, this does NOT call
    InterventionCoordinator.intervene_batch(). The coordinator's
    intervene_batch() applies priority-sort + first-non-mergeable-only
    semantics. This bridge function iterates ALL violations individually
    via intervene_from_signal() so the TS watchdog sees every result.

    Fault tolerance: returns an empty-result envelope on any error rather
    than raising, so the TS watchdog can never be crashed by Python.
    """
    try:
        payload = json.loads(data_json) if data_json else {}
    except json.JSONDecodeError as e:
        return _empty_result(f"Invalid JSON input: {e}")

    if not isinstance(payload, dict):
        return _empty_result("Payload must be a JSON object")

    context_in = payload.get("context") or {}
    if not isinstance(context_in, dict):
        return _empty_result("payload.context must be a JSON object")

    violations = payload.get("violations") or []
    if not isinstance(violations, list):
        return _empty_result("payload.violations must be a list")

    if not violations:
        return {
            "results": [],
            "total": 0,
            "succeeded": 0,
            "failed": 0,
            "error": None,
        }

    # Lazy import — keeps aristotle_mcp importable when intervention/src
    # is not on the path
    try:
        from intervention_coordinator import (
            InterventionCoordinator,
            TDDViolationError,
        )
    except Exception as e:
        return _empty_result(f"Failed to import intervention_coordinator: {e}")

    try:
        ctx = _build_context(context_in)
        coordinator = InterventionCoordinator(ctx)
    except Exception as e:
        return _empty_result(f"Failed to construct InterventionCoordinator: {e}")

    results: List[Dict[str, Any]] = []
    succeeded = 0
    failed = 0
    errors: List[str] = []

    for idx, violation in enumerate(violations):
        if not isinstance(violation, dict):
            results.append({
                "violation_type": "",
                "action": "skipped",
                "success": False,
                "user_message": f"Violation #{idx} is not an object",
                "files_affected": [],
                "pipeline_action": None,
            })
            failed += 1
            continue

        signal = violation.get("signal")
        if not signal or not isinstance(signal, str):
            results.append({
                "violation_type": "",
                "action": "skipped",
                "success": False,
                "user_message": f"Violation #{idx} missing 'signal' field",
                "files_affected": [],
                "pipeline_action": None,
            })
            failed += 1
            continue

        # Build context for this violation: merge outer context defaults
        # with per-violation context. Per-violation wins.
        violation_context: Dict[str, Any] = {
            "phase": ctx.current_phase,
            "run_id": ctx.req_number,
        }
        per_violation_ctx = violation.get("context") or {}
        if isinstance(per_violation_ctx, dict):
            violation_context.update(per_violation_ctx)
        # Ensure phase + run_id always present
        violation_context.setdefault("phase", ctx.current_phase)
        violation_context.setdefault("run_id", ctx.req_number)
        # Surface file paths in context.handlers._get_files lookup path
        files_list: List[str] = []
        if violation.get("affected_file_paths"):
            files_list = list(violation["affected_file_paths"])
        elif violation.get("affected_file_path"):
            files_list = [violation["affected_file_path"]]
        if files_list:
            violation_context.setdefault("files", files_list)

        try:
            result = coordinator.intervene_from_signal(signal, violation_context)
            if result is None:
                # intervene_from_signal should never return None, but guard
                result_dict = {
                    "violation_type": signal,
                    "action": "noop",
                    "success": True,
                    "user_message": "",
                    "files_affected": [],
                    "pipeline_action": None,
                }
            else:
                result_dict = _result_to_dict(result)
                # Fill in violation_type if blank (handler may have skipped)
                if not result_dict["violation_type"]:
                    result_dict["violation_type"] = signal
            results.append(result_dict)
            if result_dict["success"]:
                succeeded += 1
            else:
                failed += 1
        except TDDViolationError as e:
            # Behavioral violations raise; extract .result if present
            result_obj = getattr(e, "result", None)
            if result_obj is not None:
                result_dict = _result_to_dict(result_obj)
            else:
                result_dict = {
                    "violation_type": signal,
                    "action": "blocked",
                    "success": False,
                    "user_message": str(e),
                    "files_affected": [],
                    "pipeline_action": None,
                }
            results.append(result_dict)
            if result_dict["success"]:
                succeeded += 1
            else:
                failed += 1
        except ValueError as e:
            # Unknown signal or invalid context — record but continue
            results.append({
                "violation_type": signal,
                "action": "skipped",
                "success": False,
                "user_message": f"ValueError: {e}",
                "files_affected": [],
                "pipeline_action": None,
            })
            failed += 1
            errors.append(f"#{idx}: {e}")
        except Exception as e:
            # Catch-all: never let one violation break the batch
            results.append({
                "violation_type": signal,
                "action": "error",
                "success": False,
                "user_message": f"{type(e).__name__}: {e}",
                "files_affected": [],
                "pipeline_action": None,
            })
            failed += 1
            errors.append(f"#{idx}: {type(e).__name__}: {e}")

    error_summary: Any = None
    if errors:
        error_summary = "; ".join(errors)

    return {
        "results": results,
        "total": len(results),
        "succeeded": succeeded,
        "failed": failed,
        "error": error_summary,
    }

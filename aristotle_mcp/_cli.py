"""CLI entry point for Bridge Plugin subprocess calls.

Usage:
  python -m aristotle_mcp._cli orchestrate_on_event <event_type>
  python -m aristotle_mcp._cli orchestrate_start <command>
  python -m aristotle_mcp._cli pipeline_reset
  python -m aristotle_mcp._cli rollback_to_checkpoint
  python -m aristotle_mcp._cli create_rollback_point

Reads data_json from stdin (avoids ARG_MAX limit on large payloads).
Writes result JSON to stdout.
"""

import sys
import json
from aristotle_mcp._orch_event import orchestrate_on_event
from aristotle_mcp._orch_start import orchestrate_start


def main():
    if len(sys.argv) < 2:
        sys.stderr.write("Usage: python -m aristotle_mcp._cli <subcommand> <arg>\n")
        print(json.dumps({"error": "Usage: python -m aristotle_mcp._cli <subcommand> <arg>"}))
        sys.exit(1)

    subcommand = sys.argv[1]
    data_json = sys.stdin.read()

    try:
        if subcommand == "orchestrate_start":
            # arg = command type: "learn", "reflect", "review"
            command = sys.argv[2] if len(sys.argv) > 2 else "reflect"
            result = orchestrate_start(command, data_json)
        elif subcommand == "intervene_batch":
            from aristotle_mcp._intervention_bridge import run_intervene_batch

            result = run_intervene_batch(data_json)
        elif subcommand == "pipeline_reset":
            from aristotle_mcp._tools_reset import pipeline_reset
            from aristotle_mcp.config import resolve_repo_dir

            result = pipeline_reset(str(resolve_repo_dir()))
        elif subcommand == "rollback_to_checkpoint":
            from aristotle_mcp._tools_rollback import rollback_to_checkpoint

            data = json.loads(data_json) if data_json else {}
            result = rollback_to_checkpoint(data.get("name", ""), data.get("run_id", ""))
        elif subcommand == "create_rollback_point":
            from aristotle_mcp._tools_rollback import create_rollback_point

            data = json.loads(data_json) if data_json else {}
            result = create_rollback_point(data.get("name", ""), data.get("run_id", ""))
        else:
            # Default: orchestrate_on_event with event_type
            if not data_json:
                sys.stderr.write("No data provided on stdin\n")
                print(json.dumps({"error": "No data provided on stdin"}))
                sys.exit(1)
            result = orchestrate_on_event(subcommand, data_json)
            print(json.dumps(result))
            return
        print(json.dumps(result))
    except Exception as e:
        # Write error JSON to stdout AND detail to stderr.
        # stdout error JSON lets the TS side parse it even on exit(1).
        err_json = json.dumps({"error": str(e)})
        sys.stderr.write(f"{subcommand} error: {e}\n")
        print(err_json)
        sys.exit(1)


if __name__ == "__main__":
    main()

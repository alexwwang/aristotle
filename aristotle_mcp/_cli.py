"""CLI entry point for Bridge Plugin subprocess calls.

Usage:
  python -m aristotle_mcp._cli orchestrate_on_event <event_type>
  python -m aristotle_mcp._cli orchestrate_start <command>
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

    if not data_json:
        sys.stderr.write("No data provided on stdin\n")
        print(json.dumps({"error": "No data provided on stdin"}))
        sys.exit(1)

    try:
        if subcommand == "orchestrate_start":
            # arg = command type: "learn", "reflect", "review"
            command = sys.argv[2] if len(sys.argv) > 2 else "reflect"
            result = orchestrate_start(command, data_json)
        else:
            # Default: orchestrate_on_event with event_type
            result = orchestrate_on_event(subcommand, data_json)
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

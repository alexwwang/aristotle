"""CLI entry point for Bridge Plugin subprocess calls.

Usage: python -m aristotle_mcp._cli <event_type>
Reads data_json from stdin (avoids ARG_MAX limit on large payloads).
Writes result JSON to stdout.
"""
import sys
import json
from aristotle_mcp._orch_event import orchestrate_on_event


def main():
    if len(sys.argv) < 2:
        sys.stderr.write("Usage: python -m aristotle_mcp._cli <event_type>\n")
        print(json.dumps({"error": "Usage: python -m aristotle_mcp._cli <event_type>"}))
        sys.exit(1)

    event_type = sys.argv[1]
    data_json = sys.stdin.read()

    if not data_json:
        sys.stderr.write("No data provided on stdin\n")
        print(json.dumps({"error": "No data provided on stdin"}))
        sys.exit(1)

    try:
        result = orchestrate_on_event(event_type, data_json)
        print(json.dumps(result))
    except Exception as e:
        # Write error JSON to stdout AND detail to stderr.
        # stdout error JSON lets the TS side parse it even on exit(1).
        err_json = json.dumps({"error": str(e)})
        sys.stderr.write(f"orchestrate_on_event error: {e}\n")
        print(err_json)
        sys.exit(1)


if __name__ == "__main__":
    main()

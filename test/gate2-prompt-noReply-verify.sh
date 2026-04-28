#!/usr/bin/env bash
# Gate #2 Verification: Does session.prompt({noReply: true}) hang? Is the message visible?
#
# Tests TWO dimensions:
#   1. Non-blocking: prompt() + noReply:true returns within 5 seconds (does NOT hang)
#   2. Visibility:   the message is readable via session.messages() afterward
#
# Uses opencode serve + SDK (same pattern as gate1).
#
# Prerequisites:
#   - opencode CLI installed
#   - bun available
#
# Usage:
#   bash test/gate2-prompt-noReply-verify.sh
#
# Exit codes:
#   0 - Gate passed (non-blocking + message visible)
#   1 - Gate failed (blocked or message invisible)
#   2 - Setup error

set -euo pipefail

MARKER="GATE2_$(date +%s)"
PORT=14097
TIMEOUT_SECS=5
TMPDIR_GATE=$(mktemp -d)

cleanup() { rm -rf "$TMPDIR_GATE"; }
trap cleanup EXIT

echo "=== Gate #2: session.prompt({noReply:true}) non-blocking + visibility ==="
echo "Marker: $MARKER"
echo "Timeout: ${TIMEOUT_SECS}s"
echo ""

# ── Step 1: Write SDK verification script ───────────────────

cat > "$TMPDIR_GATE/verify.ts" << VERIFYTS
import { createOpencodeClient } from "@opencode-ai/sdk"

const PORT = ${PORT}
const MARKER = "${MARKER}"
const TIMEOUT = ${TIMEOUT_SECS}
const client = createOpencodeClient({ baseUrl: \`http://127.0.0.1:\${PORT}\` })

async function main() {
  // 1. Create a session
  const session = await client.session.create({ body: { title: "Gate #2 Test" } })
  const sid = session.data.id
  console.log("Session created:", sid)

  // 2. Call prompt() with noReply:true and measure time
  console.log("Calling prompt({noReply:true})...")
  const start = Date.now()

  let promptResult: any
  let timedOut = false

  try {
    promptResult = await Promise.race([
      client.session.prompt({
        path: { id: sid },
        body: {
          noReply: true,
          parts: [{ type: "text", text: \`[GATE2_VERIFY] \${MARKER}\` }],
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("TIMEOUT")), TIMEOUT * 1000)
      ),
    ])
  } catch (e: any) {
    if (e.message === "TIMEOUT") {
      timedOut = true
      console.log("❌ FAIL: prompt() + noReply:true HUNG (did not return within \${TIMEOUT}s)")
      process.exit(1)
    }
    // Other error (e.g., API error) — still check if message was written
    console.log("prompt() threw:", e.message)
  }

  const elapsed = Date.now() - start
  console.log(\`prompt() returned in \${elapsed}ms\`)

  // 3. Wait a bit for message to be persisted
  await new Promise(r => setTimeout(r, 1000))

  // 4. Read messages and check for marker
  const messages = await client.session.messages({ path: { id: sid } })
  const allText = messages.data
    .flatMap((m: any) => (m.parts || []).map((p: any) => p.text || ""))
    .join(" ")
  const found = allText.includes(MARKER)

  console.log(\`Messages in session: \${messages.data.length}\`)
  console.log(\`Marker found: \${found}\`)

  if (found) {
    console.log("✅ PASS: prompt({noReply:true}) is non-blocking AND message is visible")
    process.exit(0)
  } else if (timedOut) {
    // Already exited above, but just in case
    console.log("❌ FAIL: Hung and message not visible")
    process.exit(1)
  } else {
    console.log("⚠️  PARTIAL: prompt() did not hang, but message is NOT visible")
    console.log("   This means noReply:true suppresses message persistence.")
    console.log("   Proposal D is NOT viable. Fall back to Proposal F.")
    process.exit(1)
  }
}

main().catch(e => { console.error("Error:", e); process.exit(2) })
VERIFYTS

# ── Step 2: Start opencode serve ────────────────────────────

echo "Starting opencode serve on port $PORT..."
XDG_CONFIG_HOME="$TMPDIR_GATE" opencode serve --port "$PORT" --hostname 127.0.0.1 &
SERVER_PID=$!

# Wait for server to start
echo "Waiting for server..."
for i in $(seq 1 20); do
  if curl -s "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    echo "Server ready."
    break
  fi
  if [ "$i" -eq 20 ]; then
    echo "❌ Server failed to start within 20s"
    kill $SERVER_PID 2>/dev/null || true
    exit 2
  fi
  sleep 1
done

# ── Step 3: Run verification ────────────────────────────────

echo "Running verification..."
GATE2_MARKER="$MARKER" bun run "$TMPDIR_GATE/verify.ts"
EXIT_CODE=$?

# ── Cleanup ─────────────────────────────────────────────────

kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true

echo ""
if [ $EXIT_CODE -eq 0 ]; then
  echo "=== Gate #2 PASSED ==="
  echo "prompt() + noReply:true is non-blocking and message is visible."
  echo "Bug #14b can be fixed with Proposal D."
else
  echo "=== Gate #2 FAILED ==="
  echo "Either prompt() + noReply:true hangs, or the message is not visible."
  echo "Fall back to Proposal F (separate TUI notifier plugin)."
fi

exit $EXIT_CODE

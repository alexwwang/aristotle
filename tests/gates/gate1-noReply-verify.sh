#!/usr/bin/env bash
# Gate #1 Verification: Does session.prompt({noReply: true}) inject system-reminder?
#
# Fully automated via `opencode serve` + SDK.
#
# Prerequisites:
#   - opencode CLI installed
#   - bun available
#
# Usage:
#   bash test/gate1-noReply-verify.sh
#
# Exit codes:
#   0 - Gate passed
#   1 - Gate failed (noReply does NOT inject into session messages)
#   2 - Setup error

set -euo pipefail

MARKER="GATE1_$(date +%s)"
PORT=14096
TMPDIR_GATE=$(mktemp -d)

cleanup() { rm -rf "$TMPDIR_GATE"; }
trap cleanup EXIT

echo "=== Gate #1: session.prompt({noReply:true}) verification ==="
echo "Marker: $MARKER"
echo ""

# ── Step 1: Create isolated plugin ──────────────────────────

PLUGIN_DIR="$TMPDIR_GATE/.opencode/plugins"
mkdir -p "$PLUGIN_DIR"

cat > "$PLUGIN_DIR/gate1-verify.ts" << 'PLUGINTS'
import type { Plugin } from "@opencode-ai/plugin"

export const Gate1Verify: Plugin = async ({ client }) => ({
  event: async ({ event }) => {
    if (event.type === "session.created") {
      const sid = event.properties?.sessionID
      if (typeof sid === "string") {
        await client.session.prompt({
          path: { id: sid },
          body: {
            noReply: true,
            parts: [{ type: "text", text: `[GATE1_VERIFY] ${process.env.GATE1_MARKER || "unknown"}` }],
          },
        }).catch(() => {})
      }
    }
  },
  tool: () => ({
    gate1_check: {
      description: "Check if noReply message appeared",
      parameters: { type: "object", properties: {} },
      execute: async (_args: any, ctx: any) => {
        const msgs = await ctx.client.session.messages({
          path: { id: ctx.sessionID },
        })
        const marker = process.env.GATE1_MARKER || ""
        const found = msgs.data.some((m: any) =>
          m.parts?.some((p: any) => p.type === "text" && p.text?.includes(marker))
        )
        return { marker, found, messageCount: msgs.data.length }
      },
    },
  }),
})
PLUGINTS

# ── Step 2: Write SDK verification script ───────────────────

cat > "$TMPDIR_GATE/verify.ts" << VERIFYTS
import { createOpencodeClient } from "@opencode-ai/sdk"

const PORT = ${PORT}
const MARKER = "${MARKER}"
const client = createOpencodeClient({ baseUrl: \`http://127.0.0.1:\${PORT}\` })

async function main() {
  // 1. Create a session (plugin hooks session.created)
  const session = await client.session.create({ body: { title: "Gate #1 Test" } })
  const sid = session.data.id
  console.log("Session created:", sid)

  // 2. Wait for plugin's async noReply prompt to complete
  await new Promise(r => setTimeout(r, 2000))

  // 3. Send a normal prompt so the session processes
  await client.session.prompt({
    path: { id: sid },
    body: { parts: [{ type: "text", text: "echo hello" }] },
  }).catch(() => {})

  await new Promise(r => setTimeout(r, 3000))

  // 4. Read messages and check for marker
  const messages = await client.session.messages({ path: { id: sid } })
  const found = messages.data.some((m: any) =>
    m.parts?.some((p: any) => p.type === "text" && p.text?.includes(MARKER))
  )

  if (found) {
    console.log("✅ PASS: noReply injection works — marker found in session messages")
    process.exit(0)
  } else {
    console.log("❌ FAIL: noReply injection NOT found")
    console.log("Messages:", JSON.stringify(messages.data.length, null, 2))
    process.exit(1)
  }
}

main().catch(e => { console.error("Error:", e); process.exit(2) })
VERIFYTS

# ── Step 3: Start opencode serve ────────────────────────────

echo "Starting opencode serve on port $PORT..."
GATE1_MARKER="$MARKER" XDG_CONFIG_HOME="$TMPDIR_GATE" opencode serve --port "$PORT" --hostname 127.0.0.1 &
SERVER_PID=$!

# Wait for server to start
echo "Waiting for server..."
for i in $(seq 1 15); do
  if curl -s "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    echo "Server ready."
    break
  fi
  sleep 1
done

# ── Step 4: Run verification ────────────────────────────────

echo "Running verification..."
GATE1_MARKER="$MARKER" bun run "$TMPDIR_GATE/verify.ts"
EXIT_CODE=$?

# ── Cleanup ─────────────────────────────────────────────────

kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true

echo ""
if [ $EXIT_CODE -eq 0 ]; then
  echo "=== Gate #1 PASSED ==="
  echo "Bridge Plugin can use session.prompt({noReply:true}) for notifications."
else
  echo "=== Gate #1 FAILED ==="
  echo "noReply does NOT inject into session messages."
  echo "Bridge design falls back to polling mode (SKILL.md periodically calls aristotle_retrieve)."
fi

exit $EXIT_CODE

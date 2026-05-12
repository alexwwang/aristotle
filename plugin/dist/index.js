// ../packages/core/src/plugin/registration.ts
function getSessionId(context) {
  return context?.session?.id ?? context?.sessionId ?? "";
}
function assemblePlugin(ctx, roles) {
  const activeRoles = roles.filter((r) => r != null);
  if (activeRoles.length === 0) {
    return {};
  }
  const mergedTools = {};
  for (const role of activeRoles) {
    if (role.tools) {
      for (const [name, def] of Object.entries(role.tools)) {
        if (name in mergedTools) {
          throw new Error(`Tool name conflict: ${name}`);
        }
        mergedTools[name] = def;
      }
    }
  }
  const hasToolHooks = activeRoles.some((r) => r.onToolBefore || r.onToolAfter);
  if (hasToolHooks) {
    for (const [name, def] of Object.entries(mergedTools)) {
      const originalExecute = def.execute;
      mergedTools[name] = {
        ...def,
        execute: async (args, context) => {
          const sessionId = getSessionId(context);
          let interceptedResult = null;
          for (const role of activeRoles) {
            if (role.onToolBefore) {
              try {
                const result = await role.onToolBefore(name, args, sessionId);
                if (result !== null) {
                  interceptedResult = result;
                  break;
                }
              } catch {}
            }
          }
          if (interceptedResult !== null) {
            for (const role of activeRoles) {
              if (role.onToolAfter) {
                try {
                  await role.onToolAfter(name, args, interceptedResult, sessionId);
                } catch {}
              }
            }
            return interceptedResult;
          }
          const output2 = await originalExecute(args, context);
          for (const role of activeRoles) {
            if (role.onToolAfter) {
              try {
                await role.onToolAfter(name, args, output2, sessionId);
              } catch {}
            }
          }
          return output2;
        }
      };
    }
  }
  const output = {};
  if (Object.keys(mergedTools).length > 0) {
    output.tool = mergedTools;
  }
  const hasIdleHandlers = activeRoles.some((r) => r.onIdle);
  if (hasIdleHandlers) {
    output.event = async (event) => {
      const e = event?.event ?? event;
      if (e?.type !== "session.idle")
        return;
      const sessionId = e?.properties?.sessionID ?? "";
      if (typeof sessionId !== "string" || !sessionId)
        return;
      for (const role of activeRoles) {
        if (role.onIdle) {
          try {
            await role.onIdle(sessionId, ctx.client);
          } catch {}
        }
      }
    };
  }
  return output;
}

// ../packages/reflection/src/index.ts
import { join as join4 } from "node:path";
import { writeFileSync as writeFileSync2, unlinkSync as unlinkSync2, mkdirSync, readdirSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";

// ../packages/core/src/store/workflow-store.ts
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";

// ../packages/core/src/utils.ts
var DEFAULT_SENTINEL = "[ARISTOTLE_BRIDGE:no_text_output]";
function extractLastAssistantText(messages, sentinel) {
  const fallback = sentinel !== undefined ? sentinel : DEFAULT_SENTINEL;
  if (!messages || messages.length === 0) {
    return fallback;
  }
  for (let i = messages.length - 1;i >= 0; i--) {
    const msg = messages[i];
    if (msg.info.role === "assistant") {
      const parts = msg.parts;
      if (!parts || parts.length === 0) {
        continue;
      }
      const text = parts.filter((p) => p.type === "text" && typeof p.text === "string").map((p) => p.text).join(`
`).trim();
      if (text)
        return text;
    }
  }
  return fallback;
}

// ../packages/core/src/logger.ts
var LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
function shouldLog(level, configured) {
  return (LEVELS[level] ?? 99) >= (LEVELS[configured] ?? 1);
}
function createLogger(prefix, envVar) {
  const configured = (process.env[envVar] || process.env.AGENT_PLATFORM_LOG || "warn").toLowerCase();
  return {
    debug: (fmt, ...args) => shouldLog("debug", configured) && console.error(`[${prefix}:debug] ${fmt}`, ...args),
    info: (fmt, ...args) => shouldLog("info", configured) && console.error(`[${prefix}:info] ${fmt}`, ...args),
    warn: (fmt, ...args) => shouldLog("warn", configured) && console.error(`[${prefix}:warn] ${fmt}`, ...args),
    error: (fmt, ...args) => shouldLog("error", configured) && console.error(`[${prefix}:error] ${fmt}`, ...args)
  };
}
var logger = createLogger("platform", "AGENT_PLATFORM_LOG");

// ../packages/core/src/store/workflow-store.ts
var logger2 = createLogger("workflow", "AGENT_PLATFORM_LOG");

class WorkflowStore {
  workflows = new Map;
  storePath;
  instanceId;
  static MAX_WORKFLOWS = 50;
  static RECONCILE_TIMEOUT_MS = 5000;
  constructor(sessionsDir, instanceId) {
    this.storePath = join(sessionsDir, "bridge-workflows.json");
    this.instanceId = instanceId;
    if (!instanceId)
      throw new Error("instanceId is required");
    this.loadFromDisk();
  }
  register(wf) {
    if (this.workflows.size >= WorkflowStore.MAX_WORKFLOWS && !this.workflows.has(wf.workflowId)) {
      if (!this.evictOldestNonRunning()) {
        return false;
      }
      this.saveToDiskRaw();
    }
    const stamped = { ...wf, instanceId: this.instanceId };
    this.workflows.set(wf.workflowId, stamped);
    this.saveToDisk();
    return true;
  }
  findByWorkflowId(workflowId) {
    return this.workflows.get(workflowId);
  }
  remove(workflowId) {
    const deleted = this.workflows.delete(workflowId);
    if (deleted)
      this.saveToDisk();
    return deleted;
  }
  findBySession(sessionId) {
    for (const wf of this.workflows.values()) {
      if (wf.sessionId === sessionId)
        return wf;
    }
    return;
  }
  retrieve(workflowId) {
    const wf = this.workflows.get(workflowId);
    if (!wf)
      return { error: "Workflow not found" };
    if (wf.status === "running")
      return { status: "running" };
    if (wf.status === "chain_pending")
      return { status: "chain_pending" };
    if (wf.status === "chain_broken")
      return { status: "chain_broken", error: wf.error };
    if (wf.status === "error")
      return { status: "error", error: wf.error };
    if (wf.status === "undone")
      return { status: "undone" };
    if (wf.status === "cancelled")
      return { status: "cancelled" };
    return { status: "completed", result: wf.result || "" };
  }
  getActive() {
    const active = [...this.workflows.values()].filter((wf) => wf.status === "running" || wf.status === "chain_pending").map((wf) => ({
      workflow_id: wf.workflowId,
      status: wf.status,
      started_at: wf.startedAt
    }));
    return { active };
  }
  markCompleted(id, result) {
    const wf = this.workflows.get(id);
    if (wf) {
      wf.status = "completed";
      wf.result = result;
      this.saveToDisk();
    }
  }
  markChainPending(id, result) {
    const wf = this.workflows.get(id);
    if (wf) {
      wf.status = "chain_pending";
      wf.result = result;
      this.saveToDisk();
    }
  }
  markChainBroken(id, error) {
    const wf = this.workflows.get(id);
    if (wf) {
      wf.status = "chain_broken";
      wf.error = error;
      this.saveToDisk();
    }
  }
  markError(id, message) {
    const wf = this.workflows.get(id);
    if (wf) {
      wf.status = "error";
      wf.error = message;
      this.saveToDisk();
    }
  }
  markUndone(id) {
    const wf = this.workflows.get(id);
    if (wf) {
      wf.status = "undone";
      this.saveToDisk();
    }
  }
  cancel(id) {
    const wf = this.workflows.get(id);
    if (wf) {
      wf.status = "cancelled";
      this.saveToDisk();
    }
  }
  async reconcileOnStartup(client) {
    const STALE_TERMINAL_MS = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const staleIds = [];
    for (const [id, wf] of this.workflows.entries()) {
      if (wf.status !== "running" && wf.status !== "chain_pending" && now - wf.startedAt > STALE_TERMINAL_MS) {
        staleIds.push(id);
      }
    }
    if (staleIds.length > 0) {
      for (const id of staleIds) {
        this.workflows.delete(id);
      }
      logger2.info("purged %d stale terminal workflows (older than 7 days)", staleIds.length);
      this.saveToDiskRaw();
    }
    const chainBroken = [...this.workflows.entries()].filter(([_, wf]) => wf.status === "chain_broken" && wf.instanceId === this.instanceId);
    for (const [id, wf] of chainBroken) {
      logger2.warn("chain_broken from prior run: wf=%s agent=%s error=%s", id, wf.agent, wf.error ?? "unknown");
    }
    const chainPending = [...this.workflows.entries()].filter(([_, wf]) => wf.status === "chain_pending" && wf.instanceId === this.instanceId);
    for (const [id, wf] of chainPending) {
      logger2.warn("recovering chain_pending workflow: wf=%s agent=%s", id, wf.agent);
      if (wf.agent === "R") {
        logger2.warn('R chain_pending recovered as completed, but MCP state may be at "checking" phase. No C was launched.');
      }
      this.markCompleted(id, wf.result || "");
      logger2.info("recovered chain_pending → completed: wf=%s", id);
    }
    const running = [...this.workflows.entries()].filter(([_, wf]) => wf.status === "running" && wf.instanceId === this.instanceId);
    for (let i = 0;i < running.length; i += 5) {
      const batch = running.slice(i, i + 5);
      await Promise.allSettled(batch.map(async ([id, wf]) => {
        try {
          const msgs = await this.withTimeout(client.session.messages({ path: { id: wf.sessionId } }), WorkflowStore.RECONCILE_TIMEOUT_MS);
          if (!msgs?.data?.length) {
            this.markError(id, "Empty or invalid session response during reconciliation");
            return;
          }
          const hasAssistant = msgs.data.some((m) => m.info.role === "assistant");
          if (hasAssistant) {
            const result = extractLastAssistantText(msgs.data);
            this.markCompleted(id, result);
          } else {
            this.markError(id, "Session has no assistant response");
          }
        } catch (e) {
          const msg = e instanceof Error && e.message === "reconcile timeout" ? "Reconcile timeout: session query exceeded time limit" : "Session not found during reconciliation";
          logger2.warn("reconcile error: wf=%s %s", id, msg);
          this.markError(id, msg);
        }
      }));
    }
  }
  withTimeout(promise, ms) {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("reconcile timeout")), ms);
      })
    ]).finally(() => clearTimeout(timer));
  }
  loadFromDisk() {
    try {
      const data = readFileSync(this.storePath, "utf-8");
      const parsed = JSON.parse(data);
      if (!Array.isArray(parsed))
        return;
      for (const wf of parsed) {
        if (wf && typeof wf === "object" && typeof wf.workflowId === "string") {
          this.workflows.set(wf.workflowId, wf);
        }
      }
    } catch {}
  }
  saveToDisk() {
    try {
      const diskEntries = this.readDiskMap();
      for (const [id, wf] of diskEntries) {
        if (!this.workflows.has(id) && wf.instanceId !== this.instanceId) {
          this.workflows.set(id, wf);
        }
      }
      this.saveToDiskRaw();
    } catch (e) {
      logger2.error("failed to persist workflow store: %s", e);
    }
  }
  saveToDiskRaw() {
    const tmpPath = this.storePath + ".tmp";
    writeFileSync(tmpPath, JSON.stringify([...this.workflows.values()], null, 2), "utf-8");
    renameSync(tmpPath, this.storePath);
  }
  readDiskMap() {
    const map = new Map;
    try {
      const data = readFileSync(this.storePath, "utf-8");
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        for (const wf of parsed) {
          if (wf && typeof wf === "object" && typeof wf.workflowId === "string") {
            map.set(wf.workflowId, wf);
          }
        }
      }
    } catch {}
    return map;
  }
  evictOldestNonRunning() {
    const candidates = [...this.workflows.entries()].filter(([_, wf]) => wf.status !== "running" && wf.status !== "chain_pending").sort(([_, a], [__, b]) => a.startedAt - b.startedAt);
    if (candidates.length > 0) {
      this.workflows.delete(candidates[0][0]);
      return true;
    }
    return false;
  }
}

// ../packages/core/src/session/extractor.ts
import fs from "node:fs";
import path from "node:path";
class SessionExtractor {
  baseDir;
  constructor(baseDir) {
    this.baseDir = baseDir;
  }
  async extract(client, sessionId, options) {
    let messages;
    const cacheFile = this.cachePath(sessionId);
    if (this.baseDir && cacheFile && fs.existsSync(cacheFile)) {
      try {
        const raw = fs.readFileSync(cacheFile, "utf-8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          messages = parsed;
        }
      } catch {
        logger.warn("Cache file corrupted for session %s, refetching from API", sessionId);
        messages = undefined;
      }
    }
    if (messages === undefined) {
      const response = await client.session.messages({ path: { id: sessionId } });
      messages = response.data || [];
      if (this.baseDir && cacheFile) {
        try {
          fs.mkdirSync(this.baseDir, { recursive: true });
          fs.writeFileSync(cacheFile, JSON.stringify(messages));
        } catch (err) {
          logger.error("Failed to write cache for session %s: %s", sessionId, err);
        }
      }
    }
    messages = messages || [];
    if (options?.roles && options.roles.length > 0) {
      messages = messages.filter((msg) => options.roles.includes(msg.info?.role));
    }
    if (options?.limit !== undefined) {
      messages = messages.slice(0, Math.min(options.limit, 200));
    }
    if (options?.maxContentLength !== undefined && options.maxContentLength > 0) {
      messages = messages.map((msg) => {
        if (!msg.parts || !Array.isArray(msg.parts))
          return msg;
        const truncatedParts = msg.parts.map((part) => {
          if (part.type === "text" && typeof part.text === "string" && part.text.length > options.maxContentLength) {
            return { ...part, text: part.text.slice(0, options.maxContentLength) };
          }
          return part;
        });
        return { ...msg, parts: truncatedParts };
      });
    }
    if (options?.transform) {
      messages = messages.map((msg, index) => options.transform(msg, index));
    }
    return {
      messages,
      sessionId,
      extractedAt: new Date().toISOString()
    };
  }
  isCached(sessionId, key) {
    if (!this.baseDir)
      return false;
    const cacheFile = this.cachePath(sessionId, key);
    if (!cacheFile)
      return false;
    return fs.existsSync(cacheFile);
  }
  cachePath(sessionId, key) {
    if (!this.baseDir)
      return null;
    const fileName = key ? `${sessionId}_${key}.json` : `${sessionId}.json`;
    return path.join(this.baseDir, fileName);
  }
}

// ../packages/core/src/store/state-store.ts
import fs2 from "node:fs";
import path2 from "node:path";
function validateKey(key) {
  if (key.includes("../") || key.includes("..\\")) {
    throw new Error(`Path traversal detected in key: ${key}`);
  }
}
function stripTrailingSlash(s) {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}
function getFilePath(baseDir, key) {
  const cleanKey = stripTrailingSlash(key).split("/").join(path2.sep);
  return path2.join(baseDir, `${cleanKey}.json`);
}
function getLogPath(baseDir, key) {
  const cleanKey = stripTrailingSlash(key).split("/").join(path2.sep);
  return path2.join(baseDir, `${cleanKey}.jsonl`);
}
function listDir(baseDir, dirPath, result, prefix) {
  if (!fs2.existsSync(dirPath) || !fs2.statSync(dirPath).isDirectory()) {
    return;
  }
  const entries = fs2.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && (entry.name.endsWith(".json") || entry.name.endsWith(".jsonl")) && !entry.name.endsWith(".tmp")) {
      const relativePath = path2.relative(baseDir, path2.join(dirPath, entry.name));
      const key = relativePath.replace(/\\/g, "/").replace(/\.jsonl?$/, "");
      result.push(key);
    }
  }
}
function createStateStore(baseDir, logger3) {
  const log = logger3 || createLogger("state-store", "AGENT_PLATFORM_LOG");
  return {
    read(key) {
      validateKey(key);
      const filePath = getFilePath(baseDir, key);
      try {
        const content = fs2.readFileSync(filePath, "utf-8");
        return JSON.parse(content);
      } catch {
        return null;
      }
    },
    write(key, value) {
      validateKey(key);
      const filePath = getFilePath(baseDir, key);
      const tmpPath = `${filePath}.tmp`;
      try {
        fs2.mkdirSync(path2.dirname(filePath), { recursive: true });
        fs2.writeFileSync(tmpPath, JSON.stringify(value));
        fs2.renameSync(tmpPath, filePath);
      } catch (err) {
        log.error("Failed to write key %s: %s", key, String(err));
      }
    },
    appendLog(key, entry) {
      validateKey(key);
      const logPath = getLogPath(baseDir, key);
      try {
        fs2.mkdirSync(path2.dirname(logPath), { recursive: true });
        fs2.appendFileSync(logPath, JSON.stringify(entry) + `
`);
      } catch (err) {
        log.error("Failed to append log key %s: %s", key, String(err));
      }
    },
    list(prefix) {
      if (prefix.includes("../") || prefix.includes("..\\")) {
        throw new Error(`Path traversal detected in prefix: ${prefix}`);
      }
      const normalized = stripTrailingSlash(prefix).split("/").join(path2.sep);
      const dirPath = path2.join(baseDir, normalized);
      const result = [];
      listDir(baseDir, dirPath, result, "");
      return result;
    }
  };
}

// ../packages/reflection/src/reflection/snapshot-extractor.ts
import path3 from "node:path";

class SnapshotExtractor {
  extractor;
  store;
  sessionsDir;
  constructor(sessionsDir) {
    this.sessionsDir = sessionsDir || "";
    this.extractor = new SessionExtractor(sessionsDir);
    this.store = createStateStore(this.sessionsDir);
  }
  buildKey(sessionId, workflowId) {
    const suffix = workflowId ? `_${workflowId}` : "";
    return `${sessionId}${suffix}_snapshot`;
  }
  snapshotExists(sessionId, workflowId) {
    const key = this.buildKey(sessionId, workflowId);
    return this.store.read(key) !== null;
  }
  snapshotPath(sessionId, workflowId) {
    const key = this.buildKey(sessionId, workflowId);
    const data = this.store.read(key);
    if (data === null)
      return null;
    return path3.join(this.sessionsDir, `${key}.json`);
  }
  async extract(client, sessionId, focusHint = "last 50 messages", limit = 50, workflowId) {
    const effectiveLimit = Math.min(limit, 200);
    const raw = await this.extractor.extract(client, sessionId, {
      roles: ["user", "assistant"],
      limit: effectiveLimit
    });
    const filtered = raw.messages.filter((msg) => msg.parts && Array.isArray(msg.parts));
    const messages = filtered.map((msg, index) => ({
      index: index + 1,
      role: msg.info?.role,
      content: msg.parts.filter((p) => p.type === "text").map((p) => p.text).join(`
`).slice(0, 4000)
    }));
    const snapshot = {
      version: 1,
      session_id: sessionId,
      extracted_at: new Date().toISOString(),
      focus: focusHint,
      source: "bridge-plugin-sdk",
      total_messages: messages.length,
      messages
    };
    const key = this.buildKey(sessionId, workflowId);
    this.store.write(key, snapshot);
    return path3.join(this.sessionsDir, `${key}.json`);
  }
}

// ../packages/core/src/executor/index.ts
class AsyncTaskExecutor {
  client;
  constructor(client) {
    this.client = client;
  }
  async launch(args) {
    try {
      const session = await this.client.session.create({
        body: { title: args.title, parentID: args.parentSessionId }
      });
      args.onSessionCreated?.(session.data.id);
      await this.client.session.promptAsync({
        path: { id: session.data.id },
        body: { parts: [{ type: "text", text: args.oPrompt }] }
      });
      return { sessionId: session.data.id, status: "running", message: "Sub-session launched successfully" };
    } catch (err) {
      return { sessionId: "", status: "error", message: String(err) };
    }
  }
}

// ../packages/reflection/src/executor.ts
class AristotleExecutor {
  client;
  store;
  snapshotExtractor;
  coreExecutor;
  constructor(client, store, snapshotExtractor) {
    this.client = client;
    this.store = store;
    this.snapshotExtractor = snapshotExtractor;
    this.coreExecutor = new AsyncTaskExecutor(client);
  }
  async launch(args, context) {
    const workflowId = args.workflowId;
    const oPrompt = args.oPrompt;
    const agent = args.agent ?? "R";
    const parentSessionId = args.parentSessionId || context?.sessionID || "";
    const targetSessionId = args.targetSessionId || context?.sessionID || "";
    const focusHint = args.focusHint;
    let preparedPrompt = oPrompt;
    if (targetSessionId) {
      try {
        if (!this.snapshotExtractor.snapshotExists(targetSessionId, workflowId)) {
          await Promise.race([
            this.snapshotExtractor.extract(this.client, targetSessionId, focusHint ?? "last 50 messages", 50, workflowId),
            new Promise((_, reject) => setTimeout(() => reject(new Error("snapshot extraction timed out")), 1e4))
          ]);
        }
        const snapshotFilePath = this.snapshotExtractor.snapshotPath(targetSessionId, workflowId);
        if (snapshotFilePath) {
          preparedPrompt = preparedPrompt.replace("SESSION_FILE: ", `SESSION_FILE: ${snapshotFilePath}`);
        }
      } catch (e) {
        console.warn("[aristotle] snapshot extraction failed:", e);
      }
    }
    const coreResult = await this.coreExecutor.launch({
      oPrompt: preparedPrompt,
      parentSessionId,
      title: `aristotle-${workflowId}`,
      onSessionCreated: (sessionId) => {
        let registered;
        try {
          registered = this.store.register({
            workflowId,
            sessionId,
            parentSessionId,
            status: "running",
            startedAt: Date.now(),
            agent,
            ...targetSessionId ? { targetSessionId } : {}
          });
        } catch (e) {
          this.client.session.abort({ path: { id: sessionId } }).catch(() => {});
          throw e;
        }
        if (!registered) {
          this.client.session.abort({ path: { id: sessionId } }).catch(() => {});
          throw new Error("Store full: too many concurrent workflows (max 50). Try again later.");
        }
      }
    });
    if (coreResult.status === "error") {
      return {
        workflow_id: workflowId,
        session_id: coreResult.sessionId,
        status: "error",
        message: coreResult.message
      };
    }
    return {
      workflow_id: workflowId,
      session_id: coreResult.sessionId,
      status: "running",
      message: "\uD83E\uDD89 Task launched. workflow_id: " + workflowId + ". " + "Bridge plugin handles the R→C chain automatically via session.idle events. " + "Do NOT call aristotle_check to poll. Just inform the user and STOP."
    };
  }
}

// ../packages/reflection/src/idle-handler.ts
import { spawn } from "node:child_process";
import { join as join2 } from "node:path";
import { existsSync, readFileSync as readFileSync2, unlinkSync } from "node:fs";
var logger3 = createLogger("aristotle", "ARISTOTLE_LOG");
var TRIGGER_FILENAME = ".trigger-reflect.json";
var ABORT_TRIGGER_FILENAME = ".trigger-abort.json";

class IdleEventHandler {
  client;
  store;
  executor;
  mcpProjectDir;
  sessionsDir;
  constructor(client, store, executor, options) {
    this.client = client;
    this.store = store;
    this.executor = executor;
    this.sessionsDir = options.sessionsDir;
    this.mcpProjectDir = options.mcpDir;
    logger3.debug("mcpProjectDir=%s sessionsDir=%s", this.mcpProjectDir, this.sessionsDir);
  }
  async handle(sessionID) {
    await this.checkAbortTrigger();
    await this.checkTrigger(sessionID);
    const wf = this.store.findBySession(sessionID);
    logger3.debug("idle handle: session=%s found=%s status=%s agent=%s", sessionID, !!wf, wf?.status ?? "n/a", wf?.agent ?? "n/a");
    if (!wf || wf.status !== "running")
      return;
    try {
      const messages = await this.client.session.messages({ path: { id: sessionID } });
      const result = extractLastAssistantText(messages.data);
      if (wf.agent === "R" || wf.agent === "C") {
        this.store.markChainPending(wf.workflowId, result);
        logger3.info("chain_pending: wf=%s agent=%s session=%s resultLen=%d", wf.workflowId, wf.agent, sessionID, (result ?? "").length);
        if (wf.agent === "R") {
          await this.driveChainTransition(wf, sessionID, result);
        } else if (wf.agent === "C") {
          await this.driveChainCompletion(wf, sessionID, result);
        }
      } else {
        this.store.markCompleted(wf.workflowId, result);
        logger3.info("completed: wf=%s session=%s", wf.workflowId, sessionID);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const currentWf = this.store.findBySession(sessionID);
      if (currentWf?.status === "chain_pending") {
        this.store.markChainBroken(wf.workflowId, message);
        logger3.error("idle-handler chain error: wf=%s %s", wf.workflowId, message);
      } else if (currentWf?.status === "cancelled") {
        logger3.warn("idle-handler: wf=%s already cancelled, skipping error mark", wf.workflowId);
      } else {
        this.store.markError(wf.workflowId, message);
        logger3.error("idle-handler error: wf=%s %s", wf.workflowId, message);
      }
    }
  }
  async driveChainTransition(wf, sessionId, result) {
    logger3.info("R→C transition: wf=%s", wf.workflowId);
    const action = await this.callMCP("subagent_done", {
      workflow_id: wf.workflowId,
      result,
      session_id: sessionId
    });
    if (action.error) {
      this.store.markChainBroken(wf.workflowId, action.error);
      logger3.error("MCP subprocess error, chain broken: wf=%s %s", wf.workflowId, action.error);
      return;
    }
    if (action.action === "fire_sub") {
      if (action.workflow_id !== wf.workflowId) {
        this.store.markChainBroken(wf.workflowId, `MCP returned mismatched workflow_id: ${action.workflow_id}`);
        logger3.error("workflow_id mismatch: expected=%s got=%s", wf.workflowId, action.workflow_id);
        return;
      }
      logger3.info("launching C: wf=%s", action.workflow_id);
      if (!action.sub_prompt) {
        this.store.markChainBroken(wf.workflowId, "MCP returned fire_sub without sub_prompt");
        logger3.error("missing sub_prompt: wf=%s", action.workflow_id);
        return;
      }
      try {
        const launchResult = await this.executor.launch({
          workflowId: action.workflow_id,
          oPrompt: action.sub_prompt,
          agent: action.sub_role || "C",
          parentSessionId: wf.parentSessionId
        });
        if (launchResult.status === "error") {
          this.store.markChainBroken(wf.workflowId, `C launch failed: ${launchResult.message}`);
          logger3.error("C launch failed (status=error): wf=%s %s", wf.workflowId, launchResult.message);
          return;
        }
        logger3.info("C launched: wf=%s cSession=%s", wf.workflowId, launchResult.session_id);
      } catch (launchError) {
        const msg = launchError instanceof Error ? launchError.message : String(launchError);
        this.store.markChainBroken(wf.workflowId, `C launch failed: ${msg}`);
        logger3.error("C launch failed, chain broken: wf=%s %s", wf.workflowId, msg);
      }
    } else if (action.action === "done") {
      this.store.markCompleted(wf.workflowId, result);
      logger3.info("chain complete (%s): wf=%s", action.action, wf.workflowId);
      this.notifyParent(wf.parentSessionId, `\uD83E\uDD89 Aristotle ran — no issues found. (${wf.workflowId})`);
    } else if (action.action === "notify") {
      const msg = action.message || "MCP returned notify";
      if (msg.includes("Unknown workflow")) {
        this.store.remove(wf.workflowId);
        logger3.info("stale workflow purged from store: wf=%s", wf.workflowId);
      } else {
        this.store.markChainBroken(wf.workflowId, msg);
        logger3.warn("MCP notify (error/edge case): wf=%s msg=%s", wf.workflowId, msg);
      }
    } else {
      const msg = `Unexpected MCP action: ${action.action ?? "undefined"}`;
      this.store.markChainBroken(wf.workflowId, msg);
      logger3.warn("unexpected action: wf=%s action=%s", wf.workflowId, action.action);
    }
  }
  async driveChainCompletion(wf, sessionId, result) {
    logger3.info("C completion: wf=%s", wf.workflowId);
    const action = await this.callMCP("subagent_done", {
      workflow_id: wf.workflowId,
      result,
      session_id: sessionId
    });
    if (action.error) {
      this.store.markChainBroken(wf.workflowId, action.error);
      logger3.error("MCP subprocess error, chain broken: wf=%s %s", wf.workflowId, action.error);
      return;
    }
    if (action.action === "done") {
      this.store.markCompleted(wf.workflowId, result);
      logger3.info("reflection complete: %s", action.message ?? "done");
      this.notifyParent(wf.parentSessionId, `\uD83E\uDD89 Reflection complete (${wf.workflowId}). Use /aristotle review to see results.`);
    } else if (action.action === "notify") {
      const msg = action.message || "MCP returned notify";
      if (msg.includes("Unknown workflow")) {
        this.store.remove(wf.workflowId);
        logger3.info("stale workflow purged from store: wf=%s", wf.workflowId);
      } else {
        this.store.markChainBroken(wf.workflowId, msg);
        logger3.warn("MCP notify (error/edge case): wf=%s msg=%s", wf.workflowId, msg);
      }
    } else if (action.action === "fire_sub") {
      logger3.info("re-reflect requested: wf=%s", action.workflow_id);
      if (action.workflow_id !== wf.workflowId) {
        this.store.markChainBroken(wf.workflowId, `MCP returned mismatched workflow_id: ${action.workflow_id}`);
        return;
      }
      try {
        if (!action.sub_prompt) {
          this.store.markChainBroken(wf.workflowId, "MCP returned fire_sub without sub_prompt");
          return;
        }
        const launchResult = await this.executor.launch({
          workflowId: action.workflow_id,
          oPrompt: action.sub_prompt,
          agent: action.sub_role || "R",
          parentSessionId: wf.parentSessionId
        });
        if (launchResult.status === "error") {
          this.store.markChainBroken(wf.workflowId, `Re-reflect launch failed: ${launchResult.message}`);
          logger3.error("re-reflect launch failed (status=error): wf=%s %s", wf.workflowId, launchResult.message);
          return;
        }
      } catch (launchError) {
        const msg = launchError instanceof Error ? launchError.message : String(launchError);
        this.store.markChainBroken(wf.workflowId, `Re-reflect launch failed: ${msg}`);
        logger3.error("re-reflect launch failed: wf=%s %s", wf.workflowId, msg);
      }
    } else {
      const msg = `Unexpected MCP action: ${action.action ?? "undefined"}`;
      this.store.markChainBroken(wf.workflowId, msg);
      logger3.warn("unexpected action: wf=%s action=%s", wf.workflowId, action.action);
    }
  }
  notifyParent(parentSessionId, message) {
    if (!parentSessionId)
      return;
    let timer;
    try {
      Promise.race([
        this.client.session.prompt({
          path: { id: parentSessionId },
          body: {
            noReply: true,
            parts: [{ type: "text", text: message }]
          }
        }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("notification timeout")), 5000);
        })
      ]).finally(() => {
        if (timer)
          clearTimeout(timer);
      }).then(() => logger3.info("notifyParent: sent to session=%s", parentSessionId)).catch((e) => logger3.warn("notifyParent: failed for session=%s %s", parentSessionId, e instanceof Error ? e.message : e));
    } catch (e) {
      logger3.warn("notifyParent: sync error for session=%s %s", parentSessionId, e instanceof Error ? e.message : e);
    }
  }
  async checkAbortTrigger() {
    const triggerPath = join2(this.sessionsDir, ABORT_TRIGGER_FILENAME);
    if (!existsSync(triggerPath))
      return;
    let targetIds = [];
    try {
      const raw = readFileSync2(triggerPath, "utf-8");
      const parsed = JSON.parse(raw);
      targetIds = Array.isArray(parsed.workflow_ids) ? parsed.workflow_ids : [];
    } catch (e) {
      logger3.error("abort trigger parse error: %s", e instanceof Error ? e.message : e);
      try {
        unlinkSync(triggerPath);
      } catch {}
      return;
    }
    try {
      unlinkSync(triggerPath);
    } catch {}
    const active = this.store.getActive().active;
    const toAbort = targetIds.length > 0 ? active.filter((wf) => targetIds.includes(wf.workflow_id)) : active;
    if (toAbort.length === 0) {
      logger3.info("abort trigger: no active workflows to cancel");
      return;
    }
    let cancelled = 0;
    for (const wf of toAbort) {
      if (wf.status !== "running" && wf.status !== "chain_pending")
        continue;
      try {
        const wfData = this.store.findByWorkflowId(wf.workflow_id);
        if (wfData?.sessionId) {
          await this.client.session.abort({ path: { id: wfData.sessionId } }).catch(() => {});
        }
        this.store.cancel(wf.workflow_id);
        cancelled++;
        logger3.info("abort trigger: cancelled wf=%s", wf.workflow_id);
      } catch (e) {
        logger3.error("abort trigger: failed to cancel wf=%s %s", wf.workflow_id, e instanceof Error ? e.message : e);
      }
    }
    logger3.info("abort trigger: cancelled %d/%d workflows", cancelled, toAbort.length);
  }
  async checkTrigger(parentSessionId) {
    const triggerPath = join2(this.sessionsDir, TRIGGER_FILENAME);
    if (!existsSync(triggerPath))
      return;
    let trigger;
    try {
      const raw = readFileSync2(triggerPath, "utf-8");
      trigger = JSON.parse(raw);
    } catch (e) {
      logger3.error("trigger file parse error: %s", e instanceof Error ? e.message : e);
      try {
        unlinkSync(triggerPath);
      } catch {}
      return;
    }
    logger3.info("trigger detected: session=%s project=%s", trigger.session_id, trigger.project_directory);
    const result = await this.callMCPStart("reflect", trigger);
    try {
      unlinkSync(triggerPath);
    } catch {}
    if (result.error) {
      logger3.error("trigger orchestrate_start failed: %s", result.error);
      return;
    }
    if (result.action === "fire_sub" && result.sub_prompt) {
      logger3.info("trigger: launching R for wf=%s", result.workflow_id);
      try {
        const launchResult = await this.executor.launch({
          workflowId: result.workflow_id,
          oPrompt: result.sub_prompt,
          agent: result.sub_role || "R",
          parentSessionId: trigger.session_id,
          targetSessionId: trigger.session_id
        });
        if (launchResult.status === "error") {
          logger3.error("trigger: R launch failed: %s", launchResult.message);
        } else {
          logger3.info("trigger: R launched, session=%s", launchResult.session_id);
        }
      } catch (launchError) {
        const msg = launchError instanceof Error ? launchError.message : String(launchError);
        logger3.error("trigger: R launch threw: %s", msg);
      }
    } else {
      logger3.warn("trigger: unexpected action=%s", result.action ?? "undefined");
    }
  }
  async callMCPStart(command, args) {
    return this.runSubprocess(["run", "--project", this.mcpProjectDir, "python", "-m", "aristotle_mcp._cli", "orchestrate_start", command], JSON.stringify(args));
  }
  async callMCP(eventType, data) {
    return this.runSubprocess(["run", "--project", this.mcpProjectDir, "python", "-m", "aristotle_mcp._cli", eventType], JSON.stringify(data));
  }
  runSubprocess(args, stdinData) {
    return new Promise((resolve) => {
      const child = spawn("uv", args, { timeout: 30000 });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => {
        stdout += d;
      });
      child.stderr.on("data", (d) => {
        stderr += d;
      });
      child.stdin.on("error", () => {});
      child.on("close", (code, signal) => {
        if (signal) {
          const msg = `Process killed by signal ${signal} (timeout?)`;
          logger3.error("subprocess killed: %s stderr=%s", msg, stderr);
          resolve({ error: msg });
          return;
        }
        if (code !== 0) {
          try {
            const parsed = JSON.parse(stdout.trim());
            if ("error" in parsed && parsed.error !== undefined) {
              resolve(parsed);
              return;
            }
          } catch {}
          logger3.error("subprocess failed: exit=%d stderr=%s", code, stderr);
          resolve({ error: `Process exited with code ${code}: ${stderr}` });
          return;
        }
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch (e) {
          resolve({ error: `Invalid JSON output: ${stdout.substring(0, 200)}` });
        }
      });
      child.on("error", (err) => {
        resolve({ error: err.message });
      });
      child.stdin.write(stdinData);
      child.stdin.end();
    });
  }
}

// ../packages/reflection/src/tools.ts
import { z } from "zod";
function createAristotleTools(deps) {
  const { store, executor, client } = deps;
  return {
    aristotle_fire_o: {
      description: "Launch an Aristotle workflow sub-agent (Reflector) via the Bridge plugin",
      args: {
        workflow_id: z.string().describe("Unique workflow identifier"),
        o_prompt: z.string().describe("The orchestrator prompt to send to the sub-agent"),
        agent: z.string().optional().describe("Agent role: R (reflector, default) or C (checker)"),
        target_session_id: z.string().optional().describe("Target session ID to analyze")
      },
      execute: async (args, context) => {
        const sessionId = context?.sessionID || "";
        const result = await executor.launch({
          workflowId: args.workflow_id,
          oPrompt: args.o_prompt,
          agent: args.agent ?? "R",
          parentSessionId: sessionId,
          targetSessionId: args.target_session_id || sessionId
        });
        return JSON.stringify(result);
      }
    },
    aristotle_check: {
      description: "Check the status of an Aristotle workflow, or list all active workflows",
      args: {
        workflow_id: z.string().optional().describe("Workflow ID to check; omit to list all active")
      },
      execute: async (args) => {
        if (!args.workflow_id) {
          return JSON.stringify(store.getActive());
        }
        return JSON.stringify(store.retrieve(args.workflow_id));
      }
    },
    aristotle_abort: {
      description: "Cancel a running Aristotle workflow",
      args: {
        workflow_id: z.string().describe("Workflow ID to cancel")
      },
      execute: async (args) => {
        const wf = store.findByWorkflowId(args.workflow_id);
        if (!wf) {
          return JSON.stringify({ error: "Workflow not found" });
        }
        if (wf.status === "cancelled") {
          return JSON.stringify({ status: "cancelled", workflow_id: args.workflow_id });
        }
        if (wf.status === "chain_broken") {
          return JSON.stringify({ status: "chain_broken", error: wf.error });
        }
        if (wf.status === "chain_pending") {
          await client.session.abort({ path: { id: wf.sessionId } }).catch(() => {});
          store.cancel(args.workflow_id);
          return JSON.stringify({ status: "cancelled", workflow_id: args.workflow_id });
        }
        if (wf.status !== "running") {
          return JSON.stringify({ status: wf.status, workflow_id: args.workflow_id });
        }
        await client.session.abort({ path: { id: wf.sessionId } }).catch(() => {});
        store.cancel(args.workflow_id);
        return JSON.stringify({ status: "cancelled", workflow_id: args.workflow_id });
      }
    }
  };
}

// ../packages/reflection/src/config.ts
import { existsSync as existsSync2, readFileSync as readFileSync3 } from "node:fs";
import { homedir } from "node:os";
import { join as join3 } from "node:path";
// ../packages/core/src/config.ts
import fs3 from "node:fs";
function createConfigResolver(options) {
  let cache = null;
  return {
    resolve() {
      if (cache)
        return cache;
      let fileConfig = {};
      const configPath = typeof options.configPath === "function" ? options.configPath() : options.configPath;
      if (configPath) {
        try {
          const content = options.readFile ? options.readFile(configPath, "utf-8") : fs3.readFileSync(configPath, "utf-8");
          fileConfig = JSON.parse(content);
        } catch {}
      }
      cache = {};
      try {
        for (const key of Object.keys(options.resolvers)) {
          const envVarName = options.envMappings[key];
          const envValue = envVarName ? process.env[envVarName] : undefined;
          cache[key] = options.resolvers[key](fileConfig[key], envValue);
        }
        return cache;
      } catch (e) {
        cache = null;
        throw e;
      }
    },
    clearCache() {
      cache = null;
    }
  };
}
// ../packages/reflection/src/config.ts
var CONFIG_FILENAME = "aristotle-config.json";
var DEFAULT_OPENCODE_DIR = join3(homedir(), ".config", "opencode");
function findConfigFile() {
  if (process.env.ARISTOTLE_CONFIG) {
    if (!existsSync2(process.env.ARISTOTLE_CONFIG)) {
      console.warn(`[aristotle-config] ARISTOTLE_CONFIG=${process.env.ARISTOTLE_CONFIG} does not exist, ignoring`);
    }
    return process.env.ARISTOTLE_CONFIG;
  }
  const standard = join3(DEFAULT_OPENCODE_DIR, CONFIG_FILENAME);
  if (existsSync2(standard))
    return standard;
  return null;
}
function detectMcpDir(sessionsDir) {
  let dir = sessionsDir;
  for (let i = 0;i < 10; i++) {
    if (existsSync2(join3(dir, "pyproject.toml")) && existsSync2(join3(dir, "aristotle_mcp"))) {
      return dir;
    }
    const sibling = join3(dir, "aristotle");
    if (existsSync2(join3(sibling, "pyproject.toml")) && existsSync2(join3(sibling, "aristotle_mcp"))) {
      return sibling;
    }
    const parent = join3(dir, "..");
    if (parent === dir)
      break;
    dir = parent;
  }
  const envFallback = process.env.ARISTOTLE_PROJECT_DIR;
  if (envFallback && existsSync2(join3(envFallback, "aristotle_mcp")))
    return envFallback;
  return join3(DEFAULT_OPENCODE_DIR, "aristotle");
}
var resolver = createConfigResolver({
  configPath: findConfigFile,
  readFile: readFileSync3,
  envMappings: {
    mcp_dir: "ARISTOTLE_MCP_DIR",
    sessions_dir: "ARISTOTLE_SESSIONS_DIR"
  },
  resolvers: {
    sessions_dir(fileValue, envValue) {
      return fileValue || envValue || join3(DEFAULT_OPENCODE_DIR, "aristotle-sessions");
    },
    mcp_dir(fileValue, envValue) {
      if (fileValue)
        return fileValue;
      if (envValue)
        return envValue;
      const sessionsDir = resolver.resolve().sessions_dir;
      return detectMcpDir(sessionsDir);
    }
  }
});
function resolveConfig() {
  return resolver.resolve();
}

// ../packages/reflection/src/index.ts
async function createAristotleRole(ctx) {
  if (typeof ctx?.client?.session?.promptAsync !== "function") {
    return null;
  }
  const config2 = resolveConfig();
  const sessionsDir = ctx.config?.aristotleBridge?.sessionsDir ?? config2.sessions_dir;
  const markerPath = join4(sessionsDir, ".bridge-active");
  mkdirSync(sessionsDir, { recursive: true });
  writeFileSync2(markerPath, JSON.stringify({ pid: process.pid, startedAt: Date.now() }), "utf-8");
  const cleanup = () => {
    try {
      unlinkSync2(markerPath);
    } catch {}
  };
  process.on("exit", cleanup);
  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);
  process.on("SIGHUP", cleanup);
  try {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const f of readdirSync(sessionsDir)) {
      if (!f.endsWith("_snapshot.json"))
        continue;
      const p = join4(sessionsDir, f);
      if (statSync(p).mtimeMs < cutoff)
        unlinkSync2(p);
    }
  } catch {}
  const instanceId = `${process.pid}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const store = new WorkflowStore(sessionsDir, instanceId);
  await store.reconcileOnStartup(ctx.client);
  const snapshotExtractor = new SnapshotExtractor(sessionsDir);
  const executor2 = new AristotleExecutor(ctx.client, store, snapshotExtractor);
  const idleHandler = new IdleEventHandler(ctx.client, store, executor2, { sessionsDir, mcpDir: config2.mcp_dir });
  const tools = createAristotleTools({
    store,
    executor: executor2,
    client: ctx.client
  });
  return {
    tools,
    async onIdle(sessionId) {
      await idleHandler.handle(sessionId);
    }
  };
}

// ../packages/watchdog/src/pipeline-store.ts
class PipelineStore {
  stateStore;
  logger;
  constructor(stateStore, logger4) {
    this.stateStore = stateStore;
    this.logger = logger4;
  }
  validatePathComponents(projectId, runId) {
    if (projectId.includes("../") || projectId.includes("..\\")) {
      throw new Error(`Path traversal detected in projectId: ${projectId}`);
    }
    if (runId !== undefined && (runId.includes("../") || runId.includes("..\\"))) {
      throw new Error(`Path traversal detected in runId: ${runId}`);
    }
  }
  projectIndexKey() {
    return "watchdog/projects";
  }
  activeKey(projectId) {
    return `watchdog/${projectId}/active`;
  }
  stateKey(projectId, runId) {
    return `watchdog/${projectId}/${runId}/state`;
  }
  auditKey(projectId, runId) {
    return `watchdog/${projectId}/${runId}/audit`;
  }
  archiveStateKey(projectId, runId) {
    return `watchdog/${projectId}/archive/${runId}/state`;
  }
  archiveAuditKey(projectId, runId) {
    return `watchdog/${projectId}/archive/${runId}/audit`;
  }
  getProjectIds() {
    const index = this.stateStore.read(this.projectIndexKey());
    return index?.projectIds ?? [];
  }
  addProjectToIndex(projectId) {
    const index = this.stateStore.read(this.projectIndexKey());
    const ids = new Set(index?.projectIds ?? []);
    if (!ids.has(projectId)) {
      ids.add(projectId);
      this.stateStore.write(this.projectIndexKey(), {
        projectIds: Array.from(ids)
      });
      this.logger.info("Added project %s to watchdog index", projectId);
    }
  }
  getActiveRun(projectId) {
    this.validatePathComponents(projectId);
    return this.stateStore.read(this.activeKey(projectId));
  }
  setActiveRun(projectId, run) {
    this.validatePathComponents(projectId, run.runId);
    const existing = this.getActiveRun(projectId);
    if (existing && existing.runId && existing.runId !== run.runId) {
      this.logger.info("Archiving previous active run %s for project %s", existing.runId, projectId);
      this.archiveRun(projectId, existing.runId);
    }
    this.stateStore.write(this.activeKey(projectId), run);
    this.addProjectToIndex(projectId);
    this.logger.info("Set active run %s for project %s", run.runId, projectId);
  }
  clearActiveRun(projectId) {
    this.validatePathComponents(projectId);
    this.stateStore.write(this.activeKey(projectId), null);
    this.logger.info("Cleared active run for project %s", projectId);
  }
  readState(projectId, runId) {
    this.validatePathComponents(projectId, runId);
    return this.stateStore.read(this.stateKey(projectId, runId));
  }
  writeState(projectId, runId, state) {
    this.validatePathComponents(projectId, runId);
    const key = this.stateKey(projectId, runId);
    this.stateStore.write(key, state);
    const readBack = this.stateStore.read(key);
    if (JSON.stringify(readBack) !== JSON.stringify(state)) {
      this.logger.error("State read-back mismatch for project %s run %s", projectId, runId);
    }
  }
  appendAudit(projectId, runId, entry) {
    this.validatePathComponents(projectId, runId);
    this.stateStore.appendLog(this.auditKey(projectId, runId), entry);
  }
  archiveRun(projectId, runId) {
    this.validatePathComponents(projectId, runId);
    const state = this.readState(projectId, runId);
    if (state) {
      this.stateStore.write(this.archiveStateKey(projectId, runId), state);
      this.logger.info("Archived state for project %s run %s", projectId, runId);
    }
    this.logger.warn("Audit log not archived for project %s run %s (StateStore limitation)", projectId, runId);
  }
}

// ../packages/watchdog/src/checkpoint.ts
import { randomUUID as randomUUID2 } from "node:crypto";

// ../packages/watchdog/src/schema.ts
var SCHEMA_VERSION = 1;

// ../packages/watchdog/src/constants.ts
var MAX_RALPH_ROUNDS = 10;
var MIN_GATE_ROUNDS = 5;
var EARLY_STOP_CONSECUTIVE = 2;
var STALE_THRESHOLD_MS = 4 * 60 * 60 * 1000;

// ../packages/watchdog/src/transitions.ts
function ok() {
  return { valid: true };
}
function fail(violation, guidance) {
  return { valid: false, violation, guidance };
}
function isInt(val) {
  return typeof val === "number" && Number.isInteger(val);
}
function isNonEmptyString(val) {
  return typeof val === "string" && val.length > 0;
}
function isNonNegativeInt(val) {
  return isInt(val) && val >= 0;
}
function checkTally(tally) {
  if (typeof tally !== "object" || tally === null) {
    return { ok: false, msg: "tally must be an object" };
  }
  const t = tally;
  for (const key of ["C", "H", "M", "L", "I"]) {
    if (!(key in t)) {
      return { ok: false, msg: `tally missing required field '${key}'` };
    }
    if (!isNonNegativeInt(t[key])) {
      return { ok: false, msg: `tally.${key} must be a non-negative integer` };
    }
  }
  return { ok: true };
}
var NO_ACTIVE_RUN = "No active pipeline run for this project.";
var START_FIRST = "Start a pipeline first by calling tdd_checkpoint with event='pipeline_start'.";
function validateTransition(event, payload, state) {
  switch (event) {
    case "pipeline_start": {
      if (!isNonEmptyString(payload.description)) {
        return fail("Missing required field", "pipeline_start requires a non-empty string description field.");
      }
      break;
    }
    case "phase_enter": {
      if (!isInt(payload.phase) || payload.phase < 1 || payload.phase > 5) {
        return fail("Invalid phase number", "phase_enter requires phase to be an integer between 1 and 5.");
      }
      break;
    }
    case "ralph_loop_start": {
      if (!isInt(payload.phase)) {
        return fail("Invalid phase", "ralph_loop_start requires phase to be an integer.");
      }
      break;
    }
    case "ralph_round_complete": {
      if (!isInt(payload.phase)) {
        return fail("Invalid phase", "ralph_round_complete requires phase to be an integer.");
      }
      if (!isInt(payload.round) || payload.round < 1) {
        return fail("Invalid round number", "ralph_round_complete requires round to be an integer >= 1.");
      }
      const tc = checkTally(payload.tally);
      if (!tc.ok) {
        if (tc.msg?.includes("must be")) {
          return fail("Invalid tally field type", "ralph_round_complete requires tally with C, H, M, L, I as non-negative integers.");
        }
        return fail("Missing required field", "ralph_round_complete requires tally with C, H, M, L, I as non-negative integers.");
      }
      if (payload.contested_resolutions !== undefined) {
        if (!Array.isArray(payload.contested_resolutions)) {
          return fail("Invalid contested_resolutions", "contested_resolutions must be an array.");
        }
        for (const item of payload.contested_resolutions) {
          if (typeof item !== "object" || item === null) {
            return fail("Invalid contested_resolutions item", "Each contested_resolution must be an object with id and action fields.");
          }
          const cr = item;
          if (!isNonEmptyString(cr.id)) {
            return fail("Invalid contested_resolutions item", "Each contested_resolution must have a non-empty string id.");
          }
          if (!["accepted", "re_raised", "escalated"].includes(cr.action)) {
            return fail("Invalid contested_resolutions action", "contested_resolution action must be one of: accepted, re_raised, escalated.");
          }
        }
      }
      if (payload.new_contested !== undefined) {
        if (!Array.isArray(payload.new_contested)) {
          return fail("Invalid new_contested", "new_contested must be an array.");
        }
        for (const item of payload.new_contested) {
          if (typeof item !== "object" || item === null) {
            return fail("Invalid new_contested item", "Each new_contested item must be an object with id and description fields.");
          }
          const nc = item;
          if (!isNonEmptyString(nc.id)) {
            return fail("Invalid new_contested item", "Each new_contested item must have a non-empty string id.");
          }
          if (!isNonEmptyString(nc.description)) {
            return fail("Invalid new_contested item", "Each new_contested item must have a non-empty string description.");
          }
        }
      }
      break;
    }
    case "ralph_terminate": {
      if (!isInt(payload.phase)) {
        return fail("Invalid phase", "ralph_terminate requires phase to be an integer.");
      }
      if (!["gate_pass", "early_stop", "max_rounds"].includes(payload.termination)) {
        return fail("Invalid termination type", "ralph_terminate requires termination to be one of: gate_pass, early_stop, max_rounds.");
      }
      break;
    }
    case "test_evidence": {
      if (payload.phase !== 4) {
        return fail("Invalid phase for test evidence", "test_evidence requires phase to be 4.");
      }
      if (!isNonEmptyString(payload.evidence_file)) {
        return fail("Missing or invalid evidence_file", "test_evidence requires a non-empty string evidence_file field.");
      }
      break;
    }
    case "user_approval": {
      if (!isInt(payload.phase)) {
        return fail("Invalid phase", "user_approval requires phase to be an integer.");
      }
      break;
    }
    case "phase_complete": {
      if (!isInt(payload.phase)) {
        return fail("Invalid phase", "phase_complete requires phase to be an integer.");
      }
      break;
    }
  }
  switch (event) {
    case "pipeline_start": {
      return ok();
    }
    case "phase_enter": {
      if (state === null) {
        return fail(NO_ACTIVE_RUN, START_FIRST);
      }
      const phase = payload.phase;
      if (phase === 1) {
        if (state.phaseStatus !== "idle") {
          return fail("Pipeline already active", "Phase 1 can only be entered when pipeline status is idle.");
        }
      } else {
        const prev = phase - 1;
        const prevRec = state.phases[prev];
        if (!prevRec || !prevRec.userApproved) {
          return fail(`Phase ${prev} not yet complete`, `Phase ${phase} cannot be entered until phase ${prev} is user-approved.`);
        }
        if (state.phaseStatus !== "complete") {
          return fail("Previous phase not completed", `Phase ${phase} cannot be entered until the previous phase is marked complete.`);
        }
      }
      if (phase === 5 && !state.testEvidenceConfirmed) {
        return fail("Test evidence not confirmed", "Phase 5 cannot be entered until test evidence is confirmed.");
      }
      return ok();
    }
    case "ralph_loop_start": {
      if (state === null)
        return fail(NO_ACTIVE_RUN, START_FIRST);
      if (state.currentPhase !== payload.phase) {
        return fail("Phase mismatch", `ralph_loop_start must target the current phase (${state.currentPhase}).`);
      }
      if (state.phaseStatus !== "active") {
        return fail("Phase not active", "ralph_loop_start can only be called when phase status is active.");
      }
      return ok();
    }
    case "ralph_round_complete": {
      if (state === null)
        return fail(NO_ACTIVE_RUN, START_FIRST);
      if (state.currentPhase !== payload.phase) {
        return fail("Phase mismatch", `ralph_round_complete must target the current phase (${state.currentPhase}).`);
      }
      if (state.phaseStatus !== "ralph_loop") {
        return fail("Not in ralph loop", "ralph_round_complete can only be called when phase status is ralph_loop.");
      }
      if (state.ralph === null) {
        return fail("Ralph loop not initialized", "ralph_round_complete requires ralph loop to be started first.");
      }
      if (payload.round !== state.ralph.round + 1) {
        return fail("Round skipping not allowed", `Expected round ${state.ralph.round + 1}, got ${payload.round}.`);
      }
      if (state.ralph.openContested.length > 0 && payload.contested_resolutions === undefined) {
        return fail("Missing contested_resolutions", "There are open contested issues that must be resolved in this round.");
      }
      return ok();
    }
    case "ralph_terminate": {
      if (state === null)
        return fail(NO_ACTIVE_RUN, START_FIRST);
      if (state.currentPhase !== payload.phase) {
        return fail("Phase mismatch", `ralph_terminate must target the current phase (${state.currentPhase}).`);
      }
      if (state.phaseStatus !== "ralph_loop") {
        return fail("Not in ralph loop", "ralph_terminate can only be called when phase status is ralph_loop.");
      }
      if (state.ralph === null) {
        return fail("Ralph loop not initialized", "ralph_terminate requires ralph loop to be started first.");
      }
      const termination = payload.termination;
      const ralph = state.ralph;
      if (termination === "gate_pass") {
        if (ralph.round < MIN_GATE_ROUNDS) {
          return fail("Insufficient rounds for gate pass", `Gate pass requires at least ${MIN_GATE_ROUNDS} rounds. Current: ${ralph.round}.`);
        }
        const last = ralph.tallyHistory[ralph.tallyHistory.length - 1];
        if (!last || last.C + last.H + last.M > 0) {
          return fail("Unresolved issues remain", "Gate pass requires the last tally to have C+H+M equal to 0.");
        }
      } else if (termination === "early_stop") {
        if (ralph.consecutiveZero < EARLY_STOP_CONSECUTIVE) {
          return fail("Insufficient consecutive zero rounds", `Early stop requires at least ${EARLY_STOP_CONSECUTIVE} consecutive zero rounds. Current: ${ralph.consecutiveZero}.`);
        }
      } else if (termination === "max_rounds") {
        if (ralph.round < MAX_RALPH_ROUNDS) {
          return fail("Insufficient rounds for max_rounds termination", `max_rounds termination requires at least ${MAX_RALPH_ROUNDS} rounds. Current: ${ralph.round}.`);
        }
        const last = ralph.tallyHistory[ralph.tallyHistory.length - 1];
        if (!last || last.C + last.H + last.M === 0) {
          return fail("No unresolved issues", "max_rounds termination requires the last tally to have C+H+M greater than 0.");
        }
      }
      return ok();
    }
    case "test_evidence": {
      if (state === null)
        return fail(NO_ACTIVE_RUN, START_FIRST);
      if (state.currentPhase < 4) {
        return fail("Invalid phase for test evidence", "test_evidence can only be submitted in phase 4 or later.");
      }
      return ok();
    }
    case "user_approval": {
      if (state === null)
        return fail(NO_ACTIVE_RUN, START_FIRST);
      const phase = payload.phase;
      const rec = state.phases[phase];
      if (!rec) {
        return fail(`Phase ${phase} not found`, `user_approval requires phase ${phase} to have been entered.`);
      }
      if (!rec.ralphCompleted) {
        return fail("Ralph loop not completed", `user_approval requires phase ${phase} ralph loop to be completed first.`);
      }
      return ok();
    }
    case "phase_complete": {
      if (state === null)
        return fail(NO_ACTIVE_RUN, START_FIRST);
      const phase = payload.phase;
      const rec = state.phases[phase];
      if (!rec) {
        return fail(`Phase ${phase} not found`, `phase_complete requires phase ${phase} to have been entered.`);
      }
      if (!rec.userApproved) {
        return fail("Phase not user-approved", `phase_complete requires phase ${phase} to be user-approved first.`);
      }
      if (state.phaseStatus !== "awaiting_approval") {
        return fail("Phase not awaiting approval", "phase_complete can only be called when phase status is awaiting_approval.");
      }
      return ok();
    }
  }
}
function applyTransition(event, payload, state) {
  const now = typeof payload._now === "string" ? payload._now : new Date().toISOString();
  switch (event) {
    case "pipeline_start": {
      return {
        version: SCHEMA_VERSION,
        projectId: payload._projectId,
        runId: payload._runId,
        startedAt: now,
        description: payload.description,
        currentPhase: 0,
        phaseStatus: "idle",
        phases: {},
        ralph: null,
        testEvidenceConfirmed: false,
        lastCheckpointAt: now
      };
    }
    case "phase_enter": {
      if (state === null) {
        throw new Error("BUG: state must not be null for phase_enter");
      }
      const phase = payload.phase;
      return {
        ...state,
        currentPhase: phase,
        phaseStatus: "active",
        phases: {
          ...state.phases,
          [phase]: {
            phase,
            enteredAt: now,
            ralphCompleted: false,
            ralphTermination: null,
            userApproved: false,
            approvedAt: null
          }
        },
        lastCheckpointAt: now
      };
    }
    case "ralph_loop_start": {
      if (state === null) {
        throw new Error("BUG: state must not be null for ralph_loop_start");
      }
      const phase = payload.phase;
      return {
        ...state,
        phaseStatus: "ralph_loop",
        ralph: {
          phase,
          round: 0,
          consecutiveZero: 0,
          tallyHistory: [],
          openContested: [],
          escalated: false,
          escalatedAt: null,
          termination: null
        },
        lastCheckpointAt: now
      };
    }
    case "ralph_round_complete": {
      if (state === null) {
        throw new Error("BUG: state must not be null for ralph_round_complete");
      }
      if (state.ralph === null) {
        throw new Error("BUG: ralph must not be null for ralph_round_complete");
      }
      const phase = payload.phase;
      const round = payload.round;
      const tally = payload.tally;
      const contestedResolutions = payload.contested_resolutions;
      const newContested = payload.new_contested;
      const roundTally = {
        round,
        C: tally.C,
        H: tally.H,
        M: tally.M,
        L: tally.L,
        I: tally.I,
        timestamp: now
      };
      const chmZero = tally.C + tally.H + tally.M === 0;
      const newConsecutiveZero = chmZero ? state.ralph.consecutiveZero + 1 : 0;
      const resolvedIds = new Set(contestedResolutions?.map((r) => r.id) ?? []);
      const newOpenContested = [];
      for (const issue of state.ralph.openContested) {
        if (resolvedIds.has(issue.id)) {
          const action = contestedResolutions.find((r) => r.id === issue.id).action;
          if (action === "accepted") {
            continue;
          }
          newOpenContested.push({
            ...issue,
            disputeRounds: issue.disputeRounds + 1
          });
        } else {
          newOpenContested.push({
            ...issue,
            disputeRounds: issue.disputeRounds + 1
          });
        }
      }
      if (newContested) {
        for (const nc of newContested) {
          newOpenContested.push({
            id: nc.id,
            firstContestedRound: round,
            disputeRounds: 0,
            description: nc.description
          });
        }
      }
      return {
        ...state,
        ralph: {
          ...state.ralph,
          round,
          consecutiveZero: newConsecutiveZero,
          tallyHistory: [...state.ralph.tallyHistory, roundTally],
          openContested: newOpenContested
        },
        lastCheckpointAt: now
      };
    }
    case "ralph_terminate": {
      if (state === null) {
        throw new Error("BUG: state must not be null for ralph_terminate");
      }
      if (state.ralph === null) {
        throw new Error("BUG: ralph must not be null for ralph_terminate");
      }
      const phase = payload.phase;
      const termination = payload.termination;
      return {
        ...state,
        phaseStatus: "awaiting_approval",
        ralph: {
          ...state.ralph,
          termination
        },
        phases: {
          ...state.phases,
          [phase]: {
            ...state.phases[phase],
            ralphCompleted: true,
            ralphTermination: termination
          }
        },
        lastCheckpointAt: now
      };
    }
    case "test_evidence": {
      if (state === null) {
        throw new Error("BUG: state must not be null for test_evidence");
      }
      return {
        ...state,
        testEvidenceConfirmed: true,
        lastCheckpointAt: now
      };
    }
    case "user_approval": {
      if (state === null) {
        throw new Error("BUG: state must not be null for user_approval");
      }
      const phase = payload.phase;
      return {
        ...state,
        phases: {
          ...state.phases,
          [phase]: {
            ...state.phases[phase],
            userApproved: true,
            approvedAt: now
          }
        },
        lastCheckpointAt: now
      };
    }
    case "phase_complete": {
      if (state === null) {
        throw new Error("BUG: state must not be null for phase_complete");
      }
      return {
        ...state,
        phaseStatus: "complete",
        ralph: null,
        lastCheckpointAt: now
      };
    }
  }
}

// ../packages/watchdog/src/project-id.ts
import { createHash } from "node:crypto";
import { resolve } from "node:path";
function computeProjectId(worktree) {
  const absolute = resolve(worktree);
  return createHash("sha256").update(absolute).digest("hex").slice(0, 8);
}

// ../packages/watchdog/src/checkpoint.ts
class CheckpointHandler {
  store;
  staleThresholdMs;
  constructor(store, staleThresholdMs) {
    this.store = store;
    this.staleThresholdMs = staleThresholdMs;
  }
  async handle(event, payloadJson, context) {
    const projectId = computeProjectId(context.worktree);
    const sessionId = context.sessionID;
    const now = new Date().toISOString();
    let payload;
    try {
      payload = JSON.parse(payloadJson);
      if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
        throw new Error("not an object");
      }
    } catch {
      return JSON.stringify({
        ok: false,
        violation: "Invalid JSON payload",
        guidance: "The payload must be a valid JSON object."
      });
    }
    const activeRun = this.store.getActiveRun(projectId);
    if (activeRun && event !== "pipeline_start") {
      const state = this.store.readState(projectId, activeRun.runId);
      if (state && isStale(state.lastCheckpointAt, this.staleThresholdMs)) {
        const summary = summarizeState(state);
        return JSON.stringify({
          ok: false,
          recovery: true,
          staleState: summary,
          message: `Found stale pipeline run. Last activity: Phase ${summary.phase} ${summary.phaseStatus}${summary.ralphRound ? ` round ${summary.ralphRound}` : ""}. Options: (1) continue from where you left off — call phase_enter or ralph_round_complete as appropriate, (2) start fresh — call pipeline_start to archive this run and begin a new one.`
        });
      }
    }
    const currentState = activeRun ? this.store.readState(projectId, activeRun.runId) ?? null : null;
    if (event === "pipeline_start") {
      payload._runId = randomUUID2();
      payload._projectId = projectId;
    }
    payload._now = now;
    const validation = validateTransition(event, payload, currentState);
    if (!validation.valid) {
      if (activeRun) {
        const entry = {
          timestamp: now,
          runId: activeRun.runId,
          projectId,
          sessionId,
          event,
          phase: payload.phase ?? currentState?.currentPhase ?? 0,
          decision: "BLOCK",
          violation: validation.violation
        };
        this.store.appendAudit(projectId, activeRun.runId, entry);
      }
      return JSON.stringify({
        ok: false,
        violation: validation.violation,
        guidance: validation.guidance
      });
    }
    const newState = applyTransition(event, payload, currentState);
    const runId = newState.runId;
    if (event === "pipeline_start") {
      this.store.setActiveRun(projectId, {
        runId,
        projectId,
        startedAt: now
      });
    }
    this.store.writeState(projectId, runId, newState);
    const auditEntry = {
      timestamp: now,
      runId,
      projectId,
      sessionId,
      event,
      phase: newState.currentPhase,
      decision: "PASS"
    };
    if (payload.round !== undefined) {
      auditEntry.round = payload.round;
    }
    this.store.appendAudit(projectId, runId, auditEntry);
    if (event === "phase_complete" && payload.phase === 5) {
      this.store.clearActiveRun(projectId);
      this.store.archiveRun(projectId, runId);
    }
    return JSON.stringify({
      ok: true,
      state: summarizeState(newState)
    });
  }
}
function isStale(lastCheckpointAt, thresholdMs) {
  const elapsed = Date.now() - new Date(lastCheckpointAt).getTime();
  return elapsed > thresholdMs;
}
function summarizeState(state) {
  return {
    phase: state.currentPhase,
    phaseStatus: state.phaseStatus,
    ralphRound: state.ralph?.round ?? null,
    runId: state.runId
  };
}

// ../packages/watchdog/src/tools.ts
import { z as z2 } from "zod";
function createWatchdogTools(deps) {
  const { checkpointHandler } = deps;
  return {
    tdd_checkpoint: {
      description: "Report a checkpoint event to the TDD pipeline watchdog. Call this at mandatory points during tdd-pipeline execution: pipeline_start, phase_enter, ralph_loop_start, ralph_round_complete, ralph_terminate, test_evidence, user_approval, phase_complete.",
      args: {
        event: z2.string().describe("Checkpoint event type: pipeline_start | phase_enter | ralph_loop_start | ralph_round_complete | ralph_terminate | test_evidence | user_approval | phase_complete"),
        payload: z2.string().describe("JSON string with event-specific data. See tdd-pipeline SKILL.md for payload schemas.")
      },
      execute: async (args, context) => {
        const worktree = context?.worktree ?? context?.directory ?? "";
        const sessionID = context?.sessionID ?? context?.session?.id ?? "";
        return checkpointHandler.handle(args.event, args.payload ?? "{}", { worktree, sessionID });
      }
    }
  };
}

// ../packages/watchdog/src/index.ts
async function createWatchdogRole(ctx) {
  const sessionsDir = ctx.config?.aristotleBridge?.sessionsDir;
  if (!sessionsDir) {
    return null;
  }
  const logger4 = createLogger("watchdog", "AGENT_PLATFORM_LOG");
  const stateStore = createStateStore(sessionsDir, logger4);
  const store = new PipelineStore(stateStore, logger4);
  const checkpointHandler = new CheckpointHandler(store, STALE_THRESHOLD_MS);
  try {
    const projectIds = store.getProjectIds();
    for (const projectId of projectIds) {
      const activeRun = store.getActiveRun(projectId);
      if (activeRun) {
        const state = store.readState(projectId, activeRun.runId);
        if (state) {
          const elapsed = Date.now() - new Date(state.lastCheckpointAt).getTime();
          if (elapsed > STALE_THRESHOLD_MS) {
            logger4.warn("Found stale watchdog run for project %s: phase %d, last checkpoint %dms ago", projectId, state.currentPhase, elapsed);
          }
        }
      }
    }
  } catch (err) {
    logger4.warn("Crash recovery scan failed: %s", String(err));
  }
  const tools = createWatchdogTools({ checkpointHandler });
  return { tools };
}

// index.ts
async function plugin_default(ctx) {
  const aristotleRole = await createAristotleRole(ctx);
  const watchdogRole = await createWatchdogRole(ctx);
  return assemblePlugin(ctx, [aristotleRole, watchdogRole]);
}
export {
  plugin_default as default
};

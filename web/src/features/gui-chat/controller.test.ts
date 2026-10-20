import { describe, expect, it } from "vitest";
import { GuiChatController, type GuiChatTransport } from "./controller";

// Synthetic wire fixtures, shaped from the pinned Python contracts (not live traffic).
class Peer {
  connectionState = "idle";
  calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  events = new Set<(event: any) => void>();
  requests = new Set<(request: any) => unknown>();
  states = new Set<(state: any) => void>();
  canonical = false;
  snapshot: any = { session_id: "live-1", stored_session_id: "stored-1", messages: [], message_count: 0,
    info: { model: "test-model", provider: "test-provider", profile_name: "work", title: "Test" }, running: false,
    revision: 1, execution_generation: 0, pending: [], prompts: [] };
  handle?: (method: string, params: Record<string, unknown>) => unknown;
  async connect() { this.connectionState = "open"; this.states.forEach(fn => fn("open")); }
  close() { this.connectionState = "closed"; this.states.forEach(fn => fn("closed")); }
  onAny(fn: (event: any) => void) { this.events.add(fn); return () => { this.events.delete(fn); }; }
  onState(fn: (state: any) => void) { this.states.add(fn); fn(this.connectionState); return () => { this.states.delete(fn); }; }
  onRequest(fn: (request: any) => unknown) { this.requests.add(fn); return () => { this.requests.delete(fn); }; }
  sessionReplayBarrier() { return undefined; }
  async request(method: string, params: Record<string, unknown> = {}) {
    this.calls.push({ method, params });
    if (this.handle) { const result = this.handle(method, params); if (result !== undefined) return await result; }
    if (method === "runtime.describe") {
      if (this.canonical) return { session_create: { sources: ["gui"] }, capabilities: ["durable-admission-v1"] };
      throw Object.assign(new Error("Method not found"), { code: -32601 });
    }
    if (["session.create", "session.resume", "session.activate"].includes(method)) return this.snapshot;
    if (method === "prompt.submit") return { status: "streaming" };
    if (method === "session.interrupt") return { status: "interrupted" };
    throw new Error(`Unexpected ${method}`);
  }
  emit(type: string, payload: Record<string, unknown>, sid = "live-1", seq?: number) {
    this.events.forEach(fn => fn({ type, payload, session_id: sid, seq }));
  }
  transport() { return this as unknown as GuiChatTransport; }
}

function setup() { const peer = new Peer(); return { peer, controller: new GuiChatController(peer.transport(), { profile: "work", workspaceCwd: "/chosen" }) }; }

describe("GUI chat controller", () => {
  it("rejects slash commands and duplicate in-flight sends rather than queuing or steering", async () => {
    const { peer, controller } = setup(); await controller.start();
    await expect(controller.submit("/approve always")).rejects.toThrow("Invalid characters");
    let release!: (value: unknown) => void;
    peer.handle = method => method === "prompt.submit" ? new Promise(resolve => { release = resolve; }) : undefined;
    const first = controller.submit("one");
    await expect(controller.submit("two")).rejects.toThrow();
    release({ status: "streaming" }); await first;
    expect(peer.calls.filter(call => call.method === "prompt.submit")).toHaveLength(1);
  });
  it("buffers pre-snapshot server requests and rejects foreign profile readback before publishing history", async () => {
    const { peer, controller } = setup();
    peer.handle = method => {
      if (method === "session.create") {
        peer.requests.forEach(fn => fn({ id: "srq-early", method: "approval", params: { session_id: "live-1", choices: ["deny"] }, respond() {}, fail() {} }));
        return peer.snapshot;
      }
      return undefined;
    };
    await controller.start();
    expect(controller.getSnapshot().pendingRequests.map(item => item.id)).toEqual(["srq-early"]);
    const foreign = setup(); foreign.peer.snapshot.info.profile_name = "other";
    await expect(foreign.controller.start()).rejects.toThrow("profile");
    expect(foreign.controller.getSnapshot().sessionId).toBeNull();
  });
  it("cannot create after disposal during authentication, unsubscribes and publishes startup state", async () => {
    const { peer, controller } = setup(); let release!: () => void;
    const connected = new Promise<void>(resolve => { release = resolve; });
    peer.connect = async () => { await connected; peer.connectionState = "open"; };
    let updates = 0; controller.subscribe(() => { updates += 1; });
    const started = controller.start(); controller.dispose(); release(); await started;
    expect(peer.calls).toEqual([]); expect(peer.events.size).toBe(0); expect(peer.requests.size).toBe(0);
    expect(peer.connectionState).toBe("closed");
    const fresh = setup(); fresh.controller.subscribe(() => { updates += 1; }); await fresh.controller.start();
    expect(updates).toBeGreaterThan(0);
  });
  it("requires an explicit exact-target confirmation before sending the canonical model guard token", async () => {
    const { peer, controller } = setup(); peer.canonical = true;
    peer.handle = (method, params) => {
      if (method === "model.options") return { providers: [{ slug: "custom", authenticated: true, models: ["costly"] }] };
      if (method === "session.mutate") {
        if (!(params.payload as Record<string, unknown>).confirm) return { confirm_required: true, confirm_message: "Cost warning", confirm: "guard-token" };
        peer.snapshot.info.model = "costly"; return { revision: 2 };
      }
      return undefined;
    };
    await controller.start();
    expect(await controller.setModel({ provider: "custom", model: "costly" })).toMatchObject({ confirm_required: true });
    expect(controller.getSnapshot().model).toBe("test-model");
    await controller.setModel({ provider: "custom", model: "costly", confirmExpensiveModel: true });
    expect(peer.calls.filter(call => call.method === "session.mutate").map(call => call.params.payload)).toEqual([{ provider: "custom", model: "costly" }, { provider: "custom", model: "costly", confirm: "guard-token" }]);
  });
  it("validates model inventory and applies only session-scoped, acknowledged model picks on both transports", async () => {
    for (const canonical of [false, true]) {
      const { peer, controller } = setup(); peer.canonical = canonical;
      peer.handle = method => {
        if (method === "model.options") return { providers: [{ slug: "custom", authenticated: true, models: ["picked"], capabilities: { picked: { reasoning: true, fast: false } } }] };
        if (method === "config.set" || method === "session.mutate") { peer.snapshot.info.model = "picked"; peer.snapshot.info.provider = "custom"; return { key: "model", value: "picked", revision: 2 }; }
        return undefined;
      };
      await controller.start();
      await expect(controller.setModel({ provider: "custom", model: "unlisted" })).rejects.toThrow();
      await controller.setModel({ provider: "custom", model: "picked" });
      const call = peer.calls.find(call => call.method === (canonical ? "session.mutate" : "config.set"));
      expect(call?.params).toMatchObject(canonical ? { operation: "model", expected_revision: 1, expected_generation: 0, payload: { provider: "custom", model: "picked" }, profile: "work" } : { key: "model", value: "picked --provider custom --session", session_id: "live-1", profile: "work", confirm_expensive_model: false });
      expect(controller.getSnapshot()).toMatchObject({ model: "picked", provider: "custom", supportsReasoning: false });
      await expect(controller.setReasoning("high")).rejects.toThrow("effort choices");
      await expect(controller.upload({ name: "test.txt" } as File)).rejects.toThrow("not supported");
    }
  });
  it("publishes canonical live prompts and rejects old-generation cards after a replay-gap snapshot", async () => {
    const { peer, controller } = setup(); peer.canonical = true;
    await controller.start();
    peer.emit("approval.request", { prompt_id: "p1", kind: "approval", execution_generation: 2, choices: ["deny"] }, "live-1", 10);
    expect(controller.getSnapshot().pendingRequests).toHaveLength(1);
    peer.snapshot.execution_generation = 3;
    peer.emit("session.replay_gap", { replay_epoch: "new" });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(controller.getSnapshot().pendingRequests).toEqual([]);
    await expect(controller.respond("p1", { choice: "deny" })).rejects.toThrow();
    peer.emit("message.delta", { text: "new epoch" }, "live-1", 1);
    expect(controller.getSnapshot().messages.at(-1)?.text).toBe("new epoch");
  });
  it("restores canonical prompt cards and answers with the snapshot generation, not legacy response frames", async () => {
    const { peer, controller } = setup(); peer.canonical = true;
    peer.snapshot.execution_generation = 4;
    peer.snapshot.prompts = [{ kind: "approval", prompt_id: "p1", execution_generation: 4, choices: ["once", "deny"], command: "pwd" }];
    peer.handle = method => method === "approval.respond" ? { status: "resolved", prompt_id: "p1" } : undefined;
    await controller.start();
    expect(controller.getSnapshot().pendingRequests).toEqual([expect.objectContaining({ id: "p1", method: "approval" })]);
    await controller.respond("p1", { choice: "deny" });
    expect(peer.calls.at(-1)).toEqual({ method: "approval.respond", params: { session_id: "live-1", profile: "work", execution_generation: 4, prompt_id: "p1", choice: "deny" } });
    expect(controller.getSnapshot().pendingRequests).toEqual([]);
  });
  it("restores and withdraws exact pending requests, rejects unsupported secure flows and never auto-approves", async () => {
    const { peer, controller } = setup(); await controller.start();
    const sent: unknown[] = []; const failed: unknown[] = [];
    const request = (id: string, method: string, params: Record<string, unknown>) => {
      const frame = { id, method, params: { session_id: "live-1", ...params }, respond: (value: unknown) => sent.push(value), fail: (...value: unknown[]) => failed.push(value) };
      peer.requests.forEach(fn => fn(frame)); return frame;
    };
    request("srq-1", "approval", { choices: ["once", "deny"] });
    request("srq-2", "approval", { choices: ["deny"] });
    expect(sent).toEqual([]);
    await expect(controller.respond("srq-2", { choice: "once" })).rejects.toThrow();
    await controller.respond("srq-1", { choice: "once" });
    await expect(controller.respond("srq-1", { choice: "once" })).rejects.toThrow();
    expect(sent).toEqual([{ choice: "once" }]);
    peer.emit("request.cancel", { id: "srq-2", method: "approval", reason: "resolved" });
    await expect(controller.respond("srq-2", { choice: "deny" })).rejects.toThrow();
    request("srq-3", "secret", { prompt: "sensitive" });
    expect(failed).toHaveLength(1);
    expect(controller.getSnapshot().pendingRequests.some(item => item.id === "srq-3")).toBe(false);
    expect(controller.getSnapshot().error).toContain("Unsupported");
  });
  it("keeps Stop pending until a terminal event, and fences canonical interrupts to the observed generation", async () => {
    for (const canonical of [false, true]) {
      const { peer, controller } = setup(); peer.canonical = canonical; peer.snapshot.execution_generation = 7;
      peer.handle = method => method === "prompt.submit" ? { status: canonical ? "started" : "streaming", admission_id: "a1", execution_generation: 8 } : undefined;
      await controller.start(); await controller.submit("work"); await controller.stop();
      expect(controller.getSnapshot().busy).toBe(true);
      const params = peer.calls.find(call => call.method === "session.interrupt")!.params;
      expect(params).toEqual({ session_id: "live-1", profile: "work", ...(canonical ? { execution_generation: 8 } : {}) });
      peer.emit("message.complete", { text: "", status: "interrupted" });
      expect(controller.getSnapshot().busy).toBe(false);
      if (canonical) expect(peer.calls.find(call => call.method === "prompt.submit")?.params).toMatchObject({ submission_id: expect.any(String), clarify_batch: true });
    }
  });
  it("never repeats a prompt after a lost acknowledgement, even after idle reconnect", async () => {
    const { peer, controller } = setup(); await controller.start();
    peer.handle = method => { if (method === "prompt.submit") throw new Error("WebSocket closed"); };
    await expect(controller.submit("run once")).rejects.toThrow("WebSocket closed");
    expect(controller.getSnapshot()).toMatchObject({ busy: true, error: expect.stringContaining("unknown") });
    await expect(controller.submit("run once")).rejects.toThrow();
    peer.close(); await controller.reconnect();
    await expect(controller.submit("run once")).rejects.toThrow();
    expect(peer.calls.filter(call => call.method === "prompt.submit")).toHaveLength(1);
    expect(peer.calls.filter(call => call.method === "session.create")).toHaveLength(1);
    expect(peer.calls.at(-1)).toMatchObject({ method: "session.resume", params: { session_id: "stored-1", profile: "work" } });
  });
  it("streams scoped text/reasoning and tool results once, completing only on backend events", async () => {
    const { peer, controller } = setup(); await controller.start();
    await controller.submit("hello");
    expect(controller.getSnapshot().busy).toBe(true);
    expect(peer.calls.find(call => call.method === "prompt.submit")?.params).toEqual({ session_id: "live-1", profile: "work", text: "hello" });
    peer.emit("message.start", {}, "live-1", 1);
    peer.emit("message.delta", { text: "wrong session" }, "other", 1);
    peer.emit("reasoning.delta", { text: "summary" }, "live-1", 2);
    peer.emit("message.delta", { text: "partial" }, "live-1", 3);
    peer.emit("message.delta", { text: "partial" }, "live-1", 3);
    peer.emit("tool.start", { tool_id: "t1", name: "terminal", args: { command: "pwd" } }, "live-1", 4);
    peer.emit("tool.complete", { tool_id: "t1", name: "terminal", result: { error: "denied" } }, "live-1", 5);
    expect(controller.getSnapshot().messages.at(-1)).toMatchObject({ text: "partial", reasoning: "summary" });
    expect(controller.getSnapshot().tools).toEqual([expect.objectContaining({ id: "t1", status: "completed", result: { error: "denied" } })]);
    peer.emit("message.complete", { text: "final", status: "error", error: "failed" }, "live-1", 6);
    expect(controller.getSnapshot()).toMatchObject({ busy: false, error: "failed" });
    expect(controller.getSnapshot().messages.map(message => message.text)).toEqual(["hello", "final"]);
  });
  it("resumes the requested stored conversation without replacing its cwd and projects history/inflight", async () => {
    const peer = new Peer();
    peer.snapshot.messages = [{ role: "user", text: "old", row_id: 5 }, { role: "assistant", content: "answer", row_id: 6 }, { role: "user", text: "private", display_kind: "hidden" }];
    peer.snapshot.inflight = { user: "new", assistant: "partial", streaming: true }; peer.snapshot.running = true;
    const controller = new GuiChatController(peer.transport(), { profile: "work", resumeId: "stored-1", workspaceCwd: "/wrong" });
    await controller.start();
    expect(peer.calls.find(call => call.method === "session.resume")?.params).toEqual({ session_id: "stored-1", profile: "work", source: "gui", close_on_disconnect: false, inline_images: false });
    expect(peer.calls.some(call => call.method === "session.create")).toBe(false);
    expect(controller.getSnapshot().messages.map(message => message.text)).toEqual(["old", "answer", "new", "partial"]);
    expect(controller.getSnapshot().busy).toBe(true);
  });
  it("detects authority-backed /api/ws before choosing the canonical GUI create wire", async () => {
    const { peer, controller } = setup(); peer.canonical = true;
    await controller.start();
    expect(peer.calls[0].method).toBe("runtime.describe");
    const params = peer.calls.find(call => call.method === "session.create")!.params;
    expect(params).toMatchObject({ source: "gui", profile: "work", request_id: expect.any(String), cwd: "/chosen" });
    expect(params).not.toHaveProperty("close_on_disconnect");
    expect(params).not.toHaveProperty("idempotency_key");
  });
  it("creates one explicitly profile-scoped GUI session and takes backend identity", async () => {
    const { peer, controller } = setup();
    await Promise.all([controller.start(), controller.start()]);
    expect(peer.calls.filter(call => call.method === "session.create")).toEqual([{ method: "session.create", params: expect.objectContaining({ profile: "work", source: "gui", cwd: "/chosen", cwd_explicit: true, close_on_disconnect: false }) }]);
    expect(controller.getSnapshot()).toMatchObject({ sessionId: "live-1", storedSessionId: "stored-1", model: "test-model", title: "Test", busy: false });
  });
});

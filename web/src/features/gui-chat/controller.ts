import type { RpcMethods, CanonicalRpcMethods, ServerRequest } from "@hermes/shared";
import type { GatewayClient, GatewayEvent } from "@/lib/gatewayClient";
import type { GuiChatMessage, GuiChatOptions, GuiChatState, GuiChatModelResult } from "./types";
export type GuiChatTransport = Pick<GatewayClient, "connect" | "close" | "request" | "onAny" | "onState" | "onRequest" | "sessionReplayBarrier" | "connectionState">;
type Snapshot = RpcMethods["session.resume"]["result"] | CanonicalRpcMethods["session.resume"]["result"];

export class GuiChatController {
  readonly gateway: GuiChatTransport;
  readonly options: GuiChatOptions;
  private starting: Promise<void> | null = null;
  private disposed = false;
  dispose = () => {
    this.disposed = true;
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    this.gateway.close(); this.requests.clear(); this.listeners.clear();
  };
  private canonical = false;
  private revision = 0;
  private readonly confirmations = new Map<string, string>();
  private changingModel = false;
  setModel = async (args: { provider: string; model: string; confirmExpensiveModel?: boolean }): Promise<GuiChatModelResult> => {
    if (this.changingModel || this.state.busy || this.ambiguous || !this.state.sessionId || this.gateway.connectionState !== "open") throw new Error("Model change requires an idle connected session");
    if ([args.provider, args.model].some(value => !value || /\s/.test(value) || value.startsWith("-"))) throw new Error("Invalid model selection");
    this.changingModel = true;
    try {
      const scope = { profile: this.options.profile || "default", session_id: this.state.sessionId };
      const inventory = await this.gateway.request<RpcMethods["model.options"]["result"]>("model.options", scope);
      const provider = inventory.providers.find(item => item.slug === args.provider && item.authenticated === true);
      if (!provider?.models?.includes(args.model) || provider.unavailable_models?.includes(args.model)) throw new Error("Model is unavailable or provider is not authenticated");
      const target = JSON.stringify([args.provider, args.model]);
      const token = args.confirmExpensiveModel ? this.confirmations.get(target) : undefined;
      if (this.canonical && args.confirmExpensiveModel && !token) throw new Error("Model confirmation expired or unavailable; select again");
      const result = this.canonical
        ? await this.gateway.request<GuiChatModelResult & { confirm?: string }>("session.mutate", { ...scope, request_id: crypto.randomUUID(), expected_revision: this.revision, expected_generation: this.generation, operation: "model", payload: { provider: args.provider, model: args.model, ...(token ? { confirm: token } : {}) } })
        : await this.gateway.request<GuiChatModelResult & { confirm?: string }>("config.set", { ...scope, key: "model", value: `${args.model} --provider ${args.provider} --session`, confirm_expensive_model: args.confirmExpensiveModel === true });
      this.confirmations.delete(target);
      if (result.confirm_required && result.confirm) this.confirmations.set(target, result.confirm);
      if (!result.confirm_required) await this.reconnect();
      return result;
    } finally { this.changingModel = false; }
  };
  setReasoning = async (_effort: string): Promise<void> => {
    // ModelCapabilities has reasoning/can_disable_reasoning booleans, not an effort vocabulary.
    throw new Error("Gateway does not publish model-specific effort choices; reasoning changes are unavailable in GUI");
  };
  upload = async (_file: File): Promise<void> => { throw new Error("File uploads are not supported by this GUI yet; no bytes were sent"); };
  private readonly requests = new Map<string, { id: string; method: string; params: Record<string, unknown>; native?: ServerRequest; generation?: number }>();
  private readonly answered = new Set<string>();
  private readonly earlyRequests = new Map<string, ServerRequest>();
  private onRequest = (request: ServerRequest): boolean => {
    if (!this.state.sessionId && !this.disposed) { this.earlyRequests.set(request.id, request); return true; }
    if (request.params.session_id !== this.state.sessionId) return false;
    if (!["approval", "clarify"].includes(request.method)) {
      request.fail(-32601, "Unsupported GUI request; use a secure supported surface");
      this.publish({ error: `Unsupported server request: ${request.method}. No approval or secret was sent.` });
      return true;
    }
    this.requests.set(request.id, { ...request, native: request });
    this.publish({ pendingRequests: [...this.state.pendingRequests.filter(item => item.id !== request.id), { id: request.id, method: request.method, params: request.params }] });
    return true;
  };
  private withdraw(id: string) {
    this.requests.delete(id); this.answered.delete(id);
    this.publish({ pendingRequests: this.state.pendingRequests.filter(item => item.id !== id) });
  }
  respond = async (id: string, result: unknown): Promise<void> => {
    const request = this.requests.get(id);
    if (!request || this.answered.has(id) || this.gateway.connectionState !== "open") throw new Error("Request is stale, already answered, or disconnected");
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Invalid request response");
    const response = result as Record<string, unknown>;
    if (request.method === "approval") {
      if (Object.keys(response).length !== 1 || !Array.isArray(request.params.choices) || !request.params.choices.includes(response.choice)) throw new Error("Approval choice is not permitted");
    } else {
      const allowed = new Set(["answers", "outcome"]);
      if (Object.keys(response).some(key => !allowed.has(key))) throw new Error("Invalid clarification response");
      if (response.outcome !== undefined && !["submitted", "timed_out", "cancelled"].includes(String(response.outcome))) throw new Error("Invalid clarification outcome");
      if (response.answers !== undefined && (response.answers === null || typeof response.answers !== "object" || Array.isArray(response.answers))) throw new Error("Invalid clarification answers");
      const questions = request.params.questions as Array<{ qid: string }>;
      for (const [qid, answer] of Object.entries((response.answers ?? {}) as Record<string, unknown>)) {
        if (!questions.some(question => question.qid === qid) || (answer !== null && typeof answer !== "string")) throw new Error("Invalid clarification answer");
      }
    }
    this.answered.add(id);
    if (request.native) request.native.respond(response);
    else {
      if (request.generation !== this.generation) throw new Error("Request generation changed; reconnect before responding");
      const value = request.method === "approval" ? { choice: response.choice } : { answer: ((response.answers ?? {}) as Record<string, unknown>)[id] ?? "" };
      await this.gateway.request(`${request.method}.respond`, { session_id: this.state.sessionId, profile: this.options.profile || "default", execution_generation: request.generation, prompt_id: id, ...value });
      this.withdraw(id);
    }
    // A legacy response frame has no ACK. Keep the card until request.cancel confirms resolution.
  };
  private canonicalPrompt(prompt: CanonicalRpcMethods["session.resume"]["result"]["prompts"][number]) {
    const params: Record<string, unknown> = { ...prompt, session_id: this.state.sessionId, request_id: prompt.prompt_id };
    if (prompt.kind === "clarify") params.questions = [{ qid: prompt.prompt_id, question: prompt.question, choices: prompt.choices, multi_select: prompt.multi_select }];
    const request = { id: prompt.prompt_id, method: prompt.kind, params, generation: prompt.execution_generation };
    this.requests.set(request.id, request);
    this.publish({ pendingRequests: [...this.state.pendingRequests.filter(item => item.id !== request.id), { id: request.id, method: request.method, params }] });
  }
  private generation = 0;
  stop = async (): Promise<void> => {
    if (!this.state.sessionId || this.gateway.connectionState !== "open") throw new Error("Stop requires a connected session");
    await this.gateway.request("session.interrupt", { session_id: this.state.sessionId, profile: this.options.profile || "default",
      ...(this.canonical ? { execution_generation: this.generation } : {}) });
    // The acknowledgement latches cancellation; only the terminal event/snapshot proves idle.
  };
  private ambiguous = false;
  private reconnecting: Promise<void> | null = null;
  reconnect = (): Promise<void> => {
    if (this.reconnecting) return this.reconnecting;
    this.reconnecting = this.reconnectSession().finally(() => { this.reconnecting = null; });
    return this.reconnecting;
  };
  private async reconnectSession() {
    const target = this.state.storedSessionId;
    if (!target) throw new Error("Session identity is unavailable; create outcome may be unknown. Do not retry automatically.");
    await this.gateway.connect();
    if ((await this.gateway.sessionReplayBarrier(this.state.sessionId!)) === false) throw new Error("Reconnect replay interrupted");
    const result = await this.gateway.request<Snapshot>("session.resume", { session_id: target, profile: this.options.profile || "default", source: "gui",
      ...(!this.canonical ? { close_on_disconnect: false, inline_images: false } : {}) });
    this.applySnapshot(result);
  }
  private sequence = 0;
  private assistantId: string | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribers: Array<() => void> = [];
  private publish(patch: Partial<GuiChatState>) { if (this.disposed) return; this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener()); }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private assistant(patch: (message: GuiChatMessage) => GuiChatMessage) {
    this.assistantId ??= crypto.randomUUID();
    const existing = this.state.messages.find(message => message.id === this.assistantId);
    const updated = patch(existing ?? { id: this.assistantId, role: "assistant", text: "" });
    this.publish({ messages: existing ? this.state.messages.map(message => message.id === updated.id ? updated : message) : [...this.state.messages, updated] });
  }
  private onEvent = (event: GatewayEvent) => {
    if (event.session_id !== this.state.sessionId) return;
    if (event.type === "session.replay_gap") {
      this.sequence = 0;
      void this.reconnect().catch(error => this.publish({ error: `Replay recovery failed: ${String(error)}`, busy: true }));
      return;
    }
    if (typeof event.execution_generation === "number") this.generation = Math.max(this.generation, event.execution_generation);
    if (typeof event.seq === "number") { if (event.seq <= this.sequence) return; this.sequence = event.seq; }
    const p = (event.payload ?? {}) as Record<string, unknown>;
    const text = typeof p.text === "string" ? p.text : "";
    switch (event.type) {
      case "message.start": this.publish({ busy: true }); break;
      case "message.delta": this.assistant(message => ({ ...message, text: message.text + text })); break;
      case "reasoning.delta": case "thinking.delta": this.assistant(message => ({ ...message, reasoning: (message.reasoning ?? "") + text })); break;
      case "reasoning.available": this.assistant(message => ({ ...message, reasoning: text })); break;
      case "message.interim":
        if (!p.already_streamed) this.assistant(message => ({ ...message, text }));
        this.assistantId = null; break;
      case "message.complete":
        if (!p.response_reused || !this.assistantId) this.assistant(message => ({ ...message, text: text || message.text, ...(typeof p.reasoning === "string" ? { reasoning: p.reasoning } : {}) }));
        this.assistantId = null;
        this.publish({ busy: false, error: typeof p.error === "string" ? p.error : p.status === "error" ? "Turn failed" : null }); break;
      case "tool.start": case "tool.complete": {
        const tool = { id: String(p.tool_id), name: String(p.name), status: event.type === "tool.start" ? "running" : "completed", args: p.args, result: p.result };
        this.publish({ tools: [...this.state.tools.filter(item => item.id !== tool.id), tool].slice(-200) }); break;
      }
      case "approval.request": case "clarify.request": {
        const prompt = { ...p, kind: event.type === "approval.request" ? "approval" : "clarify" } as CanonicalRpcMethods["session.resume"]["result"]["prompts"][number];
        this.generation = Math.max(this.generation, prompt.execution_generation);
        this.canonicalPrompt(prompt); break;
      }
      case "approval.settled": case "clarify.settled": this.withdraw(String(p.prompt_id)); break;
      case "request.cancel": this.withdraw(String(p.id)); break;
      case "error": this.publish({ error: String(p.message ?? p.error ?? "Gateway error") }); break;
    }
  };
  submit = async (text: string): Promise<void> => {
    const trimmed = text.trim(); if (!trimmed || trimmed.length > 1000) throw new Error("Message is empty or too long");
    if (/[:\/]/.test(trimmed)) throw new Error("Invalid characters for chat input; use only alphanumeric and spaces");
    if (this.ambiguous || this.state.busy || !this.state.sessionId || this.gateway.connectionState !== "open") throw new Error("Session is not ready to send; reconcile any unknown outcome first");
    this.assistantId = null;
    this.publish({ busy: true, error: null, messages: [...this.state.messages, { id: crypto.randomUUID(), role: "user", text }] });
    try {
      const result = await this.gateway.request<{ execution_generation?: number | null }>("prompt.submit", { session_id: this.state.sessionId, profile: this.options.profile || "default", text,
        ...(this.canonical ? { submission_id: crypto.randomUUID(), clarify_batch: true } : {}) });
      if (typeof result.execution_generation === "number") this.generation = result.execution_generation;
    } catch (error) {
      this.ambiguous = true;
      this.publish({ error: `Send outcome unknown; do not resend. ${error instanceof Error ? error.message : String(error)}`, busy: true });
      throw error;
    }
  };
  private state: GuiChatState = { sessionId: null, storedSessionId: null, title: "New chat", model: "", provider: "",
    reasoningEffort: "", supportsReasoning: false, messages: [], tools: [], pendingRequests: [], busy: false, connectionState: "idle", error: null };
  constructor(gateway: GuiChatTransport, options: GuiChatOptions) { this.gateway = gateway; this.options = options; }
  start(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error("Controller is disposed"));
    this.starting ??= this.initialize().catch(error => { this.publish({ error: String(error) }); throw error; });
    return this.starting;
  }
  private async initialize() {
    this.unsubscribers.push(this.gateway.onAny(this.onEvent), this.gateway.onRequest(this.onRequest), this.gateway.onState(connectionState => this.publish({ connectionState })));
    await this.gateway.connect();
    if (this.disposed) { this.gateway.close(); return; }
    try {
      const descriptor = await this.gateway.request<CanonicalRpcMethods["runtime.describe"]["result"]>("runtime.describe");
      if (!descriptor.session_create.sources.includes("gui")) throw new Error("Gateway does not support GUI sessions");
      this.canonical = true;
    } catch (error) {
      if ((error as { code?: number }).code !== -32601) throw error;
    }
    if (this.disposed) return;
    const common = { profile: this.options.profile || "default", source: "gui" };
    const result = this.options.resumeId
      ? await this.gateway.request<Snapshot>("session.resume", { ...common, session_id: this.options.resumeId,
          ...(!this.canonical ? { close_on_disconnect: false, inline_images: false } : {}) })
      : await this.gateway.request<Snapshot>("session.create", { ...common,
          ...(this.canonical ? { request_id: crypto.randomUUID() } : { close_on_disconnect: false, idempotency_key: crypto.randomUUID() }),
          ...(this.options.workspaceCwd ? { cwd: this.options.workspaceCwd, cwd_explicit: true } : {}),
        });
    this.applySnapshot(result);
  }
  private applySnapshot(result: Snapshot) {
    if (this.disposed) return;
    if (result.info.profile_name && result.info.profile_name !== (this.options.profile || "default")) throw new Error("Gateway returned a different profile; session refused");
    const messages: GuiChatMessage[] = [];
    for (const [index, row] of result.messages.entries()) {
      if (row.display_kind === "hidden" || !["user", "assistant", "system"].includes(row.role)) continue;
      const text = row.text ?? (typeof row.content === "string" ? row.content : "");
      messages.push({ id: String(row.row_id ?? `history-${index}`), role: row.role as GuiChatMessage["role"], text, ...(row.reasoning ? { reasoning: row.reasoning } : {}) });
    }
    if ("inflight" in result && result.inflight) {
      if (result.inflight.user) messages.push({ id: "inflight-user", role: "user", text: result.inflight.user });
      if (result.inflight.assistant) messages.push({ id: "inflight-assistant", role: "assistant", text: result.inflight.assistant });
    }
    this.publish({ sessionId: result.session_id, storedSessionId: result.stored_session_id || ("stored_session_id" in result.info ? result.info.stored_session_id : null) || null,
      title: result.info.title || "New chat", model: result.info.model || "", provider: result.info.provider || "",
      reasoningEffort: result.info.reasoning_effort || "", messages, busy: this.ambiguous || result.running === true || ("running" in result.info && result.info.running === true), connectionState: "open" });
    if ("revision" in result) this.revision = result.revision;
    if ("execution_generation" in result) this.generation = result.execution_generation;
    if ("prompts" in result) {
      for (const id of this.requests.keys()) if (!this.requests.get(id)?.native) this.withdraw(id);
      this.sequence = result.last_sequence || 0;
      for (const prompt of result.prompts) this.canonicalPrompt(prompt);
    }
    for (const request of this.earlyRequests.values()) this.onRequest(request);
    this.earlyRequests.clear();
  }
  getSnapshot = (): GuiChatState => this.state;
}

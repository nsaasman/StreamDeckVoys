const WebSocket = require("ws");

const PROTOCOL = "1.2.1";
const BASE_BACKOFF = 3000;
const MAX_BACKOFF = 60000;
const REQUEST_TIMEOUT = 15000;

class ResgateClient {
  constructor(settingsStore) {
    this._settings = settingsStore;
    this._ws = null;
    this._reqId = 0;
    this._pending = new Map();
    this._models = new Map();
    this._running = false;
    this._connecting = false;
    this._authenticated = false;
    this._reconnectTimer = null;
    this._backoff = BASE_BACKOFF;
    this._onUpdate = null;
    this._onConnectionChange = null;
  }

  setOnUpdate(callback) {
    this._onUpdate = callback;
  }

  setOnConnectionChange(callback) {
    this._onConnectionChange = callback;
  }

  start() {
    this._running = true;
    this._connect();
  }

  stop() {
    this._running = false;
    this._clearReconnect();
    this._closeSocket();
    this._models.clear();
    this._authenticated = false;
  }

  forceReconnect() {
    if (!this._running) return;
    this._clearReconnect();
    this._closeSocket();
    this._connect();
  }

  getModel(userUuid) {
    return this._models.get(userUuid) || null;
  }

  getModels() {
    return [...this._models.values()];
  }

  _connect() {
    if (!this._running || this._connecting || (this._ws && this._ws.readyState === WebSocket.OPEN)) {
      return;
    }

    const token = this._settings.getToken();
    const clientUuid = this._settings.getClientUuid();
    if (!token || !clientUuid) {
      this._emitConnectionChange({ type: "config" });
      return;
    }

    this._connecting = true;
    const url = this._settings.getResgateUrl();
    this._ws = new WebSocket(url);

    this._ws.on("open", () => {
      this._handshake().catch((err) => {
        this._emitConnectionChange({ type: "error", message: err.message });
        this._scheduleReconnect();
      });
    });

    this._ws.on("message", (raw) => {
      try {
        this._handleMessage(JSON.parse(raw.toString()));
      } catch {
        // ponytail: ignore malformed frames; next event or reconnect will recover
      }
    });

    this._ws.on("close", () => {
      this._connecting = false;
      this._authenticated = false;
      this._rejectAllPending(new Error("Resgate disconnected"));
      if (this._running) {
        this._emitConnectionChange({ type: "disconnected" });
        this._scheduleReconnect();
      }
    });

    this._ws.on("error", () => {
      this._connecting = false;
    });
  }

  async _handshake() {
    await this._request("version", { protocol: PROTOCOL });
    await this._request("auth.usertoken.login", { token: this._settings.getToken() });
    this._authenticated = true;

    const clientUuid = this._settings.getClientUuid();
    const result = await this._request(`subscribe.availability.client.${clientUuid}`);
    this._ingestModels(result?.models || {});

    this._connecting = false;
    this._backoff = BASE_BACKOFF;
    this._emitConnectionChange({ type: "connected" });
    this._emitUpdate();
  }

  _request(method, params) {
    return new Promise((resolve, reject) => {
      if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
        reject(new Error("Resgate not connected"));
        return;
      }

      const id = ++this._reqId;
      const payload = { id, method };
      if (params != null) payload.params = params;

      const timer = setTimeout(() => {
        if (this._pending.has(id)) {
          this._pending.delete(id);
          reject(new Error(`Resgate timeout: ${method}`));
        }
      }, REQUEST_TIMEOUT);

      this._pending.set(id, {
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });

      this._ws.send(JSON.stringify(payload));
    });
  }

  _handleMessage(msg) {
    if (msg.id != null && this._pending.has(msg.id)) {
      const pending = this._pending.get(msg.id);
      this._pending.delete(msg.id);

      if (msg.error) {
        const code = msg.error.code || "";
        const message = msg.error.message || code;
        if (code.includes("accessDenied") || code.includes("auth")) {
          pending.reject(new Error(`Auth error: ${message}`));
        } else {
          pending.reject(new Error(message));
        }
        return;
      }

      pending.resolve(msg.result);
      return;
    }

    // RES protocol events arrive as {"event":"<rid>.change","data":{...}} (no id, no `method`).
    if (typeof msg.event === "string") {
      this._handleEvent(msg);
    }
  }

  _handleEvent(msg) {
    if (!msg.event.endsWith(".change")) return;

    const rid = msg.event.slice(0, -".change".length);
    const uuid = this._uuidFromRid(rid);
    if (!uuid) return;

    const existing = this._models.get(uuid) || { user_uuid: uuid };
    const values = msg.data?.values || {};
    this._models.set(uuid, { ...existing, ...values, user_uuid: uuid });
    this._emitUpdate();
  }

  _ingestModels(models) {
    for (const [rid, model] of Object.entries(models)) {
      const uuid = model.user_uuid || this._uuidFromRid(rid);
      if (uuid) this._models.set(uuid, { ...model, user_uuid: uuid });
    }
  }

  _uuidFromRid(rid) {
    const match = rid.match(/\.user\.([^.]+)$/);
    return match ? match[1] : null;
  }

  _emitUpdate() {
    if (this._onUpdate) this._onUpdate();
  }

  _emitConnectionChange(state) {
    if (this._onConnectionChange) this._onConnectionChange(state);
  }

  _scheduleReconnect() {
    if (!this._running || this._reconnectTimer) return;
    this._closeSocket();

    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._backoff = Math.min(this._backoff * 2, MAX_BACKOFF);
      this._connect();
    }, this._backoff);
  }

  _clearReconnect() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  _closeSocket() {
    if (!this._ws) return;
    const socket = this._ws;
    this._ws = null;
    socket.removeAllListeners();
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
  }

  _rejectAllPending(err) {
    for (const [, pending] of this._pending) {
      pending.reject(err);
    }
    this._pending.clear();
  }
}

module.exports = ResgateClient;

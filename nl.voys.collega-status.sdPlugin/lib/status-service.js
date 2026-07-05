const ResgateClient = require("./resgate-client");
const StatusNormalizer = require("./status-normalizer");

const STALE_TIMEOUT = 60000;

class StatusService {
  constructor(settingsStore) {
    this._settings = settingsStore;
    this._normalizer = new StatusNormalizer();
    this._resgate = new ResgateClient(settingsStore);
    this._cache = new Map();
    this._authFailed = false;
    this._onStatusUpdate = null;
    this._running = false;
    this._ownUserUuid = null;

    this._resgate.setOnUpdate(() => this._handleModelUpdate());
    this._resgate.setOnConnectionChange((state) => this._handleConnectionChange(state));
  }

  setOnStatusUpdate(callback) {
    this._onStatusUpdate = callback;
  }

  setOwnUserUuid(uuid) {
    this._ownUserUuid = uuid || null;
  }

  getOwnUserUuid() {
    return this._ownUserUuid;
  }

  getRawModel(uuid) {
    return this._resgate.getModel(uuid);
  }

  _monitoredUuids() {
    const uuids = this._settings.getSelectedUuids();
    if (this._ownUserUuid && !uuids.includes(this._ownUserUuid)) {
      uuids.push(this._ownUserUuid);
    }
    return uuids;
  }

  start() {
    if (this._running) {
      this._resgate.forceReconnect();
      return;
    }
    this._running = true;
    this._authFailed = false;
    this._resgate.start();
  }

  stop() {
    this._running = false;
    this._resgate.stop();
  }

  forceRefresh() {
    if (!this._running) return;
    this._authFailed = false;
    this._resgate.forceReconnect();
  }

  invalidate() {
    this._cache.clear();
  }

  getCachedStatus(userUuid) {
    const cached = this._cache.get(userUuid);
    if (!cached) return StatusNormalizer.getUnknown();
    const age = Date.now() - cached.fetchedAt;
    return { ...cached.status, stale: age > STALE_TIMEOUT };
  }

  _handleModelUpdate() {
    if (this._authFailed) return;

    const selectedUuids = this._monitoredUuids();
    if (selectedUuids.length === 0) return;

    const normalized = this._normalizer.normalizeAll(
      (uuid) => this._resgate.getModel(uuid),
      selectedUuids
    );
    const now = Date.now();

    for (const [uuid, status] of normalized) {
      this._cache.set(uuid, { status, fetchedAt: now });
    }

    if (this._onStatusUpdate) {
      this._onStatusUpdate(normalized, null);
    }
  }

  _handleConnectionChange(state) {
    if (state.type === "config") {
      if (this._onStatusUpdate) this._onStatusUpdate(null, { type: "config" });
      return;
    }

    if (state.type === "error" && this._isAuthError(state.message)) {
      this._authFailed = true;
      if (this._onStatusUpdate) this._onStatusUpdate(null, { type: "auth_error" });
      return;
    }

    if (state.type === "disconnected") {
      this._markStale();
    }
  }

  _markStale() {
    const selectedUuids = this._monitoredUuids();
    if (selectedUuids.length === 0) return;

    const normalized = new Map();
    for (const uuid of selectedUuids) {
      const cached = this.getCachedStatus(uuid);
      normalized.set(uuid, { ...cached, stale: true });
    }

    if (this._onStatusUpdate) {
      this._onStatusUpdate(normalized, null);
    }
  }

  _isAuthError(message) {
    const msg = (message || "").toLowerCase();
    return msg.includes("auth") || msg.includes("access denied") || msg.includes("401") || msg.includes("403");
  }
}

module.exports = StatusService;

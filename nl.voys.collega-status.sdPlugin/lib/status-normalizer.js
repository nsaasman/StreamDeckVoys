const STATUS_MAP = {
  available: { state: 0, label: "Vrij", color: "#5cb85c" },
  available_for_colleagues: { state: 1, label: "Intern", color: "#007bff" },
  do_not_disturb: { state: 2, label: "Bezet", color: "#dc3545" },
  offline: { state: 3, label: "Offline", color: "#8e8e8e" },
  busy: { state: 2, label: "Bezet", color: "#dc3545" },
};

const UNKNOWN_STATUS = { state: 4, label: "\u2753", color: "#454d63" };
const AUTH_ERROR = { state: 5, label: "Auth", color: "#dc3545" };
const CONFIG = { state: 6, label: "Config", color: "#353c4d" };
const BUSY = { state: 2, label: "Bezet", color: "#dc3545" };

class StatusNormalizer {
  normalize(statusData) {
    if (!statusData) {
      return { ...UNKNOWN_STATUS, detail: "Geen data", extra: {} };
    }

    const context = this._extractContext(statusData);
    if (context.includes("in_call") || context.includes("ringing")) {
      return {
        ...BUSY,
        detail: context.includes("ringing") ? "ringing" : "in_call",
        extra: { context },
      };
    }

    let availability = (statusData.availability || statusData.user_status || statusData.status || "").toLowerCase();
    const callBehavior = statusData.call_behavior || "";
    const dnd = statusData.dnd === true || availability === "do_not_disturb";

    if (dnd || callBehavior === "REJECT") {
      return {
        ...STATUS_MAP.do_not_disturb,
        detail: dnd ? "Niet storen" : "Oproepen geweigerd",
        extra: { dnd, callBehavior, context },
      };
    }

    if (callBehavior === "ALLOW_INTERNAL") {
      availability = availability || "available_for_colleagues";
    }

    const mapped = STATUS_MAP[availability];
    if (mapped) {
      return {
        ...mapped,
        detail: availability,
        extra: { dnd, callBehavior, context },
      };
    }

    return { ...UNKNOWN_STATUS, detail: availability || "onbekend", extra: { dnd, callBehavior, context } };
  }

  _extractContext(statusData) {
    const ctx = statusData.context;
    if (!ctx) return [];
    if (Array.isArray(ctx)) return ctx.map(String);
    if (Array.isArray(ctx.data)) return ctx.data.map(String);
    return [];
  }

  normalizeAll(getModel, selectedUuids) {
    const result = new Map();
    const lookup = typeof getModel === "function" ? getModel : (uuid) =>
      (Array.isArray(getModel) ? getModel : []).find(
        (s) => s && (s.uuid === uuid || s.user_uuid === uuid || s.userUuid === uuid)
      );

    for (const uuid of selectedUuids) {
      result.set(uuid, this.normalize(lookup(uuid)));
    }

    return result;
  }

  static getAuthError() {
    return { ...AUTH_ERROR };
  }

  static getConfig() {
    return { ...CONFIG };
  }

  static getUnknown() {
    return { ...UNKNOWN_STATUS };
  }
}

module.exports = StatusNormalizer;

if (require.main === module) {
  const assert = (ok, msg) => { if (!ok) throw new Error(msg); };
  const n = new StatusNormalizer();
  assert(n.normalize({ availability: "available", context: { data: ["in_call"] } }).label === "Bezet", "in_call");
  assert(n.normalize({ dnd: true }).state === 2, "dnd");
  assert(n.normalize(null).state === 4, "null");
  console.log("status-normalizer ok");
}

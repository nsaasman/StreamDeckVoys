const { generateStatusImage } = require("./lib/button-renderer");

const fs = require("fs");
const path = require("path");

const LOG_FILE = path.join(__dirname, "plugin.log");
const DEBUG = process.env.VOYS_DEBUG === "1";
// ponytail: geen rotatie, gewoon weggooien boven 5MB; rotatie toevoegen als iemand oude logs nodig heeft
try { if (fs.statSync(LOG_FILE).size > 5 * 1024 * 1024) fs.unlinkSync(LOG_FILE); } catch {}

function logError(msg) {
  try { fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`); } catch {}
}

function logDebug(msg) {
  if (DEBUG) logError(msg);
}

function isSensitiveKey(key) {
  const k = String(key).toLowerCase();
  return k.includes("token") || k === "password" || k === "authorization";
}

function sanitizeForLog(value) {
  if (value == null || typeof value !== "object") {
    if (typeof value === "string" && value.startsWith("data:image")) return "<image>";
    return value;
  }
  if (Array.isArray(value)) return value.map(sanitizeForLog);
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (isSensitiveKey(k)) {
      out[k] = v ? "<redacted>" : v;
    } else if (k === "image" && typeof v === "string" && v.startsWith("data:image")) {
      out[k] = "<image>";
    } else {
      out[k] = sanitizeForLog(v);
    }
  }
  return out;
}

process.on("uncaughtException", (err) => {
  logError(`FATAL: ${err.message}\n${err.stack}`);
  process.stderr.write(`FATAL: ${err.message}\n`);
});

const WebSocket = require("ws");
const SettingsStore = require("./lib/settings-store");
const VoysApiClient = require("./lib/voys-api-client");
const ClickToDialClient = require("./lib/click-to-dial-client");
const StatusService = require("./lib/status-service");
const StatusNormalizer = require("./lib/status-normalizer");
const {
  nextStatus,
  statusDisplay,
  buildDestinationOptions,
  findDestinationIndex,
  destinationDisplay,
} = require("./lib/cycle-controls");

const ACTIONS = {
  COLLEAGUE: "nl.voys.collega-status.colleague-status",
  CYCLE_STATUS: "nl.voys.collega-status.cycle-status",
  CYCLE_DESTINATION: "nl.voys.collega-status.cycle-destination",
};

const launchArgs = parseLaunchArgs(process.argv.slice(2));
const IN_PORT = parseInt(launchArgs.port || process.env.STREAMDECK_PORT, 10) || -1;
const IN_PLUGIN_UUID = launchArgs.pluginUUID || process.env.STREAMDECK_PLUGIN_UUID || "";
const IN_REGISTER_EVENT = launchArgs.registerEvent || process.env.STREAMDECK_REGISTER_EVENT || "";

function parseLaunchArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-port" || arg === "--port") parsed.port = args[++i];
    else if (arg === "-pluginUUID" || arg === "--pluginUUID") parsed.pluginUUID = args[++i];
    else if (arg === "-registerEvent" || arg === "--registerEvent") parsed.registerEvent = args[++i];
    else if (arg === "-info" || arg === "--info") parsed.info = args[++i];
  }

  // Backward-compatible fallback for positional launches.
  if (!parsed.pluginUUID && args[0] && !args[0].startsWith("-")) parsed.pluginUUID = args[0];
  if (!parsed.port && args[1] && !args[1].startsWith("-")) parsed.port = args[1];
  if (!parsed.registerEvent && args[2] && !args[2].startsWith("-")) parsed.registerEvent = args[2];

  return parsed;
}

const settingsStore = new SettingsStore();
const apiClient = new VoysApiClient(settingsStore);
const clickToDialClient = new ClickToDialClient(settingsStore);
const statusService = new StatusService(settingsStore);

let ws = null;
let ownUserPromise = null;
const callDebounce = new Map();
const flashTimers = new Map();
const unresolvedInternalNumbers = new Set();
const CALL_DEBOUNCE_MS = 2000;
const CALL_FEEDBACK_MS = 1500;

function connect() {
  const port = IN_PORT > 0 ? IN_PORT : -1;
  if (port < 0) {
    process.stderr.write("No valid Stream Deck port\n");
    process.exit(1);
  }

  ws = new WebSocket(`ws://127.0.0.1:${port}`);

  ws.on("open", () => {
    const event = IN_REGISTER_EVENT || "registerPlugin";
    ws.send(JSON.stringify({ event, uuid: IN_PLUGIN_UUID }));
    loadGlobalSettings();
  });

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      logDebug(`WS RECV: ${JSON.stringify(sanitizeForLog(msg))}`);
      handleMessage(msg);
    } catch (err) {
      logError(`JSON Parse Error: ${err.message}`);
    }
  });

  ws.on("close", () => {
    statusService.stop();
    process.exit(0);
  });

  ws.on("error", () => {});
}

function send(context, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    const message = typeof context === "string" ? { ...payload, context } : payload;
    if (context && context !== IN_PLUGIN_UUID) {
      const actionId = settingsStore.getAction(context, "_actionId");
      if (actionId) message.action = actionId;
    }
    logDebug(`WS SEND: ${JSON.stringify(sanitizeForLog(message))}`);
    ws.send(JSON.stringify(message));
  }
}

function loadGlobalSettings() {
  send(IN_PLUGIN_UUID, { event: "getGlobalSettings" });
}

function saveGlobalSettings() {
  send(IN_PLUGIN_UUID, { event: "setGlobalSettings", payload: settingsStore.getAllGlobal() });
}

function saveActionSettings(context) {
  const settings = settingsStore.getAction(context);
  send(context, { event: "setSettings", payload: settings });
}

function handleMessage(msg) {
  const event = msg.event;
  const context = msg.context;

  switch (event) {
    case "didReceiveGlobalSettings":
      handleGlobalSettings(msg.payload?.settings || {});
      break;

    case "didReceiveSettings":
      handleActionSettings(context, msg.payload?.settings || {});
      break;

    case "willAppear":
      handleWillAppear(context, msg.payload, msg.action);
      break;

    case "willDisappear":
      handleWillDisappear(context);
      break;

    case "keyDown":
      handleKeyDown(context, msg.action);
      break;

    case "sendToPlugin":
      handlePropertyInspectorMessage(context, msg.payload || {});
      break;

    case "deviceDidConnect":
    case "deviceDidDisconnect":
    case "applicationDidLaunch":
    case "applicationDidTerminate":
      break;

    default:
      break;
  }
}

function handleGlobalSettings(settings) {
  settingsStore.replaceGlobal(settings);
  ownUserPromise = null;
  unresolvedInternalNumbers.clear();
  statusService.setOwnUserUuid(null);
  const wasRunning = statusService.isRunning();
  statusService.stop();
  statusService.invalidate();
  if (wasRunning || Object.keys(settings).length > 0) {
    statusService.start();
    if (settingsStore.getToken()) getOwnUser().catch(() => {});
  }
  refreshAllCycleButtons();
}

function handleActionSettings(context, settings) {
  const actionId = settingsStore.getAction(context, "_actionId");
  settingsStore.setAction(context, settings);
  if (actionId) settingsStore.setAction(context, { _actionId: actionId });
}

function handleWillAppear(context, payload, actionFromMsg) {
  const actionId = actionFromMsg || payload?.action || ACTIONS.COLLEAGUE;
  const settings = payload?.settings || {};
  settingsStore.setAction(context, { ...settings, _actionId: actionId });

  if (actionId === ACTIONS.CYCLE_STATUS) {
    if (settingsStore.getToken()) getOwnUser().catch(() => {});
    statusService.start();
    refreshCycleStatusButton(context);
    return;
  }
  if (actionId === ACTIONS.CYCLE_DESTINATION) {
    refreshCycleDestinationButton(context);
    return;
  }

  if (!settingsStore.isConfigured(context)) {
    setButtonState(context, StatusNormalizer.getConfig());
  } else {
    const cached = statusService.getCachedStatus(settings.userUuid);
    setButtonState(context, cached);
  }

  if (settingsStore.getToken()) getOwnUser().catch(() => {});
  statusService.start();
}

function handleWillDisappear(context) {
  const flashTimer = flashTimers.get(context);
  if (flashTimer) {
    clearTimeout(flashTimer);
    flashTimers.delete(context);
  }
  callDebounce.delete(context);
  settingsStore.removeAction(context);
}

function handleKeyDown(context, actionFromMsg) {
  const actionId = actionFromMsg || settingsStore.getAction(context, "_actionId") || ACTIONS.COLLEAGUE;
  if (actionFromMsg) settingsStore.setAction(context, { _actionId: actionFromMsg });

  if (actionId === ACTIONS.CYCLE_STATUS) {
    cycleStatus(context);
    return;
  }
  if (actionId === ACTIONS.CYCLE_DESTINATION) {
    cycleDestination(context);
    return;
  }

  const settings = settingsStore.getAction(context);
  if (settings.userUuid) {
    callColleague(context);
  }
}

function handlePropertyInspectorMessage(context, payload) {
  logDebug(`PI Message: ${JSON.stringify(sanitizeForLog(payload))}`);
  const action = payload.action;

  if (payload.globalSettings) {
    settingsStore.setGlobal(payload.globalSettings);
  }

  switch (action) {
    case "savePerAction": {
      const actionData = {
        userUuid: payload.userUuid,
        displayName: payload.displayName,
        internalNumber: payload.internalNumber,
        showName: payload.showName,
        showStatus: payload.showStatus,
        showNumber: payload.showNumber,
      };
      settingsStore.setAction(context, actionData);
      if (actionData.internalNumber) unresolvedInternalNumbers.delete(actionData.userUuid);
      saveActionSettings(context);
      
      const cached = statusService.getCachedStatus(actionData.userUuid);
      setButtonState(context, cached);

      // Nieuwe collega meteen normaliseren uit de al binnengekomen resgate-modellen.
      statusService.recompute();
      break;
    }

    case "verifyToken": {
      apiClient
        .validateAuth()
        .then((result) => {
          send(context, { event: "sendToPropertyInspector", payload: { action: "tokenResult", ...result } });
        })
        .catch((err) => {
          send(context, {
            event: "sendToPropertyInspector",
            payload: { action: "tokenResult", valid: false, error: err.message },
          });
        });
      break;
    }

    case "fetchUsers": {
      const clientId = settingsStore.getClientId();
      if (!clientId) {
        send(context, {
          event: "sendToPropertyInspector",
          payload: { action: "usersResult", error: "client_id niet ingesteld. Detecteer eerst met 'Detecteer client_id' of vul handmatig in." },
        });
        return;
      }
      apiClient
        .getUsers(clientId)
        .then((users) => {
          const cleaned = users.map((u) => ({
            id: u.uuid || u.id,
            name: u.name || `${u.first_name || ""} ${u.last_name || ""}`.trim(),
            email_address: u.email_address,
            internal_number: pickInternalNumber(u),
          }));
          send(context, {
            event: "sendToPropertyInspector",
            payload: { action: "usersResult", users: cleaned },
          });
        })
        .catch((err) => {
          send(context, {
            event: "sendToPropertyInspector",
            payload: { action: "usersResult", error: err.message },
          });
        });
      break;
    }

    case "fetchUserDetails": {
      logDebug(`Starting fetchUserDetails...`);
      apiClient
        .getUserDetails()
        .then((details) => {
          logDebug(`fetchUserDetails success: ${JSON.stringify(details)}`);
          send(context, {
            event: "sendToPropertyInspector",
            payload: {
              action: "userDetailsResult",
              details: {
                clientId: details.client?.id,
                clientUuid: details.client?.uuid,
                userUuid: details.uuid,
                userName: `${details.first_name || ""} ${details.last_name || ""}`.trim(),
              },
            },
          });
        })
        .catch((err) => {
          logError(`fetchUserDetails error: ${err.message}\n${err.stack}`);
          send(context, {
            event: "sendToPropertyInspector",
            payload: { action: "userDetailsResult", error: err.message },
          });
        });
      break;
    }

    case "saveGlobalToken": {
      const newSettings = {
        api_token: payload.api_token,
        client_uuid: payload.client_uuid,
        client_id: payload.client_id,
        voys_base_url: payload.voys_base_url,
        resgate_url: payload.resgate_url,
        click_to_dial_base_url: payload.click_to_dial_base_url,
        user_email: payload.user_email,
      };
      settingsStore.replaceGlobal(newSettings);
      saveGlobalSettings();
      ownUserPromise = null;
      unresolvedInternalNumbers.clear();
      statusService.setOwnUserUuid(null);
      statusService.stop();
      statusService.invalidate();
      statusService.start();
      refreshAllCycleButtons();
      break;
    }

    default:
      break;
  }
}

function extractEmail(payload) {
  const obj = payload?.data || payload || {};
  for (const key of ["email_address", "email", "username", "login"]) {
    const value = obj[key];
    if (value && String(value).includes("@")) return String(value).trim();
  }
  return "";
}

function getOwnUser() {
  // Promise cachen, niet het resultaat: N knoppen bij opstart = 1 auth-context call.
  if (!ownUserPromise) {
    ownUserPromise = fetchOwnUser().catch((err) => {
      ownUserPromise = null;
      throw err;
    });
  }
  return ownUserPromise;
}

async function fetchOwnUser() {
  if (!settingsStore.getToken()) throw new Error("Geen API token");
  const ctx = await apiClient.getAuthContext();
  let email = extractEmail(ctx) || settingsStore.getClickToDialEmail();
  if (!email && ctx.uuid) {
    try {
      const details = await apiClient.getPersonalDetails(ctx.uuid);
      email = extractEmail(details) || settingsStore.getClickToDialEmail();
    } catch (err) {
      logError(`getPersonalDetails for email failed: ${err.message}`);
    }
  }
  const user = {
    uuid: ctx.uuid,
    email,
    clientUuid: ctx.client_uuid || settingsStore.getClientUuid(),
    clientId: settingsStore.getClientId(),
  };
  statusService.setOwnUserUuid(user.uuid);
  return user;
}

function pickInternalNumber(user) {
  if (!user) return "";
  return String(
    user.internal_number || user.internalNumber || user.extension || user.extension_number || ""
  ).trim();
}

async function resolveColleagueInternalNumber(context, settings) {
  let num = String(settings.internalNumber || "").trim();
  if (num || !settings.userUuid) return num;
  if (unresolvedInternalNumbers.has(settings.userUuid)) return "";

  const clientId = settingsStore.getClientId();
  if (!clientId) return "";
  const users = await apiClient.getUsers(clientId);
  const colleague = users.find(
    (u) => String(u.id) === String(settings.userUuid) || String(u.uuid) === String(settings.userUuid)
  );
  num = pickInternalNumber(colleague);
  if (num) {
    settingsStore.setAction(context, { internalNumber: num });
    saveActionSettings(context);
  } else {
    unresolvedInternalNumbers.add(settings.userUuid);
  }
  return num;
}

async function callColleague(context) {
  const settings = settingsStore.getAction(context);
  let internalNumber = "";
  try {
    internalNumber = await resolveColleagueInternalNumber(context, settings);
  } catch (err) {
    logError(`resolveColleagueInternalNumber failed: ${err.message}`);
  }
  if (!internalNumber) {
    flashColleagueTitle(context, "Geen nr");
    return;
  }

  const now = Date.now();
  const lastCall = callDebounce.get(context) || 0;
  if (now - lastCall < CALL_DEBOUNCE_MS) return;
  callDebounce.set(context, now);

  if (!settingsStore.getToken()) {
    flashColleagueTitle(context, "Geen token");
    return;
  }

  flashColleagueTitle(context, "Bellen...");

  try {
    const user = await getOwnUser();
    if (!user.email) {
      throw new Error("Geen e-mail — vul in onder Verbinding");
    }
    await clickToDialClient.initiateCall(user.email, settingsStore.getToken(), internalNumber);
    logDebug(`Click-to-dial ok: ${internalNumber} callid pending`);
  } catch (err) {
    logError(`Click-to-dial failed: ${err.message}`);
    const short = err.message.length > 18 ? `${err.message.slice(0, 17)}…` : err.message;
    flashColleagueTitle(context, short || "Fout");
  }
}

function flashColleagueTitle(context, title) {
  const settings = settingsStore.getAction(context);
  const cached = settings.userUuid ? statusService.getCachedStatus(settings.userUuid) : null;
  const status = cached || StatusNormalizer.getUnknown();
  setButtonState(context, status, title);

  const prev = flashTimers.get(context);
  if (prev) clearTimeout(prev);
  const timer = setTimeout(() => {
    flashTimers.delete(context);
    const current = settingsStore.getAction(context);
    if (!current.userUuid) return;
    const restored = statusService.getCachedStatus(current.userUuid) || status;
    setButtonState(context, restored);
  }, CALL_FEEDBACK_MS);
  flashTimers.set(context, timer);
}

async function refreshAllCycleButtons() {
  for (const [context, settings] of settingsStore.getAllActions()) {
    if (settings._actionId === ACTIONS.CYCLE_STATUS) refreshCycleStatusButton(context);
    if (settings._actionId === ACTIONS.CYCLE_DESTINATION) refreshCycleDestinationButton(context);
  }
}

function errorStatus(err) {
  const msg = String(err?.message || "").toLowerCase();
  const isAuth = msg.includes("auth") || msg.includes("401") || msg.includes("403");
  return isAuth ? StatusNormalizer.getAuthError() : { ...StatusNormalizer.getUnknown(), label: "Fout" };
}

function showError(context, err) {
  const status = errorStatus(err);
  setButtonState(context, status, status.label);
}

async function refreshCycleStatusButton(context) {
  if (!settingsStore.getToken()) {
    setButtonState(context, StatusNormalizer.getConfig(), "Config");
    return;
  }
  try {
    const user = await getOwnUser();
    const data = await apiClient.getUserStatus(user.clientUuid, user.uuid);
    setButtonState(context, statusDisplay(data.status), statusDisplay(data.status).label);
  } catch (err) {
    showError(context, err);
  }
}

async function cycleStatus(context) {
  if (!settingsStore.getToken()) return;
  try {
    const user = await getOwnUser();
    const data = await apiClient.getUserStatus(user.clientUuid, user.uuid);
    const next = nextStatus(data.status);
    await apiClient.setUserStatus(user.clientUuid, user.uuid, next);
    setButtonState(context, statusDisplay(next), statusDisplay(next).label);
  } catch (err) {
    showError(context, err);
  }
}

async function refreshCycleDestinationButton(context) {
  if (!settingsStore.getToken()) {
    setButtonState(context, StatusNormalizer.getConfig(), "Config");
    return;
  }
  try {
    const user = await getOwnUser();
    const details = await apiClient.getPersonalDetails(user.uuid);
    const options = buildDestinationOptions(details);
    if (options.length === 0) {
      setButtonState(context, StatusNormalizer.getUnknown(), "Geen");
      return;
    }
    const idx = findDestinationIndex(options, details.selected_destination);
    const current = options[idx >= 0 ? idx : 0];
    setButtonState(context, destinationDisplay(current.label), current.label);
  } catch (err) {
    showError(context, err);
  }
}

async function cycleDestination(context) {
  if (!settingsStore.getToken()) return;
  try {
    const user = await getOwnUser();
    const details = await apiClient.getPersonalDetails(user.uuid);
    const options = buildDestinationOptions(details);
    if (options.length === 0) return;

    const idx = findDestinationIndex(options, details.selected_destination);
    const next = options[(idx + 1) % options.length];
    await apiClient.setSelectedDestination(user.clientId, user.uuid, next.patch);
    setButtonState(context, destinationDisplay(next.label), next.label);
  } catch (err) {
    showError(context, err);
  }
}

function dimColor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const dim = (c) => Math.floor(c * 0.45).toString(16).padStart(2, "0");
  return `#${dim((n >> 16) & 255)}${dim((n >> 8) & 255)}${dim(n & 255)}`;
}

function setButtonState(context, status, titleOverride) {
  if (!context) return;

  // Cycle-acties hebben maar 1 state in het manifest; setState zou daar out-of-range zijn.
  const actionId = settingsStore.getAction(context, "_actionId");
  if (actionId !== ACTIONS.CYCLE_STATUS && actionId !== ACTIONS.CYCLE_DESTINATION) {
    const state = status.state != null ? status.state : 4;
    send(context, { event: "setState", payload: { state } });
  }

  const title = titleOverride || buildTitle(status, context);
  send(context, { event: "setTitle", payload: { title, target: 0 } });

  try {
    const color = status.stale ? dimColor(status.color) : status.color;
    const imageData = generateStatusImage(color, title);
    if (imageData) {
      const base64 = imageData.toString("base64");
      send(context, {
        event: "setImage",
        payload: { image: `data:image/png;base64,${base64}`, target: 0 },
      });
    }
  } catch {
    // image generation failed, fall back to title only
  }
}

function buildTitle(status, context) {
  const actionSettings = settingsStore.getAction(context);
  const showName = actionSettings.showName !== false;
  const showStatus = actionSettings.showStatus !== false;
  const showNumber = actionSettings.showNumber === true;

  const parts = [];
  if (showName && actionSettings.displayName) {
    const name = actionSettings.displayName.split(" ")[0];
    parts.push(name);
  }
  if (showNumber && actionSettings.internalNumber) {
    parts.push(actionSettings.internalNumber);
  }
  if (showStatus) {
    parts.push(status.label);
  }
  return parts.length > 0 ? parts.join("\n") : status.label;
}

let lastOwnDestKey = null;
statusService.setOnStatusUpdate((normalized, error) => {
  if (error) {
    applyConnectionErrorStatus(
      error.type === "auth_error" ? StatusNormalizer.getAuthError() : StatusNormalizer.getConfig()
    );
    return;
  }

  if (!normalized) return;

  for (const [uuid, status] of normalized) {
    const contexts = settingsStore.getContextsForUuid(uuid);
    for (const ctx of contexts) {
      setButtonState(ctx, status);
    }
  }

  const ownUuid = statusService.getOwnUserUuid();
  if (!ownUuid) return;
  const ownModel = statusService.getRawModel(ownUuid);
  if (!ownModel) return;

  const ownDisplay = ownModel.user_status ? statusDisplay(ownModel.user_status) : null;

  // Resgate can't give us the destination *label* (App/Webphone/doorschakeling),
  // so re-fetch via REST — but only when the active destination actually changed.
  const destKey = ownModel.destination?.data?.portal_id ?? null;
  const destChanged = destKey != null && destKey !== lastOwnDestKey;
  if (destChanged) lastOwnDestKey = destKey;

  for (const [ctx, settings] of settingsStore.getAllActions()) {
    if (ownDisplay && settings._actionId === ACTIONS.CYCLE_STATUS) {
      setButtonState(ctx, ownDisplay, ownDisplay.label);
    }
    if (destChanged && settings._actionId === ACTIONS.CYCLE_DESTINATION) {
      refreshCycleDestinationButton(ctx);
    }
  }
});

function applyConnectionErrorStatus(status) {
  for (const [context, settings] of settingsStore.getAllActions()) {
    const actionId = settings._actionId || ACTIONS.COLLEAGUE;
    if (actionId === ACTIONS.CYCLE_STATUS || actionId === ACTIONS.CYCLE_DESTINATION) {
      setButtonState(context, status, status.label);
      continue;
    }
    if (!settings.userUuid) {
      setButtonState(context, status);
      continue;
    }
    setButtonState(context, statusService.getCachedStatus(settings.userUuid));
  }
}

connect();

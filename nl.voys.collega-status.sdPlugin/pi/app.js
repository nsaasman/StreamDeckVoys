let websocket = null;
let pluginUUID = null;
let actionContext = null;
let pluginAction = "nl.voys.collega-status.colleague-status";

const CYCLE_ACTIONS = new Set([
  "nl.voys.collega-status.cycle-status",
  "nl.voys.collega-status.cycle-destination",
]);

const els = {
  apiToken: document.getElementById("api-token"),
  toggleToken: document.getElementById("toggle-token"),
  voysBaseUrl: document.getElementById("voys-base-url"),
  resgateUrl: document.getElementById("resgate-url"),
  clickToDialUrl: document.getElementById("click-to-dial-url"),
  userEmail: document.getElementById("user-email"),
  clientUuid: document.getElementById("client-uuid"),
  clientId: document.getElementById("client-id"),
  pollingInterval: document.getElementById("polling-interval"),
  btnTestConnection: document.getElementById("btn-test-connection"),
  btnDetectClient: document.getElementById("btn-detect-client"),
  btnSaveGlobal: document.getElementById("btn-save-global"),
  connectionStatus: document.getElementById("connection-status"),
  colleagueSelect: document.getElementById("colleague-select"),
  btnLoadColleagues: document.getElementById("btn-load-colleagues"),
  showName: document.getElementById("show-name"),
  showStatus: document.getElementById("show-status"),
  showNumber: document.getElementById("show-number"),
  btnSaveAction: document.getElementById("btn-save-action"),
  actionStatus: document.getElementById("action-status"),
  colleagueInfo: document.getElementById("colleague-info"),
  cycleSection: document.getElementById("cycle-section"),
  actionSection: document.getElementById("action-section"),
  previewSection: document.getElementById("preview-section"),
};

let loadedUsers = [];

function connectElgatoStreamDeckSocket(inPort, inPluginUUID, inRegisterEvent, inInfo, inActionInfo) {
  pluginUUID = inPluginUUID;
  const parsed = extractActionInfo(inActionInfo) || extractActionInfo(inInfo) || {};
  actionContext = parsed.context;
  if (parsed.action) pluginAction = parsed.action;
  updatePiLayout();
  const wsUrl = "ws://127.0.0.1:" + inPort;

  websocket = new WebSocket(wsUrl);

  websocket.onopen = function () {
    websocket.send(JSON.stringify({ event: inRegisterEvent, uuid: inPluginUUID }));
    requestGlobalSettings();
    requestActionSettings();
  };

  websocket.onmessage = function (evt) {
    const msg = JSON.parse(evt.data);

    if (msg.event === "didReceiveGlobalSettings") {
      loadGlobalSettings(msg.payload?.settings || {});
    }

    if (msg.event === "didReceiveSettings") {
      actionContext = msg.context;
      loadActionSettings(msg.payload?.settings || {});
    }

    if (msg.event === "sendToPropertyInspector") {
      handlePluginMessage(msg.payload || {});
    }

    if (msg.event === "propertyInspectorDidAppear") {
      actionContext = msg.context;
      if (msg.action) pluginAction = msg.action;
      updatePiLayout();
      requestActionSettings();
    }
  };

  websocket.onclose = function () {
    websocket = null;
    showStatus(els.connectionStatus, false, "Fout: Verbinding met Stream Deck verbroken. Sluit dit venster en heropen via een verse knop.");
  };

  websocket.onerror = function (error) {
    showStatus(els.connectionStatus, false, "Netwerkfout met Stream Deck host.");
  };
}

function extractActionInfo(raw) {
  if (!raw) return null;
  try {
    const info = typeof raw === "string" ? JSON.parse(raw) : raw;
    const actionInfo = info.actionInfo || info;
    return {
      context: actionInfo.context || info.context || null,
      action: actionInfo.action || info.action || null,
    };
  } catch {
    return null;
  }
}

function updatePiLayout() {
  const isCycle = CYCLE_ACTIONS.has(pluginAction);
  els.cycleSection.hidden = !isCycle;
  els.actionSection.hidden = isCycle;
  els.previewSection.hidden = isCycle;
}

function send(payload) {
  if (websocket && websocket.readyState === WebSocket.OPEN) {
    websocket.send(JSON.stringify(payload));
  } else {
    showStatus(els.connectionStatus, false, "Fout: Geen actieve verbinding. Heb je de knop net verwijderd of ben je via een debugger verbonden?");
  }
}

function sendToPlugin(payload) {
  if (!pluginUUID) {
    showStatus(els.connectionStatus, false, "Geen Stream Deck context beschikbaar. Sluit en open de Property Inspector opnieuw.");
    return;
  }
  const msg = {
    action: pluginAction,
    event: "sendToPlugin",
    context: pluginUUID,
    payload: payload,
  };
  send(msg);
}

function requestGlobalSettings() {
  send({ event: "getGlobalSettings", context: pluginUUID });
}

function requestActionSettings() {
  if (!pluginUUID) return;
  send({ event: "getSettings", context: pluginUUID });
}

function loadGlobalSettings(settings) {
  if (settings.api_token) els.apiToken.value = settings.api_token;
  if (settings.voys_base_url) els.voysBaseUrl.value = settings.voys_base_url;
  if (settings.resgate_url) els.resgateUrl.value = settings.resgate_url;
  if (settings.click_to_dial_base_url) els.clickToDialUrl.value = settings.click_to_dial_base_url;
  if (settings.user_email) els.userEmail.value = settings.user_email;
  if (settings.client_uuid) els.clientUuid.value = settings.client_uuid;
  if (settings.client_id) els.clientId.value = settings.client_id;
  if (settings.polling_interval) els.pollingInterval.value = settings.polling_interval;
}

function loadActionSettings(settings) {
  if (settings.userUuid && loadedUsers.length > 0) {
    els.colleagueSelect.value = settings.userUuid;
    showColleagueInfo(settings.userUuid);
  }
  if (settings.showName !== undefined) els.showName.checked = settings.showName;
  if (settings.showStatus !== undefined) els.showStatus.checked = settings.showStatus;
  if (settings.showNumber !== undefined) els.showNumber.checked = settings.showNumber;
}

function handlePluginMessage(payload) {
  switch (payload.action) {
    case "tokenResult":
      showStatus(els.connectionStatus, payload.valid, payload.valid ? "Token geldig" : payload.error);
      if (payload.valid && payload.data) {
        setFieldValue(els.clientUuid, payload.data.client_uuid || "");
      }
      break;

    case "usersResult":
      if (payload.error) {
        showStatus(els.actionStatus, false, payload.error);
      } else {
        populateUsers(payload.users || []);
        showStatus(els.actionStatus, true, payload.users.length + " collega(s) geladen");
      }
      break;

    case "userDetailsResult":
      if (payload.error) {
        showStatus(els.connectionStatus, false, "client_id detectie: " + payload.error);
      } else if (payload.details) {
        if (payload.details.clientId) {
          els.clientId.value = payload.details.clientId;
        }
        if (payload.details.clientUuid) {
          els.clientUuid.value = payload.details.clientUuid;
        }
        showStatus(els.connectionStatus, true, "client_id gedetecteerd: " + payload.details.clientId);
      }
      break;

    default:
      break;
  }
}

function showStatus(el, success, message) {
  el.textContent = message;
  el.className = "status-msg " + (success ? "success" : "error");
}

function setFieldValue(field, value) {
  if (value) {
    field.value = value;
  }
}

function populateUsers(users) {
  loadedUsers = users;
  els.colleagueSelect.innerHTML = '<option value="">-- Kies een collega --</option>';

  users.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  for (const user of users) {
    const opt = document.createElement("option");
    opt.value = user.id;
    opt.textContent = user.name + (user.internal_number ? " (" + user.internal_number + ")" : "");
    els.colleagueSelect.appendChild(opt);
  }
}

function showColleagueInfo(userUuid) {
  const user = loadedUsers.find((u) => u.id === userUuid);
  if (user) {
    els.colleagueInfo.innerHTML =
      "<strong>" +
      (user.name || "Onbekend") +
      "</strong>" +
      (user.email_address ? "<br>" + user.email_address : "") +
      (user.internal_number ? "<br>Intern: " + user.internal_number : "");
    els.colleagueInfo.classList.add("visible");
  }
}

function collectGlobalSettings() {
  return {
    api_token: els.apiToken.value.trim(),
    auth_type: "Bearer",
    voys_base_url: els.voysBaseUrl.value.trim(),
    resgate_url: els.resgateUrl.value.trim(),
    click_to_dial_base_url: els.clickToDialUrl.value.trim(),
    user_email: els.userEmail.value.trim(),
    client_uuid: els.clientUuid.value.trim(),
    client_id: els.clientId.value.trim(),
    polling_interval: els.pollingInterval.value,
  };
}

// Event handlers
els.toggleToken.addEventListener("click", function () {
  els.apiToken.type = els.apiToken.type === "password" ? "text" : "password";
});

els.btnTestConnection.addEventListener("click", function () {
  try {
    showStatus(els.connectionStatus, true, "Testen...");
    sendToPlugin({ action: "verifyToken", globalSettings: collectGlobalSettings() });
  } catch (err) {
    showStatus(els.connectionStatus, false, "UI Fout: " + err.message);
  }
});

els.btnDetectClient.addEventListener("click", function () {
  try {
    showStatus(els.connectionStatus, true, "Detecteren...");
    sendToPlugin({ action: "fetchUserDetails", globalSettings: collectGlobalSettings() });
  } catch (err) {
    showStatus(els.connectionStatus, false, "UI Fout: " + err.message);
  }
});

els.btnSaveGlobal.addEventListener("click", function () {
  const settings = collectGlobalSettings();
  sendToPlugin({
    action: "saveGlobalToken",
    api_token: settings.api_token,
    auth_type: settings.auth_type,
    client_uuid: settings.client_uuid,
    client_id: settings.client_id,
    voys_base_url: settings.voys_base_url,
    resgate_url: settings.resgate_url,
    click_to_dial_base_url: settings.click_to_dial_base_url,
    user_email: settings.user_email,
    polling_interval: settings.polling_interval,
  });
  showStatus(els.connectionStatus, true, "Opgeslagen");
});

els.btnLoadColleagues.addEventListener("click", function () {
  showStatus(els.actionStatus, true, "Laden...");
  sendToPlugin({ action: "fetchUsers", globalSettings: collectGlobalSettings() });
});

els.colleagueSelect.addEventListener("change", function () {
  if (this.value) {
    showColleagueInfo(this.value);
  } else {
    els.colleagueInfo.classList.remove("visible");
  }
});

els.btnSaveAction.addEventListener("click", function () {
  const selectedUuid = els.colleagueSelect.value;
  if (!selectedUuid) {
    showStatus(els.actionStatus, false, "Selecteer eerst een collega");
    return;
  }

  const user = loadedUsers.find((u) => u.id === selectedUuid);
  sendToPlugin({
    action: "savePerAction",
    userUuid: selectedUuid,
    displayName: user ? user.name : "",
    internalNumber: user ? user.internal_number : "",
    showName: els.showName.checked,
    showStatus: els.showStatus.checked,
    showNumber: els.showNumber.checked,
  });
  showStatus(els.actionStatus, true, "Opgeslagen voor deze knop");
});

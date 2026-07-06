let websocket = null;
let pluginUUID = null;
let actionContext = null;
let pluginAction = "nl.voys.collega-status.colleague-status";
const MANIFEST_PLUGIN_UUID = "nl.voys.collega-status";

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
let savedUserUuid = null;

function connectElgatoStreamDeckSocket(inPort, inPluginUUID, inRegisterEvent, inInfo, inActionInfo) {
  pluginUUID = inPluginUUID;
  const parsed = extractActionInfo(inActionInfo) || extractActionInfo(inInfo) || {};
  // Een Property Inspector moet ZIJN EIGEN registratie-UUID (inPluginUUID) als context
  // gebruiken voor setSettings/getSettings/sendToPlugin. De context uit actionInfo is de
  // plugin-zijde context en wordt door de host niet geaccepteerd van de PI.
  actionContext = inPluginUUID;
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
      // actionContext blijft de PI-registratie-UUID (inPluginUUID); niet overschrijven.
      loadActionSettings(msg.payload?.settings || {});
    }

    if (msg.event === "sendToPropertyInspector") {
      handlePluginMessage(msg.payload || {});
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
    return true;
  }
  showStatus(els.connectionStatus, false, "Fout: Geen actieve verbinding. Herstart Stream Deck en open de instellingen opnieuw.");
  return false;
}

function globalSettingsContext() {
  return pluginUUID || MANIFEST_PLUGIN_UUID;
}

function saveGlobalSettingsToHost(settings) {
  return send({
    event: "setGlobalSettings",
    context: globalSettingsContext(),
    payload: settings,
  });
}

function saveActionSettingsToHost(settings) {
  if (!actionContext) return false;
  return send({
    event: "setSettings",
    context: actionContext,
    payload: settings,
  });
}

function sendToPlugin(payload) {
  if (!actionContext) {
    showStatus(els.connectionStatus, false, "Geen knop-context beschikbaar. Sluit en open de Property Inspector opnieuw.");
    return;
  }
  const msg = {
    action: pluginAction,
    event: "sendToPlugin",
    context: actionContext,
    payload: payload,
  };
  send(msg);
}

function requestGlobalSettings() {
  send({ event: "getGlobalSettings", context: globalSettingsContext() });
}

function requestActionSettings() {
  if (!actionContext) return;
  send({ event: "getSettings", context: actionContext });
}

function loadGlobalSettings(settings) {
  if (settings.api_token) els.apiToken.value = settings.api_token;
  if (settings.voys_base_url) els.voysBaseUrl.value = settings.voys_base_url;
  if (settings.resgate_url) els.resgateUrl.value = settings.resgate_url;
  if (settings.click_to_dial_base_url) els.clickToDialUrl.value = settings.click_to_dial_base_url;
  if (settings.user_email) els.userEmail.value = settings.user_email;
  if (settings.client_uuid) els.clientUuid.value = settings.client_uuid;
  if (settings.client_id) els.clientId.value = settings.client_id;
}

function loadActionSettings(settings) {
  // Bewaar de keuze; de gebruikerslijst is meestal nog niet geladen als dit binnenkomt.
  savedUserUuid = settings.userUuid || savedUserUuid;
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
        const data = payload.data.data || payload.data;
        setFieldValue(els.clientUuid, data.client_uuid || "");
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
        showStatus(els.connectionStatus, false, "Detectie: " + payload.error);
      } else if (payload.details) {
        if (payload.details.clientUuid) {
          els.clientUuid.value = payload.details.clientUuid;
        }
        if (payload.details.clientId) {
          els.clientId.value = String(payload.details.clientId);
        }
        if (payload.details.clientId) {
          showStatus(els.connectionStatus, true, "Gedetecteerd — client_id: " + payload.details.clientId);
        } else {
          showStatus(els.connectionStatus, true, "Client UUID ingevuld; Client ID handmatig invullen.");
        }
      }
      break;

    case "globalSaveResult":
      showStatus(els.connectionStatus, !payload.error, payload.error || "Opgeslagen en plugin bijgewerkt");
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

  // Eerder opgeslagen collega terugzetten in de dropdown.
  if (savedUserUuid && users.some((u) => u.id === savedUserUuid)) {
    els.colleagueSelect.value = savedUserUuid;
    showColleagueInfo(savedUserUuid);
  }
}

function showColleagueInfo(userUuid) {
  const user = loadedUsers.find((u) => u.id === userUuid);
  els.colleagueInfo.replaceChildren();
  if (!user) {
    els.colleagueInfo.classList.remove("visible");
    return;
  }
  const name = document.createElement("strong");
  name.textContent = user.name || "Onbekend";
  els.colleagueInfo.appendChild(name);
  if (user.email_address) {
    els.colleagueInfo.appendChild(document.createElement("br"));
    els.colleagueInfo.appendChild(document.createTextNode(user.email_address));
  }
  if (user.internal_number) {
    els.colleagueInfo.appendChild(document.createElement("br"));
    els.colleagueInfo.appendChild(document.createTextNode("Intern: " + user.internal_number));
  }
  els.colleagueInfo.classList.add("visible");
}

function collectGlobalSettings() {
  return {
    api_token: els.apiToken.value.trim(),
    voys_base_url: els.voysBaseUrl.value.trim(),
    resgate_url: els.resgateUrl.value.trim(),
    click_to_dial_base_url: els.clickToDialUrl.value.trim(),
    user_email: els.userEmail.value.trim(),
    client_uuid: els.clientUuid.value.trim(),
    client_id: els.clientId.value.trim(),
  };
}

// Directe API-aanroepen vanuit de Property Inspector. Zo hangen test/detect/laden
// niet af van de PI->plugin->host round-trip, die onbetrouwbaar bleek.
const DEFAULT_VOYS_BASE = "https://api.voys.nl/api/v2";

function voysBase() {
  return els.voysBaseUrl.value.trim() || DEFAULT_VOYS_BASE;
}

async function voysGet(pathPart) {
  const token = els.apiToken.value.trim();
  if (!token) throw new Error("Vul eerst je API-token in.");
  return fetch(voysBase() + pathPart, {
    headers: { Authorization: "Bearer " + token, Accept: "application/json" },
  });
}

function unwrap(body) {
  return body && body.data !== undefined ? body.data : body;
}

function pickInternalNumber(user) {
  if (!user) return "";
  return String(
    user.internal_number || user.internalNumber || user.extension || user.extension_number || ""
  ).trim();
}

// Event handlers
els.toggleToken.addEventListener("click", function () {
  els.apiToken.type = els.apiToken.type === "password" ? "text" : "password";
});

els.btnTestConnection.addEventListener("click", async function () {
  showStatus(els.connectionStatus, true, "Testen...");
  try {
    const res = await voysGet("/users/auth-context");
    if (res.status === 401) return showStatus(els.connectionStatus, false, "Ongeldig token.");
    if (res.status === 403) return showStatus(els.connectionStatus, false, "Geen toegang (403).");
    if (!res.ok) return showStatus(els.connectionStatus, false, "HTTP " + res.status);
    const data = unwrap(await res.json());
    if (data.client_uuid) setFieldValue(els.clientUuid, data.client_uuid);
    const naam = [data.first_name, data.last_name].filter(Boolean).join(" ");
    showStatus(els.connectionStatus, true, "Token geldig" + (naam ? " — " + naam : ""));
  } catch (err) {
    showStatus(els.connectionStatus, false, "Netwerkfout: " + err.message);
  }
});

els.btnDetectClient.addEventListener("click", async function () {
  showStatus(els.connectionStatus, true, "Detecteren...");
  try {
    const ctxRes = await voysGet("/users/auth-context");
    if (!ctxRes.ok) return showStatus(els.connectionStatus, false, "Auth-context HTTP " + ctxRes.status);
    const ctx = unwrap(await ctxRes.json());
    const clientUuid = ctx.client_uuid;
    const userUuid = ctx.uuid;
    if (clientUuid) setFieldValue(els.clientUuid, clientUuid);

    let clientId = null;
    const clientRes = await voysGet("/clients/" + clientUuid);
    if (clientRes.ok) {
      clientId = unwrap(await clientRes.json()).id;
    } else if (clientRes.status === 403 && userUuid) {
      // /clients/{uuid} is 403 voor veel user-tokens; /user/{uuid}/details heeft client.id
      const detRes = await voysGet("/user/" + userUuid + "/details");
      if (detRes.ok) clientId = (unwrap(await detRes.json()).client || {}).id;
    }

    if (clientId) {
      els.clientId.value = String(clientId);
      showStatus(els.connectionStatus, true, "Gedetecteerd — client_id: " + clientId);
    } else {
      showStatus(els.connectionStatus, true, "Client UUID ingevuld; Client ID handmatig invullen.");
    }
  } catch (err) {
    showStatus(els.connectionStatus, false, "Netwerkfout: " + err.message);
  }
});

els.btnSaveGlobal.addEventListener("click", function () {
  const settings = collectGlobalSettings();
  if (!settings.api_token) {
    showStatus(els.connectionStatus, false, "Vul eerst een API-token in");
    return;
  }
  if (!saveGlobalSettingsToHost(settings)) return;
  showStatus(els.connectionStatus, true, "Opgeslagen...");
  sendToPlugin({
    action: "saveGlobalToken",
    api_token: settings.api_token,
    client_uuid: settings.client_uuid,
    client_id: settings.client_id,
    voys_base_url: settings.voys_base_url,
    resgate_url: settings.resgate_url,
    click_to_dial_base_url: settings.click_to_dial_base_url,
    user_email: settings.user_email,
  });
});

els.btnLoadColleagues.addEventListener("click", async function () {
  showStatus(els.actionStatus, true, "Laden...");
  const clientId = els.clientId.value.trim();
  if (!clientId) {
    return showStatus(els.actionStatus, false, "Vul/detecteer eerst het Client ID (bij Verbinding).");
  }
  try {
    const res = await voysGet("/clients/" + clientId + "/users");
    if (res.status === 401 || res.status === 403) return showStatus(els.actionStatus, false, "Geen toegang (HTTP " + res.status + ").");
    if (!res.ok) return showStatus(els.actionStatus, false, "Laden mislukt: HTTP " + res.status);
    const list = unwrap(await res.json());
    const users = (Array.isArray(list) ? list : []).map(function (u) {
      return {
        id: u.uuid || u.id,
        name: u.name || [u.first_name, u.last_name].filter(Boolean).join(" "),
        email_address: u.email_address,
        internal_number: pickInternalNumber(u),
      };
    });
    populateUsers(users);
    showStatus(els.actionStatus, true, users.length + " collega(s) geladen");
  } catch (err) {
    showStatus(els.actionStatus, false, "Netwerkfout: " + err.message);
  }
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
  const actionSettings = {
    userUuid: selectedUuid,
    displayName: user ? user.name : "",
    internalNumber: user ? user.internal_number : "",
    showName: els.showName.checked,
    showStatus: els.showStatus.checked,
    showNumber: els.showNumber.checked,
  };
  if (!saveActionSettingsToHost(actionSettings)) return;
  sendToPlugin({ action: "savePerAction", ...actionSettings });
  showStatus(els.actionStatus, true, "Opgeslagen voor deze knop");
});

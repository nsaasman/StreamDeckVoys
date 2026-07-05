class SettingsStore {
  constructor() {
    this._globalSettings = {};
    this._actionSettings = new Map();
  }

  getGlobal(key) {
    return this._globalSettings[key];
  }

  setGlobal(settings) {
    Object.assign(this._globalSettings, settings);
  }

  replaceGlobal(settings) {
    this._globalSettings = { ...settings };
  }

  clearGlobal() {
    this._globalSettings = {};
  }

  getAction(context, key) {
    const settings = this._actionSettings.get(context) || {};
    return key ? settings[key] : settings;
  }

  setAction(context, settings) {
    const existing = this._actionSettings.get(context) || {};
    this._actionSettings.set(context, { ...existing, ...settings });
  }

  removeAction(context) {
    this._actionSettings.delete(context);
  }

  getToken() {
    return this._globalSettings.api_token || "";
  }

  getAuthType() {
    return "Bearer";
  }

  getClientUuid() {
    return this._globalSettings.client_uuid || "";
  }

  getClientId() {
    return this._globalSettings.client_id || "";
  }

  getVoysBaseUrl() {
    return this._globalSettings.voys_base_url || "https://api.voys.nl/api/v2";
  }

  getResgateUrl() {
    return this._globalSettings.resgate_url || "wss://resgate.eu-production.holodeck.voys.nl";
  }

  getStatusBaseUrl() {
    return this._globalSettings.status_base_url || "https://api.eu-production.holodeck.voys.nl/user-status";
  }

  getClickToDialBaseUrl() {
    return this._globalSettings.click_to_dial_base_url || "https://api.voipgrid.nl/api/clicktodial";
  }

  getClickToDialEmail() {
    return this._globalSettings.user_email || this._globalSettings.click_to_dial_email || "";
  }

  getPollingInterval() {
    const interval = parseInt(this._globalSettings.polling_interval, 10);
    return isNaN(interval) || interval < 5 ? 15000 : interval * 1000;
  }

  getSelectedUuids() {
    const uuids = [];
    for (const [, settings] of this._actionSettings) {
      if (settings.userUuid) {
        uuids.push(settings.userUuid);
      }
    }
    return [...new Set(uuids)];
  }

  getContextsForUuid(userUuid) {
    const contexts = [];
    for (const [context, settings] of this._actionSettings) {
      if (settings.userUuid === userUuid) {
        contexts.push(context);
      }
    }
    return contexts;
  }

  isConfigured(context) {
    const settings = this.getAction(context);
    return !!(settings && settings.userUuid);
  }

  getAllGlobal() {
    return { ...this._globalSettings };
  }

  getAllActions() {
    return this._actionSettings;
  }
}

module.exports = SettingsStore;

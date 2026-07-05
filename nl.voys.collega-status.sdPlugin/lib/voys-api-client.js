const https = require("https");
const { URL } = require("url");

class VoysApiClient {
  constructor(settingsStore) {
    this._settings = settingsStore;
  }

  _request(url, options = {}) {
    const token = this._settings.getToken();
    const authType = this._settings.getAuthType();

    if (!token) {
      return Promise.reject(new Error("No API token configured"));
    }

    const parsed = new URL(url);
    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: options.method || "GET",
      headers: {
        Authorization: `${authType} ${token}`,
        Accept: "application/json",
        "User-Agent": "StreamDeckVoys/1.0",
        ...options.headers,
      },
      timeout: options.timeout || 15000,
    };

    const requestPromise = new Promise((resolve, reject) => {
      const req = https.request(reqOptions, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          let data;
          try {
            data = body ? JSON.parse(body) : null;
          } catch {
            data = null;
          }
          resolve({ status: res.statusCode, headers: res.headers, data, body });
        });
      });

      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Request timed out (socket inactivity)"));
      });

      req.on("error", (err) => reject(err));

      if (options.body) {
        req.write(JSON.stringify(options.body));
      }

      req.end();
    });

    const timeoutMs = options.timeout || 15000;
    let timer;
    const absoluteTimeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Request timed out (absolute)")), timeoutMs);
    });

    return Promise.race([requestPromise, absoluteTimeout]).finally(() => clearTimeout(timer));
  }

  async validateAuth() {
    const url = `${this._settings.getVoysBaseUrl()}/users/auth-context`;
    const response = await this._request(url);
    if (response.status === 401) {
      return { valid: false, error: "Ongeldig token of auth type", data: null };
    }
    if (response.status === 403) {
      return { valid: false, error: "Geen toegang (permission denied)", data: null };
    }
    if (response.status !== 200 || !response.data) {
      return { valid: false, error: `HTTP ${response.status}`, data: null };
    }
    return { valid: true, error: null, data: response.data };
  }

  async getUserDetails() {
    const authCtx = await this._request(`${this._settings.getVoysBaseUrl()}/users/auth-context`);
    if (authCtx.status !== 200 || !authCtx.data) {
      throw new Error(`Auth context failed: HTTP ${authCtx.status}`);
    }
    
    const payload = authCtx.data.data || authCtx.data;
    const clientUuid = payload.client_uuid;
    if (!clientUuid) {
      throw new Error("No client_uuid found in auth-context");
    }

    const clientResp = await this._request(`${this._settings.getVoysBaseUrl()}/clients/${clientUuid}`);
    if (clientResp.status === 200 && clientResp.data) {
      const clientData = clientResp.data.data || clientResp.data;
      return {
        client: { id: clientData.id, uuid: clientUuid },
        uuid: payload.uuid,
        first_name: payload.first_name,
        last_name: payload.last_name
      };
    }

    if (clientResp.status === 403) {
      throw new Error("API token heeft onvoldoende rechten (403). Vul Client ID handmatig in.");
    }

    throw new Error(`Klantgegevens konden niet worden geladen (HTTP ${clientResp.status}). Vul Client ID handmatig in.`);
  }

  async getUsers(clientId) {
    const url = `${this._settings.getVoysBaseUrl()}/clients/${clientId}/users`;
    const response = await this._request(url);
    if (response.status === 401 || response.status === 403) {
      throw new Error("Auth error fetching users");
    }
    if (response.status !== 200 || !response.data) {
      throw new Error(`Failed to fetch users: HTTP ${response.status}`);
    }
    const users = response.data.data || response.data;
    return Array.isArray(users) ? users : [];
  }

  async getAuthContext() {
    const response = await this._request(`${this._settings.getVoysBaseUrl()}/users/auth-context`);
    if (response.status !== 200 || !response.data) {
      throw new Error(`Auth context failed: HTTP ${response.status}`);
    }
    return response.data.data || response.data;
  }

  async getUserStatus(clientUuid, userUuid) {
    const url = `${this._settings.getStatusBaseUrl()}/clients/${clientUuid}/users/${userUuid}/status`;
    const response = await this._request(url);
    if (response.status !== 200 || !response.data) {
      throw new Error(`Status ophalen mislukt: HTTP ${response.status}`);
    }
    return response.data;
  }

  async setUserStatus(clientUuid, userUuid, status) {
    const url = `${this._settings.getStatusBaseUrl()}/clients/${clientUuid}/users/${userUuid}/status`;
    const response = await this._request(url, {
      method: "POST",
      body: { status },
      headers: { "Content-Type": "application/json" },
    });
    if (response.status !== 200) {
      throw new Error(`Status wijzigen mislukt: HTTP ${response.status}`);
    }
    return response.data;
  }

  async getPersonalDetails(userUuid) {
    const url = `${this._settings.getVoysBaseUrl()}/user/${userUuid}/details`;
    const response = await this._request(url);
    if (response.status !== 200 || !response.data) {
      throw new Error(`Gebruikersdetails ophalen mislukt: HTTP ${response.status}`);
    }
    return response.data.data || response.data;
  }

  async setSelectedDestination(clientId, userUuid, selectedDestination) {
    const url = `${this._settings.getVoysBaseUrl()}/clients/${clientId}/users/${userUuid}`;
    const response = await this._request(url, {
      method: "PATCH",
      body: { selected_destination: selectedDestination },
      headers: { "Content-Type": "application/json" },
    });
    if (response.status !== 200 || !response.data) {
      throw new Error(`Bestemming wijzigen mislukt: HTTP ${response.status}`);
    }
    return response.data;
  }

}

module.exports = VoysApiClient;

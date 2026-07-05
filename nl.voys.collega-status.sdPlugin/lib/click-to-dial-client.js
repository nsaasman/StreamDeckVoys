const https = require("https");
const { URL } = require("url");

class ClickToDialClient {
  constructor(settingsStore) {
    this._settings = settingsStore;
  }

  _request(url, options = {}) {
    const parsed = new URL(url);
    const bodyStr = options.body ? JSON.stringify(options.body) : null;

    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: options.method || "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "StreamDeckVoys/1.0",
        ...options.headers,
      },
      timeout: options.timeout || 15000,
    };

    if (bodyStr) {
      reqOptions.headers["Content-Type"] = "application/json";
      reqOptions.headers["Content-Length"] = Buffer.byteLength(bodyStr);
    }

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
          resolve({ status: res.statusCode, data, body });
        });
      });

      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Request timed out"));
      });

      req.on("error", (err) => reject(err));

      if (bodyStr) req.write(bodyStr);
      req.end();
    });

    const timeoutMs = options.timeout || 15000;
    let timer;
    const absoluteTimeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Request timed out")), timeoutMs);
    });

    return Promise.race([requestPromise, absoluteTimeout]).finally(() => clearTimeout(timer));
  }

  buildAuthHeader(email, token) {
    return `Token ${email}:${token}`;
  }

  async initiateCall(email, token, bNumber, options = {}) {
    const trimmed = String(bNumber || "").trim();
    if (!trimmed) throw new Error("Geen b_number");
    if (!email || !token) throw new Error("Geen e-mail of token");

    const baseUrl = options.baseUrl || this._settings.getClickToDialBaseUrl();
    const url = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;

    const body = { b_number: trimmed };
    if (options.aNumber) body.a_number = String(options.aNumber);

    const response = await this._request(url, {
      method: "POST",
      body,
      headers: { Authorization: this.buildAuthHeader(email, token) },
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error("Click-to-Dial auth mislukt (controleer token en e-mail)");
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(formatApiError(response));
    }

    const payload = response.data?.data || response.data;
    const callid = payload?.callid || response.data?.callid;
    if (!callid) throw new Error(formatApiError(response, "Geen callid in response"));
    return { callid };
  }
}

function formatApiError(response, fallback) {
  const data = response.data;
  if (Array.isArray(data)) {
    return data.map((e) => (typeof e === "string" ? e : e.message || JSON.stringify(e))).join("; ");
  }
  const detail = data?.detail || data?.message || data?.error;
  if (detail) return typeof detail === "string" ? detail : JSON.stringify(detail);
  if (response.body) return response.body.slice(0, 200);
  return fallback || `HTTP ${response.status}`;
}

module.exports = ClickToDialClient;

if (require.main === module) {
  const assert = (ok, msg) => { if (!ok) throw new Error(msg); };
  const store = { getClickToDialBaseUrl: () => "https://api.voipgrid.nl/api/clicktodial" };
  const client = new ClickToDialClient(store);
  assert(
    client.buildAuthHeader("user@example.com", "abc123") === "Token user@example.com:abc123",
    "auth header format"
  );
  client.initiateCall("", "tok", "201").catch((err) => {
    assert(err.message === "Geen e-mail of token", "empty email rejected");
    console.log("click-to-dial-client ok");
  });
}

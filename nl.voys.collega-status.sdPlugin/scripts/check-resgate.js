const ResgateClient = require("../lib/resgate-client");

class TestSettings {
  constructor({ token, clientUuid, resgateUrl }) {
    this._token = token;
    this._clientUuid = clientUuid;
    this._resgateUrl = resgateUrl;
  }

  getToken() {
    return this._token;
  }

  getClientUuid() {
    return this._clientUuid;
  }

  getResgateUrl() {
    return this._resgateUrl;
  }

  getSelectedUuids() {
    return [];
  }
}

const token = process.env.VOYS_API_TOKEN || process.argv[2];
const clientUuid = process.env.VOYS_CLIENT_UUID || process.argv[3];
const resgateUrl = process.env.VOYS_RESGATE_URL || process.argv[4] || "wss://resgate.eu-production.holodeck.voys.nl";

if (!token || !clientUuid) {
  console.error("Usage: node scripts/check-resgate.js <api_token> <client_uuid> [resgate_url]");
  process.exit(1);
}

const settings = new TestSettings({ token, clientUuid, resgateUrl });
const client = new ResgateClient(settings);
let modelCount = 0;
let failed = false;

client.setOnUpdate(() => {
  const models = client.getModels();
  modelCount = models.length;
  if (modelCount > 0) {
    const sample = models[0];
    console.log(`OK: ${modelCount} status model(s), sample=${sample.user_uuid}:${sample.availability}`);
    client.stop();
    process.exit(0);
  }
});

client.setOnConnectionChange((state) => {
  if (state.type === "error") {
    console.error(`FAIL: ${state.message}`);
    failed = true;
    client.stop();
    process.exit(1);
  }
});

client.start();

setTimeout(() => {
  if (!failed) {
    console.error(`FAIL: no status models within 15s (got ${modelCount})`);
    client.stop();
    process.exit(1);
  }
}, 15000);

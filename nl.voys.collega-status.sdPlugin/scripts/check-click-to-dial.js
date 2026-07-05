const SettingsStore = require("../lib/settings-store");
const VoysApiClient = require("../lib/voys-api-client");
const ClickToDialClient = require("../lib/click-to-dial-client");

const token = process.env.VOYS_API_TOKEN || process.argv[2];
const bNumber = process.env.VOYS_DIAL_NUMBER || process.argv[3] || "201";
const emailOverride = process.env.VOYS_EMAIL || process.argv[4] || "";

if (!token) {
  console.error("Usage: node scripts/check-click-to-dial.js <api_token> [internal_number] [email]");
  process.exit(1);
}

const store = new SettingsStore();
store.setGlobal({ api_token: token, user_email: emailOverride });
const api = new VoysApiClient(store);
const dial = new ClickToDialClient(store);

function extractEmail(payload) {
  const obj = payload?.data || payload || {};
  for (const key of ["email_address", "email", "username", "login"]) {
    const value = obj[key];
    if (value && String(value).includes("@")) return String(value).trim();
  }
  return "";
}

(async () => {
  const ctx = await api.getAuthContext();
  let email = extractEmail(ctx) || emailOverride;
  if (!email && ctx.uuid) {
    const details = await api.getPersonalDetails(ctx.uuid);
    email = extractEmail(details) || emailOverride;
  }
  if (!email) {
    console.error("FAIL: no email found — pass as 4th argument or set VOYS_EMAIL");
    process.exit(1);
  }
  console.log(`email=${email} b_number=${bNumber}`);
  const result = await dial.initiateCall(email, token, bNumber);
  console.log(`OK callid=${result.callid}`);
})().catch((err) => {
  console.error(`FAIL: ${err.message}`);
  process.exit(1);
});

// Self-check: verify ResgateClient parses live RES-protocol change frames.
// Guards the field-name bug where events (msg.event / msg.data.values) were
// mistaken for request fields (msg.method / msg.params.values).
// Run: node scripts/check-resgate-events.js
const assert = require("assert");
const ResgateClient = require("../lib/resgate-client");

const uuid = "4fec6721-4137-4c31-a57a-de8c648ee4cf";
const rid = `availability.client.testclient.user.${uuid}`;

const client = new ResgateClient({ getResgateUrl: () => "", getToken: () => "", getClientUuid: () => "" });

let updates = 0;
client.setOnUpdate(() => updates++);

// Exact frame shape observed from production Resgate.
client._handleMessage({
  event: `${rid}.change`,
  data: { values: { availability: "do_not_disturb", user_status: "do_not_disturb" } },
});

const model = client.getModel(uuid);
assert(model, "model should exist after change event");
assert.strictEqual(model.availability, "do_not_disturb", "availability must update from data.values");
assert.strictEqual(model.user_status, "do_not_disturb", "user_status must update from data.values");
assert.strictEqual(updates, 1, "onUpdate must fire once per change event");

// A second change merges (only changed fields present in values).
client._handleMessage({
  event: `${rid}.change`,
  data: { values: { availability: "available", user_status: "available" } },
});
assert.strictEqual(client.getModel(uuid).availability, "available", "merged update must apply");
assert.strictEqual(updates, 2, "onUpdate must fire again");

// Destination changes arrive the same way; portal_id is what the UI dedups on.
client._handleMessage({
  event: `${rid}.change`,
  data: { values: { destination: { data: { portal_id: 837159, type: "voip_account", internal_number: 206 } } } },
});
assert.strictEqual(
  client.getModel(uuid).destination?.data?.portal_id,
  837159,
  "destination.data.portal_id must be readable after a change event"
);

console.log("OK: Resgate change events parsed and model updated");

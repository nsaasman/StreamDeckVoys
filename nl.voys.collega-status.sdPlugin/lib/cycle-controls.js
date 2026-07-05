const STATUS_CYCLE = ["available", "available_for_colleagues", "do_not_disturb", "offline"];

const STATUS_DISPLAY = {
  available: { label: "Vrij", color: "#5cb85c", state: 0 },
  available_for_colleagues: { label: "Intern", color: "#007bff", state: 1 },
  do_not_disturb: { label: "Bezet", color: "#dc3545", state: 2 },
  offline: { label: "Offline", color: "#8e8e8e", state: 3 },
};

const DEST_COLORS = { App: "#007bff", Webphone: "#5cb85c" };
const DEST_DEFAULT_COLOR = "#f0ad4e";

function nextStatus(current) {
  const idx = STATUS_CYCLE.indexOf(current);
  return STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
}

function statusDisplay(status) {
  return STATUS_DISPLAY[status] || { label: "?", color: "#454d63", state: 4 };
}

function buildDestinationOptions(details) {
  const options = [];
  const appId = details.app?.voip_account?.id;
  if (appId) {
    options.push({
      label: "App",
      patch: { voip_account: { id: String(appId) }, fixed_destination: null },
    });
  }
  const webId = details.webphone?.voip_account?.id;
  if (webId) {
    options.push({
      label: "Webphone",
      patch: { voip_account: { id: String(webId) }, fixed_destination: null },
    });
  }
  for (const fd of details.destinations?.fixed_destinations || []) {
    options.push({
      label: fd.description || "Doorschakelen",
      patch: { voip_account: null, fixed_destination: { id: String(fd.id) } },
    });
  }
  return options;
}

function findDestinationIndex(options, selected) {
  const voipId = selected?.voip_account?.id;
  const fixedId = selected?.fixed_destination?.id;
  return options.findIndex((opt) => {
    if (voipId != null && opt.patch.voip_account?.id === String(voipId)) return true;
    if (fixedId != null && opt.patch.fixed_destination?.id === String(fixedId)) return true;
    return false;
  });
}

function destinationDisplay(label) {
  const short = label.length > 10 ? label.substring(0, 9) + "…" : label;
  return {
    label: short,
    color: DEST_COLORS[label] || DEST_DEFAULT_COLOR,
    state: 0,
  };
}

module.exports = {
  STATUS_CYCLE,
  nextStatus,
  statusDisplay,
  buildDestinationOptions,
  findDestinationIndex,
  destinationDisplay,
};

if (require.main === module) {
  const assert = (ok, msg) => { if (!ok) throw new Error(msg); };
  assert(nextStatus("offline") === "available", "status wraps");
  assert(nextStatus("available") === "available_for_colleagues", "status advances");
  const opts = buildDestinationOptions({
    app: { voip_account: { id: "1" } },
    webphone: { voip_account: { id: "2" } },
    destinations: { fixed_destinations: [{ id: "3", description: "Mobiel" }] },
    selected_destination: { voip_account: { id: "2" }, fixed_destination: null },
  });
  assert(opts.length === 3, "three destinations");
  assert(findDestinationIndex(opts, { voip_account: { id: "2" } }) === 1, "finds webphone");
  console.log("cycle-controls ok");
}

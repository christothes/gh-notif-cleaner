const btn = document.getElementById("run");
const status = document.getElementById("status");

function setStatus(text, cls) {
  status.textContent = text;
  status.className = cls;
}

// Poll background for status while running
let pollTimer = null;
function startPolling() {
  stopPolling();
  pollTimer = setInterval(async () => {
    const s = await chrome.runtime.sendMessage({ type: "get-status" });
    if (s?.text) setStatus(s.text, s.cls);
    if (!s?.running && s?.cls === "done") {
      stopPolling();
      btn.disabled = false;
    }
    if (!s?.running && s?.cls === "error") {
      stopPolling();
      btn.disabled = false;
    }
  }, 500);
}
function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// On popup open, check if a job is already running
(async () => {
  const s = await chrome.runtime.sendMessage({ type: "get-status" });
  if (s?.running) {
    btn.disabled = true;
    setStatus(s.text, s.cls);
    startPolling();
  }
})();

btn.addEventListener("click", async () => {
  const skipClasses = [];
  if (document.getElementById("merged").checked) skipClasses.push("color-fg-done");
  if (document.getElementById("closed").checked) skipClasses.push("color-fg-closed");
  if (document.getElementById("draft").checked) skipClasses.push("color-fg-muted");

  if (skipClasses.length === 0) {
    setStatus("Select at least one type to clean.", "warning");
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.startsWith("https://github.com/notifications")) {
    setStatus("Navigate to a GitHub notifications page first.", "error");
    return;
  }

  btn.disabled = true;
  setStatus("Starting…", "running");

  const resp = await chrome.runtime.sendMessage({
    type: "start-clean",
    tabId: tab.id,
    skipClasses,
  });

  if (resp?.ok) {
    startPolling();
  } else {
    setStatus(resp?.error ?? "Failed to start.", "error");
    btn.disabled = false;
  }
});

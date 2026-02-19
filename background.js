// ── Background service worker ───────────────────────────────────────
// Survives popup closing and page navigations.

let running = false;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "start-clean") {
    if (running) {
      sendResponse({ ok: false, error: "Already running." });
      return;
    }
    running = true;
    runClean(msg.tabId, msg.skipClasses)
      .finally(() => { running = false; });
    sendResponse({ ok: true });
  }

  if (msg.type === "get-status") {
    sendResponse({ running, ...lastStatus });
  }
});

let lastStatus = { text: "", cls: "", totalDone: 0 };

function setStatus(text, cls, totalDone) {
  lastStatus = { text, cls, totalDone: totalDone ?? lastStatus.totalDone };
}

// ── Main orchestration loop ─────────────────────────────────────────
async function runClean(tabId, skipClasses) {
  const MAX_PAGES = 500;
  let totalDone = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    setStatus(`Page ${page}: scanning…`, "running", totalDone);

    // Clean the current page (single pass)
    let pageResult;
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        args: [skipClasses, totalDone, page],
        func: cleanCurrentPage,
      });
      pageResult = results?.[0]?.result;
    } catch (err) {
      setStatus(`Error on page ${page}: ${err.message}`, "error", totalDone);
      return;
    }

    totalDone = pageResult?.totalDone ?? totalDone;
    const nextUrl = pageResult?.nextUrl;

    if (!nextUrl) {
      // No more pages — we're done
      if (totalDone === 0) {
        setStatus("✅ Nothing to clean — all notifications are open/green.", "done", 0);
      } else {
        setStatus(`✅ Done! Marked ${totalDone} notification(s) as Done across ${page} page(s).`, "done", totalDone);
      }
      return;
    }

    setStatus(`Page ${page}: cleaned (${totalDone} total so far). Navigating…`, "running", totalDone);

    // Navigate to the next page URL directly (immune to DOM changes from Done)
    try {
      await chrome.tabs.update(tabId, { url: nextUrl });
    } catch {
      setStatus(`✅ Done! Marked ${totalDone} notification(s) as Done across ${page} page(s).`, "done", totalDone);
      return;
    }

    // Wait for the new page to load
    await waitForPageLoad(tabId, nextUrl);
  }

  setStatus(`✅ Done! Marked ${totalDone} notification(s) as Done (stopped after ${MAX_PAGES} pages).`, "done", totalDone);
}

// ── Wait for navigation to complete ─────────────────────────────────
async function waitForPageLoad(tabId, expectedUrl) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    await sleep(400);
    try {
      const check = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => ({
          url: location.href,
          hasItems: !!document.querySelector(".notifications-list-item"),
          ready: document.readyState === "complete",
        }),
      });
      const r = check?.[0]?.result;
      if (r && r.hasItems && r.ready) {
        // If we know the expected URL, verify we've arrived
        if (!expectedUrl || r.url.includes(new URL(expectedUrl).search)) {
          await sleep(500);
          return;
        }
      }
    } catch {
      // tab mid-navigation
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Injected into the page ──────────────────────────────────────────
// Single-pass: use Select All, then uncheck green items, then click Done.
async function cleanCurrentPage(targetClasses, prevTotal = 0, pageNum = 1) {
  const ICON_SELECTORS = [
    "octicon-git-pull-request",
    "octicon-git-pull-request-closed",
    "octicon-git-pull-request-draft",
    "octicon-git-merge",
    "octicon-issue-opened",
    "octicon-issue-closed",
    "octicon-skip",
  ];

  const items = [...document.querySelectorAll(".notifications-list-item")];
  if (items.length === 0) {
    return { totalDone: prevTotal, nextUrl: null };
  }

  // Classify each item
  const greenIndices = [];
  const targetIndices = [];
  items.forEach((item, idx) => {
    const svgs = item.querySelectorAll("svg");
    let hasStatusIcon = false;
    let isTarget = false;
    svgs.forEach((svg) => {
      const cls = svg.getAttribute("class") || "";
      if (!ICON_SELECTORS.some((s) => cls.includes(s))) return;
      hasStatusIcon = true;
      if (targetClasses.some((tc) => cls.includes(tc))) isTarget = true;
    });
    if (!hasStatusIcon) isTarget = true;
    if (isTarget) {
      targetIndices.push(idx);
    } else {
      greenIndices.push(idx);
    }
  });

  let totalDone = prevTotal;

  // Capture the Next page URL BEFORE we modify the page
  const nav = document.querySelector(
    "nav.paginate-container, nav.js-notifications-list-paginator-buttons"
  );
  const nextLink = nav?.querySelector('a[aria-label="Next"]');
  const nextUrl = nextLink?.href || null;

  if (targetIndices.length === 0) {
    return { totalDone, nextUrl };
  }

  // Strategy: click Select All, then uncheck the green ones.
  // This is more reliable than individually checking off-screen items.
  const selectAllCb = document.querySelector(
    'input[type="checkbox"][data-check-all]'
  );

  const allCheckboxes = document.querySelectorAll(
    ".notifications-list-item input.js-notification-bulk-action-check-item"
  );

  if (selectAllCb && greenIndices.length > 0) {
    // Select All, then uncheck greens
    if (!selectAllCb.checked) {
      selectAllCb.click();
      await new Promise((r) => setTimeout(r, 300));
    }

    // Uncheck green items (they're the minority or equal)
    for (const idx of greenIndices) {
      const cb = allCheckboxes[idx];
      if (cb && cb.checked) {
        cb.click();
      }
    }
  } else {
    // No green items or no Select All — check targets directly
    for (const idx of targetIndices) {
      const cb = allCheckboxes[idx];
      if (cb && !cb.checked) {
        cb.click();
      }
    }
  }

  // Wait for the UI to register all checkbox changes
  await new Promise((r) => setTimeout(r, 500));

  // Verify at least one checkbox is actually checked
  const checkedCount = [...allCheckboxes].filter((cb) => cb.checked).length;
  if (checkedCount === 0) {
    return { totalDone, nextUrl };
  }

  // Scroll to top so the toolbar Done button is accessible
  window.scrollTo(0, 0);
  await new Promise((r) => setTimeout(r, 300));

  // Find visible toolbar Done button (retry up to 3s)
  let doneBtn = null;
  for (let attempt = 0; attempt < 15; attempt++) {
    await new Promise((r) => setTimeout(r, 200));
    doneBtn = [...document.querySelectorAll("button")].find((b) => {
      if (b.closest(".notifications-list-item")) return false;
      if (b.offsetParent === null) return false;
      const compText = b.querySelector('[data-component="text"]')?.textContent.trim();
      if (compText === "Done") return true;
      return b.textContent.trim() === "Done";
    });
    if (doneBtn) break;
  }

  if (!doneBtn) {
    // Couldn't find Done button — uncheck everything and bail
    if (selectAllCb && selectAllCb.checked) selectAllCb.click();
    return { totalDone, nextUrl };
  }

  const itemCountBefore = document.querySelectorAll(".notifications-list-item").length;

  doneBtn.click();

  // Wait for GitHub to actually remove the items (up to 8s)
  let confirmed = false;
  for (let wait = 0; wait < 16; wait++) {
    await new Promise((r) => setTimeout(r, 500));
    const now = document.querySelectorAll(".notifications-list-item").length;
    if (now < itemCountBefore) {
      confirmed = true;
      break;
    }
  }

  if (confirmed) {
    totalDone += checkedCount;
  }

  return { totalDone, nextUrl };
}

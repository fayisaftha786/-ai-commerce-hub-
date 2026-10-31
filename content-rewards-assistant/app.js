(function () {
  "use strict";
  const Core = window.ClipRewardCore;
  const STORAGE_KEY = "clipreward-studio-v1";
  const $ = (id) => document.getElementById(id);
  let state = { campaigns: [], timestamps: [], account: Core.normalizeAccount({}) };
  let toastTimer;
  const statusNames = { idea: "Found / idea", applied: "Applied · waiting", joined: "Joined", editing: "Editing", ready: "Ready to post", submitted: "Awaiting review", approved: "Approved", rejected: "Rejected" };

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[ch]);
  }
  function safeExternalUrl(value) {
    return Core.safeUrl(value);
  }
  function showToast(message) {
    const node = $("toast");
    node.textContent = message;
    node.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove("show"), 2600);
  }
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (_) {
      showToast("Could not save locally. Changes remain only in this open session; export a backup before closing.");
      return false;
    }
  }
  function snapshotState() {
    return {
      campaigns: state.campaigns.slice(),
      timestamps: state.timestamps.slice(),
      account: state.account
    };
  }
  function saveOrRestore(previous) {
    const persisted = save();
    if (!persisted) {
      state = previous;
      render();
    }
    return persisted;
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.campaigns) || !Array.isArray(parsed.timestamps)) throw new Error("bad storage shape");
      const campaignIds = new Set();
      const campaigns = parsed.campaigns.map((c) => Core.normalizeCampaign(c));
      campaigns.forEach((c) => {
        if (campaignIds.has(c.id)) throw new Error("duplicate campaign ID");
        campaignIds.add(c.id);
      });
      const timestampIds = new Set();
      const timestamps = parsed.timestamps.map((t) => Core.normalizeTimestamp(t));
      timestamps.forEach((t) => {
        if (timestampIds.has(t.id)) throw new Error("duplicate timestamp ID");
        timestampIds.add(t.id);
      });
      state = { campaigns, timestamps, account: Core.normalizeAccount(parsed.account || {}) };
    } catch (_) {
      state = { campaigns: [], timestamps: [], account: Core.normalizeAccount({}) };
      showToast("Local data was invalid and was not loaded. Import a known-good backup if available.");
    }
  }
  function dateLabel(value) {
    if (!value) return "";
    const date = new Date(value + "T00:00:00");
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
  function localDateTimeValue(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }
  function submissionDeadlineMarkup(campaign) {
    if (campaign.platform !== "Content Rewards" || !campaign.postedAt) return "";
    const deadline = new Date(campaign.postedAt).getTime() + 30 * 60 * 1000;
    const remaining = deadline - Date.now();
    if (["submitted", "approved", "rejected"].includes(campaign.status)) {
      const recordedAt = campaign.submittedAt
        ? "Link submission time recorded locally: " + new Date(campaign.submittedAt).toLocaleString() + "."
        : "This is an older local entry; its link-submission time was not recorded.";
      return '<div class="submission-deadline submitted-deadline"><strong>Local status:</strong> "' + escapeHtml(statusNames[campaign.status]) + '". ' + escapeHtml(recordedAt) + ' Content Rewards receipt and approval are not verified.</div>';
    }
    if (remaining <= 0) {
      return '<div class="submission-deadline overdue-deadline"><strong>30-minute submission window has expired.</strong> Check the official campaign page; this app cannot submit or extend the deadline.</div>';
    }
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    return '<div class="submission-deadline active-deadline" data-posted-at="' + escapeHtml(campaign.postedAt) + '"><strong>Submit clip now (before 30:00):</strong> <span class="deadline-countdown">' + minutes + ':' + String(seconds).padStart(2, "0") + '</span> left · deadline ' + escapeHtml(new Date(deadline).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })) + '</div>';
  }
  function refreshDeadlineCountdowns() {
    document.querySelectorAll("[data-posted-at]").forEach((node) => {
      const deadline = new Date(node.dataset.postedAt).getTime() + 30 * 60 * 1000;
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        node.classList.remove("active-deadline");
        node.classList.add("overdue-deadline");
        node.innerHTML = "<strong>30-minute window may have passed.</strong> Check the official campaign page; this app cannot submit or extend the deadline.";
      } else {
        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        const timer = node.querySelector(".deadline-countdown");
        if (timer) timer.textContent = minutes + ":" + String(seconds).padStart(2, "0");
      }
    });
  }
  function statusBadge(status) {
    return '<span class="status-pill status-' + escapeHtml(status) + '">' + escapeHtml(statusNames[status] || "Idea") + "</span>";
  }
  function filteredCampaigns() {
    const query = $("campaign-search").value.trim().toLocaleLowerCase();
    const filter = $("status-filter").value;
    return state.campaigns.filter((campaign) => {
      const matchStatus = filter === "all" || campaign.status === filter;
      const haystack = [campaign.name, campaign.platform, campaign.rules].join(" ").toLocaleLowerCase();
      return matchStatus && (!query || haystack.includes(query));
    }).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }
  function renderCampaigns() {
    const campaigns = filteredCampaigns();
    $("campaign-list").innerHTML = campaigns.map((campaign) => {
      const campaignUrl = safeExternalUrl(campaign.url);
      const deadline = campaign.deadline ? '<div class="campaign-deadline">Deadline: ' + escapeHtml(dateLabel(campaign.deadline)) + '</div>' : "";
      const payout = campaign.payoutTerms ? '<span class="mini-tag">' + escapeHtml(campaign.payoutTerms) + '</span>' : "";
      const budget = campaign.budgetTerms ? '<span class="mini-tag">' + escapeHtml(campaign.budgetTerms) + '</span>' : "";
      const legacySubmission = Core.hasLegacySubmissionTiming(campaign) ? '<span class="mini-tag">Legacy · submission time not recorded</span>' : "";
      const rules = campaign.rules ? '<p class="campaign-rules">' + escapeHtml(campaign.rules) + '</p>' : "";
      const campaignLink = campaignUrl ? '<a class="text-button" href="' + escapeHtml(campaignUrl) + '" target="_blank" rel="noopener noreferrer">View campaign ↗</a>' : "";
      const postLink = campaign.postUrl ? '<a class="text-button" href="' + escapeHtml(campaign.postUrl) + '" target="_blank" rel="noopener noreferrer">View post ↗</a>' : "";
      return '<article class="campaign-card" data-id="' + escapeHtml(campaign.id) + '">' +
        '<div class="campaign-card-top"><div><h3>' + escapeHtml(campaign.name) + '</h3><div class="campaign-meta"><span class="mini-tag">' + escapeHtml(campaign.platform) + '</span>' +
        (campaign.deadline && campaign.deadline < new Date().toISOString().slice(0, 10) && campaign.status !== "approved" ? '<span class="mini-tag" style="color:#ffaaaa">Deadline passed</span>' : "") +
        (campaign.postPlatform && campaign.postPlatform !== "Other" ? '<span class="mini-tag">Posted on ' + escapeHtml(campaign.postPlatform) + '</span>' : '') + legacySubmission + payout + budget +
        '</div></div>' + statusBadge(campaign.status) + '</div>' + rules + deadline + submissionDeadlineMarkup(campaign) +
        '<div class="campaign-actions">' + campaignLink + postLink +
        '<button class="text-button edit-campaign" type="button" data-id="' + escapeHtml(campaign.id) + '">Edit</button>' +
        '<button class="text-button danger-button delete-campaign" type="button" data-id="' + escapeHtml(campaign.id) + '">Delete</button></div></article>';
    }).join("");
    $("empty-state").hidden = state.campaigns.length > 0;
    if (state.campaigns.length > 0 && campaigns.length === 0) {
      $("campaign-list").innerHTML = '<div class="table-empty">No campaigns match this search or status.</div>';
    }
  }
  function renderStats() {
    const s = Core.stats(state.campaigns);
    $("metric-total").textContent = s.total;
    $("metric-progress").textContent = s.progress;
    $("metric-review").textContent = s.review;
    $("metric-approved").textContent = s.approved;
  }
  function renderDraftCampaignOptions() {
    const select = $("draft-campaign");
    const current = select.value;
    select.innerHTML = '<option value="">Select a campaign (optional)</option>' + state.campaigns
      .slice().sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => '<option value="' + escapeHtml(c.id) + '" data-rules="' + escapeHtml(c.rules || "") +
        '" data-deadline="' + escapeHtml(c.deadline || "") + '">' + escapeHtml(c.name) + '</option>').join("");
    if (state.campaigns.some((c) => c.id === current)) select.value = current;
  }
  function renderTimestamps() {
    $("timestamp-list").innerHTML = state.timestamps.slice().sort((a, b) => a.seconds - b.seconds).map((item) =>
      '<div class="timestamp-row"><span class="time-chip">' + escapeHtml(item.timestamp) + '</span><span class="timestamp-note">' + escapeHtml(item.note) + '</span><button type="button" class="remove-time" data-id="' + escapeHtml(item.id) + '" aria-label="Remove timestamp ' + escapeHtml(item.timestamp) + '">×</button></div>'
    ).join("");
  }
  function renderSubmissions() {
    const entries = state.campaigns.filter((c) => ["submitted", "approved", "rejected"].includes(c.status)).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    $("submission-table").innerHTML = entries.map((c) => {
      const post = safeExternalUrl(c.postUrl);
      return "<tr><td>" + escapeHtml(c.name) + '<br><span class="mini-tag">' + escapeHtml(c.platform) + "</span></td><td>" +
        (post ? '<a class="table-link" href="' + escapeHtml(post) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(post) + "</a>" : '<span class="muted">Not added</span>') +
        "</td><td>" + escapeHtml(c.submittedAt ? new Date(c.submittedAt).toLocaleString() : "Legacy / not recorded") + "</td><td>" + statusBadge(c.status) + '</td><td><button type="button" class="text-button edit-campaign" data-id="' + escapeHtml(c.id) + '">Update</button></td></tr>';
    }).join("");
    $("submission-empty").hidden = entries.length > 0;
  }
  function renderAccount() {
    const account = Core.normalizeAccount(state.account || {});
    state.account = account;
    $("account-display-name").value = account.displayName;
    document.querySelectorAll("[data-account-check]").forEach((input) => {
      input.checked = account.checklist[input.dataset.accountCheck] === true;
    });
    const checked = Core.ACCOUNT_CHECKS.filter((key) => account.checklist[key]).length;
    $("account-check-progress").textContent = checked + " / " + Core.ACCOUNT_CHECKS.length + " confirmed";
    $("account-progress-fill").style.width = Math.round(checked / Core.ACCOUNT_CHECKS.length * 100) + "%";
    $("social-account-list").innerHTML = account.socialAccounts.map((item) =>
      '<article class="social-account-row"><div class="social-account-avatar">' + escapeHtml(item.platform.slice(0, 1)) + '</div><div class="social-account-copy"><strong>' + escapeHtml(item.platform) + '</strong><span>' + escapeHtml(item.handle) + '</span><small class="' + (item.confirmedConnected ? "social-confirmed" : "social-unconfirmed") + '">' + (item.confirmedConnected ? "Marked connected by you" : "Needs check in Content Rewards") + '</small></div><div class="social-account-actions"><button class="text-button confirm-social" type="button" data-id="' + escapeHtml(item.id) + '" aria-label="Toggle account connection reminder">' + (item.confirmedConnected ? "Undo check" : "Mark connected") + '</button><button class="text-button danger-button remove-social" type="button" data-id="' + escapeHtml(item.id) + '" aria-label="Remove saved social account">Remove</button></div></article>'
    ).join("");
    if (account.socialAccounts.length === 0) {
      $("social-account-list").innerHTML = '<div class="social-empty">No social handles saved yet.</div>';
    }
  }
  function render() {
    renderAccount();
    renderStats();
    renderCampaigns();
    renderDraftCampaignOptions();
    renderTimestamps();
    renderSubmissions();
  }
  let campaignScoutResult = null;

  function renderCampaignScout(result) {
    campaignScoutResult = result;
    $("scout-result-title").textContent = result.title || "Campaign details found";
    const sourceLabel = result.analysisSource === "public-url" ? "Auto-fetched public page" :
      result.analysisSource === "third-party-feed" ? "Third-party lead data" : "Copied text";
    $("scout-confidence").textContent = sourceLabel + " · " + (result.coverageScore == null ? result.confidence : result.coverageScore + "% core-field coverage");
    $("scout-confidence").classList.toggle("scout-match", result.platformMatch === "match");
    $("scout-confidence").classList.toggle("scout-mismatch", result.platformMatch === "mismatch");
    $("scout-confidence").classList.toggle("scout-unknown", result.platformMatch === "unknown");
    $("scout-confidence").title = "Coverage is a count of six key fields detected in the copied text. It is not a confidence score for eligibility or approval. " + result.requirementLines.length + " rule lines were captured.";
    const provenance = result.analysisSource === "public-url"
      ? "This report was extracted automatically from the public Content Rewards campaign page stored in the latest scheduled snapshot. It can be up to six hours old; verify current rules, availability and eligibility on the official page."
      : result.analysisSource === "third-party-feed"
        ? "This report uses third-party feed metadata only; it is not a full public campaign-page analysis. Open the URL analyzer when the latest scheduled scan has fetched that page."
        : "Findings come only from the text you pasted. Unknown values stay unknown; verify current rules, availability and eligibility on the official page.";
    $("scout-source-note").textContent = (result.platformMatch === "match"
      ? result.requestedPlatform + " appears in the accepted platform names detected from the campaign page."
      : result.platformMatch === "mismatch"
        ? result.requestedPlatform + " is not listed as accepted or is explicitly excluded. Autofill is blocked for this platform."
        : result.platformMatch === "unknown"
          ? result.requestedPlatform + " is not stated in the analysed content; verify platform eligibility."
          : "Extraction quality only — not an eligibility, approval or payout guarantee.") + " " + provenance;
    const found = result.findings.map((item) =>
      '<article class="scout-found-card"><small>' + escapeHtml(item.label) + '</small><strong>' + escapeHtml(item.value) + '</strong></article>'
    ).join("");
    $("scout-found-grid").innerHTML = found || '<p class="muted small-text">No reliable fields were recognised. Paste more of the campaign brief.</p>';
    $("scout-requirements").innerHTML = result.requirementLines.length
      ? result.requirementLines.map((line) => "<li>" + escapeHtml(line) + "</li>").join("")
      : "<li>Not found in pasted text. Review the official brief.</li>";
    $("scout-missing").innerHTML = result.missing.length
      ? result.missing.map((line) => "<li>" + escapeHtml(line) + "</li>").join("")
      : "<li>No missing fields detected by this parser. Still verify the official campaign page.</li>";
    renderRewardsIntelligence(result);
    $("scout-autofill-button").disabled = (!result.title && !result.sourceUrl) || result.platformMatch === "mismatch";
    $("scout-results").hidden = false;
  }


  let discoveryState = window.ClipRewardDiscovery.readState();
  let discoverySettings = window.ClipRewardDiscovery.readSettings();
  let discoveryTimer = null;
  let discoveryBusy = false;
  let discoveryBackendStatus = null;
  let discoveryStaticStatus = null;
  let discoveryStaticScans = [];

  function renderDiscovery() {
    const campaigns = discoveryState.campaigns || [];
    const scans = discoveryState.scans || [];
    const latest = discoveryBackendStatus && discoveryBackendStatus.lastScan ||
      discoveryStaticStatus && discoveryStaticStatus.lastScan || scans[0];
    const backendConfigured = Boolean(discoverySettings.backendUrl);
    const scheduledSnapshot = Boolean(discoveryStaticStatus && discoveryStaticStatus.lastScan);
    $("discovery-total").textContent = campaigns.length;
    $("discovery-high").textContent = campaigns.filter((row) => row.opportunity && row.opportunity.tier === "high").length;
    $("discovery-new").textContent = latest ? latest.newCount : "—";
    $("discovery-last-scan").textContent = latest ? new Date(latest.completedAt || latest.at).toLocaleString() : "Not scanned yet";
    $("discovery-mode").textContent = backendConfigured
      ? discoveryBackendStatus
        ? discoveryBackendStatus.enabled ? "Server-side scheduler active · " + discoveryBackendStatus.intervalMinutes + " minute interval" : "Backend reachable · server scheduler disabled"
        : "Backend URL saved · checking connection"
      : scheduledSnapshot
        ? "GitHub Actions snapshot scheduled · approximately every 6 hours (UTC)"
        : discoverySettings.enabled ? "Browser fallback scan works only while this page is open" : "Browser fallback scan paused";
    $("discovery-toggle").textContent = backendConfigured ? "Server controls auto-scan" : scheduledSnapshot ? "GitHub Actions controls schedule" : discoverySettings.enabled ? "Pause browser fallback" : "Resume browser fallback";
    $("discovery-toggle").disabled = backendConfigured || scheduledSnapshot;
    $("discovery-interval").value = String(discoverySettings.intervalHours);
    $("discovery-interval").disabled = backendConfigured || scheduledSnapshot;
    $("discovery-backend-url").value = discoverySettings.backendUrl || "";
    $("discovery-scan-now").textContent = backendConfigured ? "↻ Sync latest findings" : "↻ Scan public feed now";
    const rows = campaigns.slice(0, 8);
    $("discovery-list").innerHTML = rows.length ? rows.map((row, index) => {
      const payout = (row.payouts || []).find((item) => item.platform === $("scout-target-platform").value) || (row.payouts || [])[0];
      const rate = payout && payout.ratePerKViews != null ? "$" + payout.ratePerKViews + " / 1K views" : "Rate unknown";
      const tier = row.opportunity ? row.opportunity.tier.toUpperCase() : "UNRATED";
      const freshness = row.opportunity ? row.opportunity.status.replace(/-/g, " ") : "unknown";
      return '<article class="discovery-card"><div class="discovery-card-head"><strong>' + escapeHtml(row.title) + '</strong><span class="discovery-tier discovery-tier-' + escapeHtml(tier.toLowerCase()) + '">' + escapeHtml(tier) + ' · ' + escapeHtml(row.opportunity ? row.opportunity.score : 0) + '/100</span></div><p>' + escapeHtml(row.brand || "Brand not stated") + ' · ' + escapeHtml((row.platforms || []).join(", ") || "Platform unknown") + '</p><div class="feed-metrics"><span>' + escapeHtml(rate) + '</span><span>' + escapeHtml(freshness) + '</span></div><small>' + escapeHtml(row.opportunity ? row.opportunity.explanation : "Verify source details.") + '</small><div class="feed-card-actions"><button class="button button-secondary" type="button" data-discovery-import="' + index + '">Analyse campaign</button>' + (row.officialUrl ? '<a class="text-button" href="' + escapeHtml(row.officialUrl) + '" target="_blank" rel="noopener noreferrer">Verify official page ↗</a>' : '') + '</div></article>';
    }).join("") : '<p class="muted small-text">No saved discoveries yet. The scheduled public snapshot will populate this list after its first successful scan; use Scan public feed now for an immediate browser check.</p>';
    $("discovery-list").querySelectorAll("[data-discovery-import]").forEach((button) => button.addEventListener("click", () => {
      campaignFeedRows = rows;
      importFeedCampaign(Number(button.dataset.discoveryImport));
    }));
    const history = discoveryBackendStatus && discoveryBackendStatus.lastScan
      ? [discoveryBackendStatus.lastScan]
      : discoveryStaticScans.length ? discoveryStaticScans : scans;
    $("discovery-history").textContent = history.length ? history.slice(0, 5).map((scan) =>
      new Date(scan.completedAt || scan.at).toLocaleString() + " · " + (scan.checkedCount || 0) + " checked · " + (scan.newCount || 0) + " new" + (scan.error || scan.status === "failed" ? " · failed" : "")
    ).join(" | ") : "No scan history yet.";
  }

  async function runDiscoveryScan(automatic) {
    if (discoverySettings.backendUrl) return syncDiscoveryBackend();
    if (discoveryBusy) return;
    discoveryBusy = true;
    $("discovery-scan-now").disabled = true;
    $("discovery-status").textContent = automatic ? "Automatic browser fallback scan running…" : "Scanning the public feed…";
    try {
      const result = await window.ClipRewardDiscovery.scan({
        feed: window.ClipRewardFeed,
        platform: $("scout-target-platform").value,
        search: $("campaign-feed-search").value
      });
      const merged = window.ClipRewardDiscovery.mergeHistory(discoveryState.campaigns, result.campaigns);
      const scan = { at: result.fetchedAt, checkedCount: merged.checkedCount, newCount: merged.newCount, source: result.sourceLabel, error: false };
      discoveryState = { campaigns: merged.campaigns, scans: [scan, ...(discoveryState.scans || [])].slice(0, 50) };
      if (!window.ClipRewardDiscovery.writeState(discoveryState)) throw new Error("Browser storage is full or unavailable; discoveries were not saved.");
      $("discovery-status").textContent = result.summary.found + " campaigns checked · " + merged.newCount + " new · " + result.summary.high + " high-information leads. Third-party data, not verified availability.";
      if (merged.newCount > 0 && discoverySettings.notify && "Notification" in window && Notification.permission === "granted") {
        new Notification("ClipReward · new campaign leads", { body: merged.newCount + " new lead(s) found. Open the app to review and verify them." });
      }
      renderDiscovery();
    } catch (error) {
      const message = error && error.message ? error.message : "Discovery scan failed.";
      discoveryState.scans = [{ at: new Date().toISOString(), checkedCount: 0, newCount: 0, source: "feed", error: true }, ...(discoveryState.scans || [])].slice(0, 50);
      window.ClipRewardDiscovery.writeState(discoveryState);
      $("discovery-status").textContent = message + " Use the official Discover page and paste its public brief if the feed is unavailable.";
      renderDiscovery();
    } finally {
      discoveryBusy = false;
      $("discovery-scan-now").disabled = false;
    }
  }

  async function syncScheduledSnapshot() {
    if (discoverySettings.backendUrl || discoveryBusy) return null;
    discoveryBusy = true;
    $("discovery-scan-now").disabled = true;
    $("discovery-status").textContent = "Loading the latest scheduled GitHub campaign snapshot…";
    try {
      const result = await window.ClipRewardDiscovery.fetchStaticSnapshot({ url: "./discovery-snapshot.json" });
      const lastScan = result.status.lastScan;
      if (!lastScan) {
        discoveryStaticStatus = null;
        discoveryStaticScans = [];
        $("discovery-status").textContent = "The GitHub Actions scheduled workflow has not completed its first scan yet.";
        renderDiscovery();
        return null;
      }
      discoveryStaticStatus = result.status;
      discoveryStaticScans = result.scans || [];
      const merged = window.ClipRewardDiscovery.mergeHistory(discoveryState.campaigns, result.campaigns);
      discoveryState = { campaigns: merged.campaigns, scans: discoveryState.scans || [] };
      if (!window.ClipRewardDiscovery.writeState(discoveryState)) throw new Error("Snapshot loaded, but the browser could not save its local cache.");
      const pageDetails = result.campaignDetails || [];
      const fetchedPages = pageDetails.filter((item) => item.status === "ok").length;
      const message = lastScan.status === "failed"
        ? "Latest scheduled scan failed: " + (lastScan.error || "source unavailable") + ". Previous campaign rows were preserved."
        : "GitHub Actions snapshot loaded · " + result.campaigns.length + " leads · " + fetchedPages + "/" + pageDetails.length + " public campaign pages auto-read · last scan " + new Date(lastScan.completedAt || lastScan.at).toLocaleString() + ".";
      $("discovery-status").textContent = message;
      $("discovery-backend-status").textContent = "GitHub Actions scheduled snapshot is active. No separate backend URL is needed for this public feed.";
      scheduleDiscovery();
      renderDiscovery();
      return result;
    } catch (error) {
      discoveryStaticStatus = null;
      discoveryStaticScans = [];
      $("discovery-status").textContent = (error && error.message ? error.message : "Scheduled snapshot could not be loaded.") + " Browser scan fallback is available while this page is open.";
      renderDiscovery();
      return null;
    } finally {
      discoveryBusy = false;
      $("discovery-scan-now").disabled = false;
    }
  }

  async function syncDiscoveryBackend() {
    if (!discoverySettings.backendUrl || discoveryBusy) return;
    discoveryBusy = true;
    $("discovery-scan-now").disabled = true;
    $("discovery-status").textContent = "Connecting to the server-side discovery worker…";
    try {
      const result = await window.ClipRewardDiscovery.fetchBackendSnapshot({
        backendUrl: discoverySettings.backendUrl,
        platform: $("scout-target-platform").value,
        search: $("campaign-feed-search").value
      });
      discoveryBackendStatus = result.status;
      const merged = window.ClipRewardDiscovery.mergeHistory(discoveryState.campaigns, result.campaigns);
      discoveryState = { campaigns: merged.campaigns, scans: discoveryState.scans || [] };
      if (!window.ClipRewardDiscovery.writeState(discoveryState)) throw new Error("Backend connected, but the browser could not save its local discovery cache.");
      const lastScan = result.status.lastScan;
      const backendMessage = result.status.lastError
        ? "Backend reachable; last scan reported an error: " + result.status.lastError
        : result.status.enabled
          ? "Server worker connected · " + result.campaigns.length + " matching saved leads · last server scan " + (lastScan ? new Date(lastScan.completedAt || lastScan.at).toLocaleString() : "not yet run")
          : "Backend reachable, but server scheduling is disabled. Configure DISCOVERY_SCHEDULER_ENABLED=true on the backend host.";
      $("discovery-status").textContent = backendMessage;
      $("discovery-backend-status").textContent = backendMessage;
      renderDiscovery();
    } catch (error) {
      discoveryBackendStatus = null;
      const backendError = (error && error.message ? error.message : "Backend connection failed.") + " Check the backend HTTPS URL and its CORS allowlist.";
      $("discovery-status").textContent = backendError;
      $("discovery-backend-status").textContent = backendError;
      renderDiscovery();
    } finally {
      discoveryBusy = false;
      $("discovery-scan-now").disabled = false;
    }
  }

  function scheduleDiscovery() {
    if (discoveryTimer) window.clearInterval(discoveryTimer);
    discoveryTimer = null;
    if (!discoverySettings.enabled || discoverySettings.backendUrl || discoveryStaticStatus) return;
    discoveryTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") runDiscoveryScan(true);
    }, discoverySettings.intervalHours * 60 * 60 * 1000);
  }

  function configureDiscovery() {
    discoverySettings = window.ClipRewardDiscovery.readSettings();
    $("discovery-toggle").addEventListener("click", () => {
      discoverySettings.enabled = !discoverySettings.enabled;
      window.ClipRewardDiscovery.writeSettings(discoverySettings);
      scheduleDiscovery();
      renderDiscovery();
    });
    $("discovery-interval").addEventListener("change", () => {
      discoverySettings.intervalHours = Number($("discovery-interval").value);
      window.ClipRewardDiscovery.writeSettings(discoverySettings);
      scheduleDiscovery();
      showToast("Browser fallback interval saved. It runs only while this page is open.");
    });
    $("discovery-save-backend").addEventListener("click", () => {
      const raw = $("discovery-backend-url").value.trim();
      const normalized = window.ClipRewardDiscovery.normalizeBackendUrl(raw);
      if (raw && !normalized) {
        showToast("Use an HTTPS backend origin. Only localhost may use HTTP.");
        return;
      }
      discoverySettings.backendUrl = normalized;
      window.ClipRewardDiscovery.writeSettings(discoverySettings);
      discoveryBackendStatus = null;
      scheduleDiscovery();
      renderDiscovery();
      if (normalized) syncDiscoveryBackend();
      else {
        $("discovery-backend-status").textContent = "Backend disconnected. The GitHub Actions snapshot remains available.";
        showToast("Backend URL cleared.");
      }
    });
    $("discovery-scan-now").addEventListener("click", () => runDiscoveryScan(false));
    $("discovery-notify").addEventListener("click", async () => {
      if (!("Notification" in window)) { showToast("Browser notifications are not supported here."); return; }
      const permission = await Notification.requestPermission();
      discoverySettings.notify = permission === "granted";
      window.ClipRewardDiscovery.writeSettings(discoverySettings);
      showToast(discoverySettings.notify ? "New-discovery notifications enabled." : "Notification permission was not granted.");
    });
    renderDiscovery();
    if (discoverySettings.backendUrl) {
      $("discovery-backend-status").textContent = "Backend URL saved. Connecting…";
      scheduleDiscovery();
      syncDiscoveryBackend();
    } else {
      syncScheduledSnapshot().then((snapshot) => {
        if (!snapshot && discoverySettings.enabled && !discoverySettings.backendUrl) {
          scheduleDiscovery();
          const latest = discoveryState.scans[0];
          if (!latest || Date.now() - Date.parse(latest.at) > 30 * 60 * 1000) runDiscoveryScan(true);
        }
      });
    }
  }

  let campaignFeedRows = [];

  function renderCampaignFeed(result) {
    campaignFeedRows = result.campaigns;
    $("campaign-feed-status").textContent = result.campaigns.length
      ? result.campaigns.length + " matching leads · " + result.totalReceived + " records received · fetched " + new Date(result.fetchedAt).toLocaleString()
      : "No matching leads in the returned snapshot. Try another platform or search.";
    $("campaign-feed-list").innerHTML = result.campaigns.map((campaign, index) => {
      const payout = campaign.payouts.find((item) => item.platform === $("scout-target-platform").value);
      const freshness = campaign.freshness === "stale" ? "Snapshot may be stale (" + campaign.ageDays + " days old)" :
        campaign.freshness === "recent" ? "Snapshot " + campaign.ageDays + " days old" : "Snapshot date unknown";
      const budget = campaign.remainingUsd == null ? "Remaining budget unknown" : "Snapshot remaining ≈ $" + campaign.remainingUsd.toLocaleString("en");
      const rate = payout && payout.ratePerKViews != null ? "$" + payout.ratePerKViews + " / 1K views" : "Rate not listed";
      const official = campaign.officialUrl || window.ClipRewardFeed.OFFICIAL_DISCOVER;
      return '<article class="feed-campaign-card"><div class="feed-card-top"><strong>' + escapeHtml(campaign.title) + '</strong><span>' + escapeHtml(freshness) + '</span></div>' +
        '<p>' + escapeHtml(campaign.brand || "Brand not stated") + ' · ' + escapeHtml(campaign.type || "Type unknown") + '</p>' +
        '<div class="feed-metrics"><span>' + escapeHtml(rate) + '</span><span>' + escapeHtml(budget) + '</span></div>' +
        '<p class="feed-source-note">Third-party snapshot only. Live status and eligibility are not verified.</p>' +
        '<div class="feed-card-actions"><button class="button button-secondary" type="button" data-feed-import="' + index + '">Analyse & import</button>' +
        '<a class="text-button" href="' + escapeHtml(official) + '" target="_blank" rel="noopener noreferrer">Verify on official Discover ↗</a></div></article>';
    }).join("");
    $("campaign-feed-results").hidden = false;
    $("campaign-feed-list").querySelectorAll("[data-feed-import]").forEach((button) => {
      button.addEventListener("click", () => importFeedCampaign(Number(button.dataset.feedImport)));
    });
  }

  async function loadCampaignFeed() {
    const button = $("campaign-feed-load");
    button.disabled = true;
    $("campaign-feed-status").textContent = "Fetching third-party campaign snapshot…";
    $("campaign-feed-results").hidden = true;
    try {
      const result = await window.ClipRewardFeed.fetchCampaigns({
        platform: $("scout-target-platform").value,
        search: $("campaign-feed-search").value
      });
      renderCampaignFeed(result);
    } catch (error) {
      $("campaign-feed-status").textContent = error && error.message ? error.message : "Campaign feed unavailable.";
      $("campaign-feed-results").hidden = false;
      $("campaign-feed-list").innerHTML = '<p class="muted small-text">Use the official Discover page and paste its public campaign details below. No campaign data was assumed or fabricated.</p>';
    } finally {
      button.disabled = false;
    }
  }

  async function importFeedCampaign(index) {
    const campaign = campaignFeedRows[index];
    if (!campaign) return;
    $("scout-source-url").value = campaign.officialUrl || "";
    if (campaign.officialUrl) {
      const pageLoaded = await analysePublicCampaignUrl();
      if (pageLoaded) return;
    }
    const platform = $("scout-target-platform").value;
    $("scout-brief-text").value = window.ClipRewardFeed.campaignToBrief(campaign, platform);
    analyseCampaignBrief(null, "third-party-feed");
    $("scout-results").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderRewardsIntelligence(result) {
    const assessment = window.ClipRewardIntelligence.assessAll({
      brief: result,
      platform: $("scout-target-platform").value,
      today: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10),
      account: state.account
    });
    const campaign = assessment.campaign;
    const stateClass = campaign.state === "blocked" ? "ri-blocked" : campaign.state === "promising" ? "ri-promising" : "ri-verify";
    const reasons = campaign.reasons.length
      ? '<ul>' + campaign.reasons.map((reason) => '<li>' + escapeHtml(reason) + '</li>').join("") + '</ul>'
      : "";
    $("ri-campaign-summary").innerHTML =
      '<div class="ri-summary ' + stateClass + '"><strong>' + escapeHtml(campaign.stateLabel) + '</strong>' +
      '<p>' + escapeHtml(campaign.nextStep) + '</p>' + reasons + '<small>' + escapeHtml(campaign.earningsNote) + '</small></div>' +
      '<div class="ri-payout"><strong>Reward calculation · ' + escapeHtml(campaign.payout.model) + '</strong><p>' +
      escapeHtml(campaign.payout.formula) + '</p><small>' +
      escapeHtml(campaign.payout.creatorFee && campaign.payout.creatorFee.label ? campaign.payout.creatorFee.label : "Creator fee: not recognised") +
      '</small><a class="ri-fee-link" href="' + escapeHtml(campaign.payout.creatorFee && campaign.payout.creatorFee.source ? campaign.payout.creatorFee.source : "https://contentrewards.com/terms") + '" target="_blank" rel="noopener noreferrer">Official creator fee terms ↗</a></div>';
    $("ri-rule-checks").innerHTML = campaign.checks.map((item) =>
      '<article class="ri-check"><span class="ri-status ri-' + escapeHtml(item.status) + '">' + escapeHtml(item.status.toUpperCase()) +
      '</span><strong>' + escapeHtml(item.label) + '</strong><p>' + escapeHtml(item.detail) + '</p></article>'
    ).join("");
    const requirements = campaign.requirements.length
      ? campaign.requirements.map((item) => '<li><strong>' + escapeHtml(item.label) + ':</strong> ' + escapeHtml(item.detail) + '</li>').join("")
      : '<li>No additional explicit requirements were recognised. Read the full official brief; this does not mean there are no requirements.</li>';
    $("ri-requirements").innerHTML =
      '<div class="ri-requirements"><strong>What the brief says you must prepare</strong><ul>' + requirements + '</ul></div>';
    $("ri-native-programs").innerHTML = assessment.nativePrograms.map((item) =>
      '<article class="ri-native-card"><div class="ri-native-top"><span>' + escapeHtml(item.platform.toUpperCase()) +
      '</span><small class="ri-status ri-unknown">LIVE CHECK REQUIRED</small></div><h4>' + escapeHtml(item.title) +
      '</h4><p class="ri-route">' + escapeHtml(item.route) + '</p><p>' + escapeHtml(item.summary) + '</p><ul>' +
      item.checks.map((check) => '<li>' + escapeHtml(check) + '</li>').join("") +
      '</ul><a href="' + escapeHtml(item.source) + '" target="_blank" rel="noopener noreferrer">' +
      escapeHtml(item.sourceLabel) + ' ↗</a></article>'
    ).join("");
  }

  function analyseCampaignBrief(event, analysisSource) {
    if (event && typeof event.preventDefault === "function") event.preventDefault();
    try {
      const result = window.ClipRewardScout.parseCampaignBrief({
        url: $("scout-source-url").value,
        requestedPlatform: $("scout-target-platform").value,
        text: $("scout-brief-text").value
      });
      result.analysisSource = analysisSource || "copied-text";
      renderCampaignScout(result);
      showToast(analysisSource === "public-url"
        ? "Public campaign page analysed automatically. Review findings and missing fields."
        : "Campaign brief analysed. Review every detected rule and missing field.");
    } catch (error) {
      campaignScoutResult = null;
      $("scout-results").hidden = true;
      showToast(error.message || "Could not analyse this campaign brief.");
    }
  }

  async function analysePublicCampaignUrl() {
    const button = $("scout-url-analyse-button");
    const canonicalUrl = window.ClipRewardFeed.canonicalCampaignUrl($("scout-source-url").value);
    if (!canonicalUrl) {
      showToast("Enter a public HTTPS Content Rewards campaign URL, not the Discover index or another website.");
      return;
    }
    button.disabled = true;
    button.textContent = "Reading public page…";
    $("scout-source-url").value = canonicalUrl;
    try {
      const snapshot = await window.ClipRewardDiscovery.fetchStaticSnapshot({ url: "./discovery-snapshot.json" });
      const detail = (snapshot.campaignDetails || []).find((item) =>
        window.ClipRewardFeed.canonicalCampaignUrl(item.url) === canonicalUrl
      );
      if (!detail) {
        const detailCount = (snapshot.campaignDetails || []).length;
        throw new Error(detailCount
          ? "This URL is not in the latest public-page scan. Wait for the next scheduled scan, or open a campaign found in Discover."
          : "No public campaign detail pages have been scanned yet. Run the GitHub Actions workflow “Scheduled Content Rewards discovery snapshot” once, then retry this URL.");
      }
      if (!detail.pageText || !["ok", "stale"].includes(detail.status)) {
        throw new Error(detail.lastError || "The public campaign page could not be fetched. It may be blocked or require sign-in.");
      }
      $("scout-brief-text").value = detail.pageText;
      analyseCampaignBrief(null, "public-url");
      if (campaignScoutResult) {
        campaignScoutResult.pageFetchedAt = detail.fetchedAt || "";
        campaignScoutResult.pageFetchStatus = detail.status;
        if (detail.status === "stale") {
          const staleReason = detail.notInLatestFeed
            ? "This URL is no longer present in the latest public lead feed; showing previously saved page content."
            : "The latest page fetch failed; showing previously saved public page content.";
          $("scout-source-note").textContent += " " + staleReason + " Last saved: " + (detail.fetchedAt || "an earlier scan") + ". " + (detail.lastError || "");
        } else {
          $("scout-source-note").textContent += " Public page fetched: " + (detail.fetchedAt || "timestamp unavailable") + ".";
        }
        $("scout-results").scrollIntoView({ behavior: "smooth", block: "start" });
        return true;
      }
      return false;
    } catch (error) {
      showToast(error && error.message ? error.message : "Could not auto-analyse this public campaign URL.");
      return false;
    } finally {
      button.disabled = false;
      button.textContent = "⌕ Analyse website automatically";
    }
  }

  function autofillCampaignTracker() {
    if (!campaignScoutResult) return;
    const result = campaignScoutResult;
    openModal(null);
    $("campaign-name").value = result.title || "Content Rewards campaign — rename this";
    $("campaign-platform").value = "Content Rewards";
    $("campaign-url").value = result.sourceUrl || "";
    $("campaign-deadline").value = result.deadline || "";
    const target = $("scout-target-platform").value;
    const hasPlatformRates = Array.isArray(result.platformRates) && result.platformRates.length > 0;
    const platformRate = hasPlatformRates ? result.platformRates.find((item) => item.platform === target) : null;
    const selectedRate = platformRate || (hasPlatformRates ? null : result.rate);
    const selectedCap = Array.isArray(result.platformCaps) ? result.platformCaps.find((item) => item.platform === target) : null;
    const selectedMinimum = Array.isArray(result.platformMinimumViews) ? result.platformMinimumViews.find((item) => item.platform === target) : null;
    const selectedMaximum = Array.isArray(result.platformMaximumViews) ? result.platformMaximumViews.find((item) => item.platform === target) : null;
    const cap = (selectedCap && selectedCap.amount) || (Array.isArray(result.platformCaps) && result.platformCaps.length ? null : result.capPerClip);
    const minimumViews = selectedMinimum ? selectedMinimum.value :
      (Array.isArray(result.platformMinimumViews) && result.platformMinimumViews.length ? null : result.minimumViews);
    const maximumViews = selectedMaximum ? selectedMaximum.value :
      (Array.isArray(result.platformMaximumViews) && result.platformMaximumViews.length ? null : result.maximumViews);
    const payoutParts = [];
    if (selectedRate) payoutParts.push(selectedRate.label);
    else if (hasPlatformRates) payoutParts.push(target + " payout rate not recognised in copied text");
    if (cap) payoutParts.push("Max payout / clip cap: " + window.ClipRewardScout.formatAmount(cap));
    if (result.minimumPayout) payoutParts.push("Minimum payout: " + window.ClipRewardScout.formatAmount(result.minimumPayout));
    if (minimumViews != null) payoutParts.push("Min views: " + Number(minimumViews).toLocaleString("en"));
    if (maximumViews != null) payoutParts.push("Max views: " + Number(maximumViews).toLocaleString("en"));
    if (result.hiddenRequirements && result.hiddenRequirements.locked) {
      payoutParts.push("Creator requirements locked until join" + (result.hiddenRequirements.count == null ? "" : " (" + result.hiddenRequirements.count + ")"));
    }
    $("campaign-payout-terms").value = payoutParts.join(" · ").slice(0, 180);
    const budgetParts = [];
    if (result.budget && result.budget.spent) budgetParts.push(window.ClipRewardScout.formatAmount(result.budget.spent) + " used");
    if (result.budget && result.budget.total) budgetParts.push(window.ClipRewardScout.formatAmount(result.budget.total) + " total");
    if (result.budget && result.budget.remaining) budgetParts.push(window.ClipRewardScout.formatAmount(result.budget.remaining) + " remaining");
    $("campaign-budget-terms").value = budgetParts.join(" · ").slice(0, 180);
    $("campaign-rules").value = window.ClipRewardScout.buildTrackerNotes(result);
    $("campaign-status").value = "idea";
    $("campaign-post-url").value = "";
    $("campaign-post-platform").value = "";
    $("campaign-posted-at").value = "";
    $("campaign-submitted-at").value = "";
    showToast(result.platformMatch === "match"
      ? result.requestedPlatform + " campaign details autofilled. Verify the official brief before saving."
      : "Details autofilled, but platform is not stated. Check eligibility on the official brief before saving.");
  }

  async function pasteCampaignBriefFromClipboard() {
    if (!navigator.clipboard || typeof navigator.clipboard.readText !== "function" || !window.isSecureContext) {
      showToast("Clipboard access is unavailable. Copy the campaign brief and paste it into the text box.");
      $("scout-brief-text").focus();
      return;
    }
    try {
      const value = await navigator.clipboard.readText();
      if (!value.trim()) throw new Error("Clipboard is empty. Copy the visible campaign brief first.");
      $("scout-brief-text").value = value.slice(0, 20000);
      analyseCampaignBrief();
      $("scout-brief-text").focus();
      if (campaignScoutResult) showToast("Brief pasted and analysed. Review findings, then use Autofill campaign tracker.");
    } catch (error) {
      showToast(error.message || "Clipboard permission denied. Paste the brief manually.");
      $("scout-brief-text").focus();
    }
  }

  function clearCampaignScout() {
    $("campaign-scout-form").reset();
    $("scout-results").hidden = true;
    $("scout-found-grid").innerHTML = "";
    $("ri-campaign-summary").innerHTML = "";
    $("ri-rule-checks").innerHTML = "";
    $("ri-requirements").innerHTML = "";
    $("ri-native-programs").innerHTML = "";
    campaignScoutResult = null;
  }

  function openModal(campaign) {
    const editing = Boolean(campaign);
    $("campaign-form").reset();
    $("campaign-id").value = editing ? campaign.id : "";
    $("modal-title").textContent = editing ? "Edit campaign" : "Add campaign";
    $("campaign-name").value = editing ? campaign.name : "";
    $("campaign-platform").value = editing ? campaign.platform : "Content Rewards";
    $("campaign-url").value = editing ? campaign.url : "";
    $("campaign-deadline").value = editing ? campaign.deadline : "";
    $("campaign-payout-terms").value = editing ? campaign.payoutTerms : "";
    $("campaign-budget-terms").value = editing ? campaign.budgetTerms : "";
    $("campaign-rules").value = editing ? campaign.rules : "";
    $("campaign-status").value = editing ? campaign.status : "idea";
    $("campaign-post-url").value = editing ? campaign.postUrl : "";
    $("campaign-post-platform").value = editing ? campaign.postPlatform : "";
    $("campaign-posted-at").value = editing ? localDateTimeValue(campaign.postedAt) : "";
    $("campaign-submitted-at").value = editing ? localDateTimeValue(campaign.submittedAt) : "";
    $("campaign-modal").hidden = false;
    document.body.style.overflow = "hidden";
    $("campaign-name").focus();
  }
  function closeModal() {
    $("campaign-modal").hidden = true;
    document.body.style.overflow = "";
  }
  function campaignById(id) { return state.campaigns.find((c) => c.id === id); }
  function editById(id) {
    const campaign = campaignById(id);
    if (campaign) openModal(campaign);
  }
  function onCampaignSubmit(event) {
    event.preventDefault();
    const id = $("campaign-id").value;
    const old = id ? campaignById(id) : null;
    if (id && !old) { showToast("That campaign no longer exists. Refresh and try again."); closeModal(); return; }
    try {
      const record = Core.normalizeCampaign({
        id: old ? old.id : "",
        name: $("campaign-name").value,
        platform: $("campaign-platform").value || (old ? old.platform : "Other"),
        url: $("campaign-url").value,
        deadline: $("campaign-deadline").value,
        payoutTerms: $("campaign-payout-terms").value,
        budgetTerms: $("campaign-budget-terms").value,
        rules: $("campaign-rules").value,
        status: $("campaign-status").value,
        postUrl: $("campaign-post-url").value,
        postPlatform: $("campaign-post-platform").value || (old ? old.postPlatform : ""),
        postedAt: $("campaign-posted-at").value ? new Date($("campaign-posted-at").value).toISOString() : "",
        submittedAt: $("campaign-submitted-at").value ? new Date($("campaign-submitted-at").value).toISOString() : "",
        createdAt: old ? old.createdAt : ""
      });
      const submissionValidation = Core.validateSubmissionRecord(record);
      if (!submissionValidation.valid) throw new Error(submissionValidation.error);
      if (!old && state.campaigns.length >= Core.MAX_CAMPAIGNS) throw new Error("Campaign limit reached. Export a backup before adding more.");
      const previous = snapshotState();
      state.campaigns = old ? state.campaigns.map((c) => c.id === old.id ? record : c) : [record, ...state.campaigns];
      const persisted = saveOrRestore(previous);
      if (!persisted) return;
      closeModal();
      render();
      if (persisted) showToast(record.status === "submitted" ? "Submission recorded locally. Approval is not yet confirmed." : "Campaign saved on this device.");
    } catch (error) { showToast(error.message || "Could not save campaign."); }
  }
  function deleteCampaign(id) {
    const campaign = campaignById(id);
    if (!campaign) return;
    if (!window.confirm('Delete "' + campaign.name + '" from this device?')) return;
    const previous = snapshotState();
    state.campaigns = state.campaigns.filter((c) => c.id !== id);
    const persisted = saveOrRestore(previous);
    if (!persisted) return;
    render();
    if (persisted) showToast("Campaign removed.");
  }
  function addTimestamp(event) {
    event.preventDefault();
    if (state.timestamps.length >= Core.MAX_TIMESTAMPS) { showToast("Timestamp limit reached. Export a backup first."); return; }
    try {
      const item = Core.normalizeTimestamp({ timestamp: $("timestamp-input").value, note: $("timestamp-note").value });
      if (state.timestamps.some((t) => t.seconds === item.seconds && t.note.toLowerCase() === item.note.toLowerCase())) {
        showToast("That timestamp and note are already saved."); return;
      }
      const previous = snapshotState();
      state.timestamps.push(item);
      const persisted = saveOrRestore(previous);
      if (!persisted) return;
      $("timestamp-form").reset();
      renderTimestamps();
      if (persisted) showToast("Editing note saved.");
    } catch (error) { showToast(error.message || "Could not save timestamp."); }
  }
  function generateDraft(event) {
    event.preventDefault();
    const selectedId = $("draft-campaign").value;
    const campaign = selectedId ? campaignById(selectedId) : null;
    const rules = campaign ? campaign.rules.toLowerCase() : "";
    const disclosure = rules.includes("disclos") || rules.includes("affiliate") ? "Follow the selected campaign's written disclosure rule: " + campaign.rules : "Clearly disclose a paid, sponsored or affiliate relationship where applicable.";
    try {
      const output = Core.makeDraft({
        topic: $("draft-topic").value,
        benefit: $("draft-benefit").value,
        language: $("draft-language").value,
        platform: $("draft-platform").value,
        disclosure
      });
      $("draft-output").value = output;
      $("draft-result").hidden = false;
      showToast("Draft generated from local templates. Check it before posting.");
    } catch (error) { showToast(error.message || "Could not generate draft."); }
  }
  async function copyDraft() {
    const value = $("draft-output").value;
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(value);
      else {
        $("draft-output").focus(); $("draft-output").select();
        if (!document.execCommand("copy")) throw new Error("copy failed");
      }
      showToast("Draft copied.");
    } catch (_) { showToast("Select the draft text and copy it manually."); }
  }
  function exportBackup() {
    try {
      const backup = Core.createBackup(state);
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href; anchor.download = "clipreward-backup-" + new Date().toISOString().slice(0, 10) + ".json";
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
      showToast("Backup exported. Keep it private and safe.");
    } catch (error) { showToast(error.message || "Could not export backup."); }
  }
  function importBackup(file) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { showToast("Backup must be 2 MB or smaller."); return; }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = Core.parseBackup(String(reader.result || ""));
        if (!window.confirm("Replace this device's " + state.campaigns.length + " campaigns, " + state.timestamps.length + " timestamps and account checklist with " + imported.campaigns.length + " campaigns, " + imported.timestamps.length + " timestamps and the account checklist from this backup?")) return;
        const previous = snapshotState();
        state = imported;
        const persisted = saveOrRestore(previous);
        if (!persisted) return;
        render();
        if (persisted) showToast("Backup imported.");
      } catch (error) { showToast(error.message || "Could not import backup."); }
      finally { $("import-file").value = ""; }
    };
    reader.onerror = () => { showToast("Could not read that file."); $("import-file").value = ""; };
    reader.readAsText(file);
  }

  $("today-label").textContent = new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  $("add-campaign-button").addEventListener("click", () => openModal(null));
  $("empty-add-button").addEventListener("click", () => openModal(null));
  $("close-modal").addEventListener("click", closeModal);
  $("cancel-modal").addEventListener("click", closeModal);
  $("campaign-modal").addEventListener("click", (event) => { if (event.target === $("campaign-modal")) closeModal(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !$("campaign-modal").hidden) closeModal(); });
  $("campaign-form").addEventListener("submit", onCampaignSubmit);
  $("campaign-search").addEventListener("input", renderCampaigns);
  $("status-filter").addEventListener("change", renderCampaigns);
  $("campaign-list").addEventListener("click", (event) => {
    const edit = event.target.closest(".edit-campaign");
    const remove = event.target.closest(".delete-campaign");
    if (edit) editById(edit.dataset.id);
    if (remove) deleteCampaign(remove.dataset.id);
  });
  $("submission-table").addEventListener("click", (event) => {
    const edit = event.target.closest(".edit-campaign");
    if (edit) editById(edit.dataset.id);
  });
  $("timestamp-form").addEventListener("submit", addTimestamp);
  $("timestamp-list").addEventListener("click", (event) => {
    const button = event.target.closest(".remove-time");
    if (!button) return;
    const previous = snapshotState();
    state.timestamps = state.timestamps.filter((t) => t.id !== button.dataset.id);
    const persisted = saveOrRestore(previous);
    if (!persisted) return;
    renderTimestamps();
    if (persisted) showToast("Timestamp removed.");
  });
  $("account-profile-form").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const previous = snapshotState();
      state.account = Core.normalizeAccount({ ...state.account, displayName: $("account-display-name").value, updatedAt: new Date().toISOString() });
      const persisted = saveOrRestore(previous);
      if (!persisted) return;
      renderAccount();
      if (persisted) showToast("Creator label saved on this device.");
    } catch (error) { showToast(error.message || "Could not save creator label."); }
  });
  $("social-account-form").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      if (state.account.socialAccounts.length >= Core.MAX_SOCIAL_ACCOUNTS) throw new Error("Social-account limit reached. Remove an entry you no longer use.");
      const previous = snapshotState();
      state.account = Core.normalizeAccount({
        ...state.account,
        socialAccounts: [...state.account.socialAccounts, {
          platform: $("social-platform").value,
          handle: $("social-handle").value,
          confirmedConnected: false
        }],
        updatedAt: new Date().toISOString()
      });
      const persisted = saveOrRestore(previous);
      if (!persisted) return;
      $("social-handle").value = "";
      renderAccount();
      if (persisted) showToast("Social handle saved. Verify connection on the official platform.");
    } catch (error) { showToast(error.message || "Could not save this social account."); }
  });
  $("social-account-list").addEventListener("click", (event) => {
    const confirm = event.target.closest(".confirm-social");
    const remove = event.target.closest(".remove-social");
    const id = (confirm || remove) && (confirm || remove).dataset.id;
    if (!id) return;
    try {
      if (confirm) {
        const previous = snapshotState();
        state.account = Core.normalizeAccount({
          ...state.account,
          socialAccounts: state.account.socialAccounts.map((item) => item.id === id ? { ...item, confirmedConnected: !item.confirmedConnected, updatedAt: new Date().toISOString() } : item),
          updatedAt: new Date().toISOString()
        });
        const persisted = saveOrRestore(previous);
        if (!persisted) return;
        renderAccount();
        if (persisted) showToast("Local reminder updated; live connection was not queried.");
      } else if (remove && window.confirm("Remove this saved social-account reminder from this device?")) {
        const previous = snapshotState();
        state.account = Core.normalizeAccount({
          ...state.account,
          socialAccounts: state.account.socialAccounts.filter((item) => item.id !== id),
          updatedAt: new Date().toISOString()
        });
        const persisted = saveOrRestore(previous);
        if (!persisted) return;
        renderAccount();
        if (persisted) showToast("Saved social-account reminder removed.");
      }
    } catch (error) { showToast(error.message || "Could not update this account reminder."); }
  });
  document.querySelectorAll("[data-account-check]").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.dataset.accountCheck;
      if (!Core.ACCOUNT_CHECKS.includes(key)) return;
      const previous = snapshotState();
      state.account = Core.normalizeAccount({
        ...state.account,
        checklist: { ...state.account.checklist, [key]: input.checked },
        updatedAt: new Date().toISOString()
      });
      if (!saveOrRestore(previous)) return;
      renderAccount();
    });
  });
  $("campaign-feed-load").addEventListener("click", loadCampaignFeed);
  $("campaign-scout-form").addEventListener("submit", analyseCampaignBrief);
  $("scout-url-analyse-button").addEventListener("click", analysePublicCampaignUrl);
  $("scout-brief-text").addEventListener("input", () => {
    if ($("scout-brief-text").value.trim().length < 12) {
      campaignScoutResult = null;
      $("scout-results").hidden = true;
      $("scout-autofill-button").disabled = true;
      return;
    }
    analyseCampaignBrief();
  });
  $("scout-source-url").addEventListener("change", () => {
    if ($("scout-brief-text").value.trim().length >= 12) analyseCampaignBrief();
  });
  $("scout-target-platform").addEventListener("change", () => {
    if ($("scout-brief-text").value.trim().length >= 12) analyseCampaignBrief();
  });
  $("scout-paste-button").addEventListener("click", pasteCampaignBriefFromClipboard);
  document.querySelectorAll("[data-scout-platform-link]").forEach((link) => {
    link.addEventListener("click", () => {
      $("scout-target-platform").value = link.dataset.scoutPlatformLink;
    });
  });
  $("scout-autofill-button").addEventListener("click", autofillCampaignTracker);
  $("scout-clear-button").addEventListener("click", clearCampaignScout);
  $("draft-form").addEventListener("submit", generateDraft);
  $("copy-draft").addEventListener("click", copyDraft);
  $("export-button").addEventListener("click", exportBackup);
  $("import-button").addEventListener("click", () => $("import-file").click());
  $("import-file").addEventListener("change", (event) => importBackup(event.target.files && event.target.files[0]));
  load();
  render();
  configureDiscovery();
  window.setInterval(refreshDeadlineCountdowns, 1000);
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch(() => {
      showToast("Offline caching is unavailable in this browser session.");
    }));
  }
})();
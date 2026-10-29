(function () {
  "use strict";
  const Core = window.ClipRewardCore;
  const STORAGE_KEY = "clipreward-studio-v1";
  const $ = (id) => document.getElementById(id);
  let state = { campaigns: [], timestamps: [], account: Core.normalizeAccount({}) };
  let toastTimer;
  const statusNames = { idea: "Idea", editing: "Editing", ready: "Ready to post", submitted: "Awaiting review", approved: "Approved", rejected: "Needs changes" };

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
      showToast("Could not save locally. Export a backup and check browser storage.");
      return false;
    }
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
      const rules = campaign.rules ? '<p class="campaign-rules">' + escapeHtml(campaign.rules) + '</p>' : "";
      const campaignLink = campaignUrl ? '<a class="text-button" href="' + escapeHtml(campaignUrl) + '" target="_blank" rel="noopener noreferrer">View campaign ↗</a>' : "";
      const postLink = campaign.postUrl ? '<a class="text-button" href="' + escapeHtml(campaign.postUrl) + '" target="_blank" rel="noopener noreferrer">View post ↗</a>' : "";
      return '<article class="campaign-card" data-id="' + escapeHtml(campaign.id) + '">' +
        '<div class="campaign-card-top"><div><h3>' + escapeHtml(campaign.name) + '</h3><div class="campaign-meta"><span class="mini-tag">' + escapeHtml(campaign.platform) + '</span>' +
        (campaign.deadline && campaign.deadline < new Date().toISOString().slice(0, 10) && campaign.status !== "approved" ? '<span class="mini-tag" style="color:#ffaaaa">Deadline passed</span>' : "") +
        '</div></div>' + statusBadge(campaign.status) + '</div>' + rules + deadline +
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
      .map((c) => '<option value="' + escapeHtml(c.id) + '">' + escapeHtml(c.name) + '</option>').join("");
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
        "</td><td>" + escapeHtml(new Date(c.updatedAt).toLocaleDateString()) + "</td><td>" + statusBadge(c.status) + '</td><td><button type="button" class="text-button edit-campaign" data-id="' + escapeHtml(c.id) + '">Update</button></td></tr>';
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
  function openModal(campaign) {
    const editing = Boolean(campaign);
    $("campaign-form").reset();
    $("campaign-id").value = editing ? campaign.id : "";
    $("modal-title").textContent = editing ? "Edit campaign" : "Add campaign";
    $("campaign-name").value = editing ? campaign.name : "";
    $("campaign-platform").value = editing ? campaign.platform : "Content Rewards";
    $("campaign-url").value = editing ? campaign.url : "";
    $("campaign-deadline").value = editing ? campaign.deadline : "";
    $("campaign-rules").value = editing ? campaign.rules : "";
    $("campaign-status").value = editing ? campaign.status : "idea";
    $("campaign-post-url").value = editing ? campaign.postUrl : "";
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
        platform: $("campaign-platform").value,
        url: $("campaign-url").value,
        deadline: $("campaign-deadline").value,
        rules: $("campaign-rules").value,
        status: $("campaign-status").value,
        postUrl: $("campaign-post-url").value,
        createdAt: old ? old.createdAt : ""
      });
      if (!old && state.campaigns.length >= Core.MAX_CAMPAIGNS) throw new Error("Campaign limit reached. Export a backup before adding more.");
      state.campaigns = old ? state.campaigns.map((c) => c.id === old.id ? record : c) : [record, ...state.campaigns];
      save();
      closeModal();
      render();
      showToast(record.status === "submitted" ? "Submission recorded locally. Approval is not yet confirmed." : "Campaign saved on this device.");
    } catch (error) { showToast(error.message || "Could not save campaign."); }
  }
  function deleteCampaign(id) {
    const campaign = campaignById(id);
    if (!campaign) return;
    if (!window.confirm('Delete "' + campaign.name + '" from this device?')) return;
    state.campaigns = state.campaigns.filter((c) => c.id !== id);
    save(); render(); showToast("Campaign removed.");
  }
  function addTimestamp(event) {
    event.preventDefault();
    if (state.timestamps.length >= Core.MAX_TIMESTAMPS) { showToast("Timestamp limit reached. Export a backup first."); return; }
    try {
      const item = Core.normalizeTimestamp({ timestamp: $("timestamp-input").value, note: $("timestamp-note").value });
      if (state.timestamps.some((t) => t.seconds === item.seconds && t.note.toLowerCase() === item.note.toLowerCase())) {
        showToast("That timestamp and note are already saved."); return;
      }
      state.timestamps.push(item);
      save(); $("timestamp-form").reset(); renderTimestamps(); showToast("Editing note saved.");
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
        state = imported;
        save(); render(); showToast("Backup imported.");
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
    state.timestamps = state.timestamps.filter((t) => t.id !== button.dataset.id);
    save(); renderTimestamps(); showToast("Timestamp removed.");
  });
  $("account-profile-form").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      state.account = Core.normalizeAccount({ ...state.account, displayName: $("account-display-name").value, updatedAt: new Date().toISOString() });
      save(); renderAccount(); showToast("Creator label saved on this device.");
    } catch (error) { showToast(error.message || "Could not save creator label."); }
  });
  $("social-account-form").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      if (state.account.socialAccounts.length >= Core.MAX_SOCIAL_ACCOUNTS) throw new Error("Social-account limit reached. Remove an entry you no longer use.");
      state.account = Core.normalizeAccount({
        ...state.account,
        socialAccounts: [...state.account.socialAccounts, {
          platform: $("social-platform").value,
          handle: $("social-handle").value,
          confirmedConnected: false
        }],
        updatedAt: new Date().toISOString()
      });
      save(); $("social-handle").value = ""; renderAccount();
      showToast("Social handle saved. Verify connection on the official platform.");
    } catch (error) { showToast(error.message || "Could not save this social account."); }
  });
  $("social-account-list").addEventListener("click", (event) => {
    const confirm = event.target.closest(".confirm-social");
    const remove = event.target.closest(".remove-social");
    const id = (confirm || remove) && (confirm || remove).dataset.id;
    if (!id) return;
    try {
      if (confirm) {
        state.account = Core.normalizeAccount({
          ...state.account,
          socialAccounts: state.account.socialAccounts.map((item) => item.id === id ? { ...item, confirmedConnected: !item.confirmedConnected, updatedAt: new Date().toISOString() } : item),
          updatedAt: new Date().toISOString()
        });
        save(); renderAccount();
        showToast("Local reminder updated; live connection was not queried.");
      } else if (remove && window.confirm("Remove this saved social-account reminder from this device?")) {
        state.account = Core.normalizeAccount({
          ...state.account,
          socialAccounts: state.account.socialAccounts.filter((item) => item.id !== id),
          updatedAt: new Date().toISOString()
        });
        save(); renderAccount(); showToast("Saved social-account reminder removed.");
      }
    } catch (error) { showToast(error.message || "Could not update this account reminder."); }
  });
  document.querySelectorAll("[data-account-check]").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.dataset.accountCheck;
      if (!Core.ACCOUNT_CHECKS.includes(key)) return;
      state.account = Core.normalizeAccount({
        ...state.account,
        checklist: { ...state.account.checklist, [key]: input.checked },
        updatedAt: new Date().toISOString()
      });
      save(); renderAccount();
    });
  });
  $("draft-form").addEventListener("submit", generateDraft);
  $("copy-draft").addEventListener("click", copyDraft);
  $("export-button").addEventListener("click", exportBackup);
  $("import-button").addEventListener("click", () => $("import-file").click());
  $("import-file").addEventListener("change", (event) => importBackup(event.target.files && event.target.files[0]));
  load();
  render();
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch(() => {
      showToast("Offline caching is unavailable in this browser session.");
    }));
  }
})();
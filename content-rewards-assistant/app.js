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
    $("scout-confidence").textContent = "Extraction only · " + result.confidence;
    $("scout-confidence").classList.toggle("scout-match", result.platformMatch === "match");
    $("scout-confidence").classList.toggle("scout-mismatch", result.platformMatch === "mismatch");
    $("scout-confidence").classList.toggle("scout-unknown", result.platformMatch === "unknown");
    $("scout-source-note").textContent = result.platformMatch === "match"
      ? result.requestedPlatform + " appears in the accepted platform names copied from this brief. Verify it on the live campaign page."
      : result.platformMatch === "mismatch"
        ? result.requestedPlatform + " is not listed in the copied brief. Autofill is blocked to avoid saving a wrong-platform campaign."
        : result.platformMatch === "unknown"
          ? result.requestedPlatform + " is not stated in the copied text. You may autofill the draft, but must verify platform eligibility on the official brief."
          : "Extraction quality only — not a campaign verification, eligibility check or payout guarantee. Findings come only from the text you pasted.";
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

  function renderRewardsIntelligence(result) {
    const assessment = window.ClipRewardIntelligence.assessAll({
      brief: result,
      platform: $("scout-target-platform").value,
      today: new Date().toISOString().slice(0, 10),
      account: state.account
    });
    const campaign = assessment.campaign;
    const stateClass = campaign.state === "blocked" ? "ri-blocked" : campaign.state === "promising" ? "ri-promising" : "ri-verify";
    $("ri-campaign-summary").innerHTML =
      '<div class="ri-summary ' + stateClass + '"><strong>' + escapeHtml(campaign.stateLabel) + '</strong>' +
      '<p>' + escapeHtml(campaign.nextStep) + '</p><small>' + escapeHtml(campaign.earningsNote) + '</small></div>';
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

  function analyseCampaignBrief(event) {
    if (event && typeof event.preventDefault === "function") event.preventDefault();
    try {
      const result = window.ClipRewardScout.parseCampaignBrief({
        url: $("scout-source-url").value,
        requestedPlatform: $("scout-target-platform").value,
        text: $("scout-brief-text").value
      });
      renderCampaignScout(result);
      showToast("Campaign details extracted from pasted text. Review the findings.");
    } catch (error) {
      campaignScoutResult = null;
      $("scout-results").hidden = true;
      showToast(error.message || "Could not analyse this campaign brief.");
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
    $("campaign-payout-terms").value = result.rate ? result.rate.label : "";
    $("campaign-budget-terms").value = result.budget
      ? (result.budget.spent ? window.ClipRewardScout.formatAmount(result.budget.spent) + " used / " : "") +
        window.ClipRewardScout.formatAmount(result.budget.total) + " total" +
        (result.budget.remaining ? " / " + window.ClipRewardScout.formatAmount(result.budget.remaining) + " remaining" : "")
      : "";
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
  $("campaign-scout-form").addEventListener("submit", analyseCampaignBrief);
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
  window.setInterval(refreshDeadlineCountdowns, 1000);
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch(() => {
      showToast("Offline caching is unavailable in this browser session.");
    }));
  }
})();
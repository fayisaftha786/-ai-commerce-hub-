(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ClipRewardPayoutForecast = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DAY_MS = 24 * 60 * 60 * 1000;
  const MODEL_VALUES = Object.freeze(["unknown", "CPM", "Per post", "Retainer", "Pool"]);
  const THRESHOLD_VALUES = Object.freeze(["unknown", "not-required", "pending", "met", "not-met"]);

  function validTime(value) {
    if (!value) return null;
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : null;
  }

  function result(status, title, detail, estimateAt, caveat) {
    return {
      status,
      title,
      detail,
      estimateAt: estimateAt == null ? "" : new Date(estimateAt).toISOString(),
      caveat: caveat || ""
    };
  }

  function calculatePayoutForecast(record) {
    const source = record && typeof record === "object" && !Array.isArray(record) ? record : {};
    const model = MODEL_VALUES.includes(source.payoutModel) ? source.payoutModel : "unknown";
    const threshold = THRESHOLD_VALUES.includes(source.payoutThresholdStatus)
      ? source.payoutThresholdStatus : "unknown";

    if (source.payoutStatus === "not-eligible") {
      return result("blocked", "No payout forecast", "The campaign record is marked not eligible. Check the official decision before changing this status.");
    }
    if (source.payoutFlagOpen === true) {
      return result("paused", "Payout timing paused", "An open flag can pause settlement. No date can be forecast until the official flag is resolved.");
    }
    if (source.payoutStatus === "available" ||
        (source.paidAmountStage === "content-rewards-balance" && Number(source.paidAmount) > 0 && source.payoutStatus === "paid")) {
      return result("credited", "CR Balance credit recorded", "Content Rewards Balance is recorded as available / credited locally. This does not confirm a Whop withdrawal or bank payment.");
    }
    if (model === "unknown") {
      return result("needs-input", "Select the payout model", "Choose CPM, Per post, Retainer or Pool from the official campaign brief.");
    }

    if (model === "CPM" || model === "Per post") {
      const approvedAt = validTime(source.reviewedAt);
      if (approvedAt == null) {
        return result("waiting", "Approval time needed", "Record the actual approval timestamp shown by Content Rewards. Applying or submitting is not approval.");
      }
      if (threshold === "unknown") {
        return result("needs-input", "Check the campaign minimum", model === "CPM"
          ? "Confirm whether the campaign has a minimum payout threshold."
          : "Confirm whether the campaign requires minimum views before payout.");
      }
      if (threshold === "pending") {
        return result("waiting", "Minimum not reached yet", "The campaign's payout threshold is still being tracked. No settlement date is available yet.");
      }
      if (threshold === "not-met") {
        return result("blocked", "Minimum requirement not met", "The campaign's minimum payout/views requirement is recorded as not met. Check its monitoring period and the official campaign decision.");
      }

      let startAt = approvedAt;
      if (threshold === "met") {
        const metAt = validTime(source.payoutThresholdMetAt);
        if (metAt == null) {
          return result("needs-input", "Threshold time needed", "Record when the official Content Rewards page showed the minimum payout/views requirement was met.");
        }
        startAt = Math.max(startAt, metAt);
      }

      if (model === "CPM") {
        return result(
          "estimate",
          "Estimated first CPM balance-credit date",
          "The first round opens after approval and any minimum payout threshold are both satisfied; it then normally runs for 7 earning days plus a 3-day hold.",
          startAt + 10 * DAY_MS,
          "First-round estimate only. Recurring rounds, funding, view validation, flags and payment runs can change timing."
        );
      }
      return result(
        "estimate",
        "Estimated Per-post balance-credit time",
        "Per-post payouts are normally credited about 15 minutes after approval when any campaign minimum views requirement is already met.",
        startAt + 15 * 60 * 1000,
        "Conditional on reaching the minimum views within the campaign's monitoring period, funding and validation."
      );
    }

    if (model === "Retainer") {
      const cycleEnd = validTime(source.payoutCycleEndAt);
      if (cycleEnd == null) {
        return result("needs-input", "Retainer cycle end needed", "Record the actual end of the weekly, two-weekly or monthly cycle from the campaign brief.");
      }
      return result(
        "estimate",
        "Estimated Retainer balance-credit time",
        "Retainer payouts normally settle about 15 minutes after the cycle ends.",
        cycleEnd + 15 * 60 * 1000,
        "The campaign may pay in full or pro-rata depending on its delivery terms; validation, flags and payment runs can change timing."
      );
    }

    const poolEnd = validTime(source.payoutPoolEndedAt);
    if (poolEnd == null) {
      return result("needs-input", "Pool end time needed", "A Pool does not end when your clip's tracking ends. Record the actual campaign Pool end shown by Content Rewards.");
    }
    if (threshold === "unknown" || threshold === "pending") {
      return result("waiting", "Pool eligibility needs confirmation", "Check whether you met the Pool's minimum qualifying views. The final share is not known before allocation.");
    }
    if (threshold === "not-met") {
      return result("blocked", "Pool minimum not met", "The campaign's qualifying minimum is recorded as not met, so this record should not expect a Pool share.");
    }
    return result(
      "estimate",
      "Estimated Pool balance-credit date",
      "Eligible Pool shares are calculated when the Pool ends and ordinarily settle after a 3-day hold.",
      poolEnd + 3 * DAY_MS,
      "The allocation and individual amount are not guaranteed; this depends on eligible views, other creators, fees, validation and funding."
    );
  }

  return Object.freeze({ DAY_MS, MODEL_VALUES, THRESHOLD_VALUES, calculatePayoutForecast });
});

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

  function result(status, title, detail, estimateAt, caveat, estimateEndAt) {
    return {
      status,
      title,
      detail,
      estimateAt: estimateAt == null ? "" : new Date(estimateAt).toISOString(),
      estimateEndAt: estimateEndAt == null ? "" : new Date(estimateEndAt).toISOString(),
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

      let thresholdMetAt = null;
      if (threshold === "met") {
        thresholdMetAt = validTime(source.payoutThresholdMetAt);
        if (thresholdMetAt == null) {
          return result("needs-input", "Threshold time needed", "Record when the official Content Rewards page showed the minimum payout/views requirement was met.");
        }
      }

      if (model === "CPM") {
        const firstRoundStartAt = Math.max(approvedAt, thresholdMetAt == null ? approvedAt : thresholdMetAt);
        return result(
          "estimate",
          "Estimated first CPM balance-credit date",
          "The first CPM payout round opens only after both approval and the minimum payout requirement are satisfied. From that later timestamp, the clip earns for 7 days, then the amount is held for 3 days and normally settles on day 10.",
          firstRoundStartAt + 10 * DAY_MS,
          "First approved round only. This estimate assumes the clip remains eligible and funded; an open flag, rejection, returned payout, funding issue or later approval change can alter the result."
        );
      }
      const perPostStart = Math.max(approvedAt, thresholdMetAt == null ? approvedAt : thresholdMetAt);
      return result(
        "estimate",
        "Estimated Per-post balance-credit window",
        "Per-post is set aside when the minimum views are reached and normally settles about 15–30 minutes after approval. This window starts after both approval and the recorded minimum-view milestone.",
        perPostStart + 15 * 60 * 1000,
        "Conditional on the minimum being met within the campaign's monitoring period, continued eligibility, funding and the next payment run.",
        perPostStart + 30 * 60 * 1000
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

    if (threshold === "unknown" || threshold === "pending") {
      return result("waiting", "Pool eligibility needs confirmation", "Check the campaign's minimum qualifying views on the official page. Do not forecast an individual Pool payout before eligibility is known.");
    }
    if (threshold === "not-met") {
      return result("blocked", "Pool minimum not met", "The campaign's qualifying minimum is recorded as not met. This record should not expect a Pool share.");
    }
    return result(
      "needs-input",
      "Pool payout timing not forecast",
      "The current official creator payout guide documents CPM, Per post and Retainer timing, but does not give a universal Pool settlement schedule. Record only a date actually shown in the official Earnings page or written campaign terms.",
      null,
      "Do not apply the CPM / Per-post / Retainer hold rules to a Pool by assumption."
    );
  }

  return Object.freeze({ DAY_MS, MODEL_VALUES, THRESHOLD_VALUES, calculatePayoutForecast });
});

export type ClaimStatusView = {
  label: string;
  tone: "brand" | "success" | "muted" | "warning";
  ready: boolean;
  history: boolean;
  showBalance: boolean;
  message?: string;
};

export function getClaimStatusView(
  status?: string,
  explicitlyClaimable?: boolean,
): ClaimStatusView {
  // Ready only when the API says claimable — never infer from status alone
  // (status can lag or appear on intent-only pending payloads).
  if (explicitlyClaimable === true) {
    return {
      label: "Claimable",
      tone: "success",
      ready: true,
      history: false,
      showBalance: false,
    };
  }

  if (status === "claimed") {
    return {
      label: "Claimed",
      tone: "muted",
      ready: false,
      history: true,
      showBalance: true,
    };
  }

  if (status === "claim_submitted") {
    return {
      label: "Submitted",
      tone: "brand",
      ready: false,
      history: true,
      showBalance: false,
      message: "Your claim was submitted and is being finalized.",
    };
  }

  if (status === "wrapped" || status === "confidential_transferred") {
    return {
      label: "Finalizing",
      tone: "brand",
      ready: false,
      history: true,
      showBalance: false,
      message: "Your private balance is being finalized.",
    };
  }

  if (status === "refunded" || status === "refund_submitted") {
    return {
      label: status === "refunded" ? "Refunded" : "Refunding",
      tone: "muted",
      ready: false,
      history: true,
      showBalance: false,
    };
  }

  if (status === "manual_review") {
    return {
      label: "Needs review",
      tone: "warning",
      ready: false,
      history: false,
      showBalance: false,
      message: "Settlement is delayed and needs operator review.",
    };
  }

  if (
    status === "source_failed" ||
    status === "quote_expired" ||
    status === "claim_expired_refundable"
  ) {
    return {
      label: "Unavailable",
      tone: "warning",
      ready: false,
      history: false,
      showBalance: false,
      message: "This payment is not currently claimable.",
    };
  }

  if (status === "status_unavailable") {
    return {
      label: "Status unavailable",
      tone: "warning",
      ready: false,
      history: false,
      showBalance: false,
      message: "Claim status could not be checked. Retrying automatically.",
    };
  }

  return {
    label: status ? "Settling" : "Checking",
    tone: status ? "brand" : "muted",
    ready: false,
    history: false,
    showBalance: false,
    message: status
      ? "The source payment is confirmed. Waiting for destination settlement."
      : undefined,
  };
}

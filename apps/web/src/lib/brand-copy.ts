export const LANDING_HEADLINE = ["Send from anywhere.", "Settle private."] as const;

export const LANDING_SUBHEAD =
  "Pay from any chain you hold. They claim private USDC on Starknet — then earn on Vesu.";

export const LANDING_INBOX_PROMPT = "Getting paid? Open your inbox.";

export const SITE_DESCRIPTION =
  "Send USDC from any chain. Claim private on Starknet. Earn on Vesu.";

export const TRUTH_LINE = "Source is public. Balance is private. Earn on Vesu.";

export const TRUTH_LINE_SHORT = "Source is public. Balance is private.";

export const QUOTE_PRIVACY_NOTE =
  "Source payment is public. Balance is private after claim.";

export const MAINNET_BANNER =
  "Mainnet uses real funds. Source deposit is public; claim is private.";

export const HOW_IT_WORKS_STEPS = [
  {
    title: "Type a handle.",
    body: "Email or @handle. No wallet addresses.",
  },
  {
    title: "Pay from any chain.",
    body: "Send USDC from a chain you already hold.",
  },
  {
    title: "They claim private — then earn.",
    body: "Inbox → private USDC on Starknet → Vesu.",
  },
] as const;

export const HOW_IT_WORKS_DEMO_NOTE = "Claim → private USDC · Earn on Vesu";

export const PAGE_SUBTITLES = {
  send: "Pay an email or @handle from any chain. Settles to private USDC.",
  inbox: "Payments ready to claim into private USDC.",
  claim: "Move inbox payments into your private balance.",
  account: "Handles, Ready Wallet, Private Balance, Earn.",
  status: "Route health only. No personal data.",
  privacy: "What stays private — and what doesn’t.",
  activity: "Public workflow only. No private payment fields.",
  mainnetDemo: "Three Mainnet steps through private USDC.",
} as const;

/** Prefer TOAST.* for new toast copy; aliases kept for existing imports. */
export const TOAST = {
  settledInbox: "Settled privately — payment is in their inbox",
  settledStarknet: "Settled privately on Starknet",
  claimed: "Claimed into your private USDC balance",
  sendUnlocked: "Ready request closed — you can send again",
  invalidRecipient: "Enter a valid @handle or email",
  readyConnected: (net: "Mainnet" | "Testnet") => `Ready connected on ${net}`,
  sourceConnected: (label: string) => `${label} wallet connected`,
  networkBlocked: "Finish or cancel the open Ready request, then switch networks",
  unlockInboxFirst: "Unlock your inbox on Inbox, then claim",
  signedIn: "Signed in",
  signInFailed: "Couldn’t sign in — try again",
  codeSent: "Code sent — check your email",
  codeSendFailed: "Couldn’t send code — try again",
  codeVerifyFailed: "Couldn’t verify code — try again",
  signedOut: "Signed out of Wotta",
  signOutFailed: "Couldn’t sign out — try again",
  walletDisconnected: "Wallet disconnected",
  addressCopied: "Address copied",
  addressCopyFailed: "Couldn’t copy address",
  switchedMainnet: "Switched to Mainnet",
  switchedTestnet: "Switched to Testnet",
  readyLinked: "Ready wallet linked",
  readyReconnected: "Ready wallet reconnected",
  readyMainnetLinked: "Ready Mainnet wallet linked",
  readyMainnetReconnected: "Ready Mainnet wallet reconnected",
  readyLinkedWithIdentity: "Ready wallet and private identity linked",
  identityUpgrading: "Updating private identity…",
  connectReadyFailed: "Couldn’t connect Ready",
  privateRegistrationFailed: "Couldn’t finish private registration",
  readyUnlinked: "Ready wallet unlinked",
  unlinkWalletFailed: "Couldn’t unlink wallet — try again",
  linkReadyToReveal: "Link Ready to reveal your private balance",
  signInToManageHandles: "Sign in to manage handles",
  continueLinking: "Continue linking in the provider window",
  linkAccountFailed: "Couldn’t link account — try again",
  unlinkFailed: "Couldn’t unlink — try again",
  keepOneSignIn: "Keep at least one sign-in method on this account",
  emailUnlinked: "Email unlinked",
  googleUnlinked: "Google unlinked",
  xUnlinked: "X unlinked — Wotta handle cleared",
  inboxLoadFailed: "Couldn’t load inbox — try again",
  inboxUnlockFailed: "Couldn’t unlock inbox — reconnect Ready",
  registrationLoadFailed: "Couldn’t load registration — try again",
  accountRefreshFailed: "Couldn’t refresh account — try again",
  somethingWrong: "Something went wrong — try again",
} as const;

export const SETTLED_PRIVATELY = TOAST.settledStarknet;

export const SETTLED_PRIVATELY_INBOX = TOAST.settledInbox;

export const SUCCESS_NOTE_PIPELINE =
  "Settled privately → inbox → private claim";

export const MAINNET_NAV_CONFIRM =
  "Mainnet uses real funds. Source is public; private sends on Starknet.";

export const ACCOUNT_EARN_HINT = "Earn on Vesu from your private balance.";

export const CHECKING_PRIVATE_CLAIM_ROUTE = "Checking private claim route.";

export const PRIVATE_CLAIM_ROUTE_UNVERIFIED =
  "Private claims stay disabled until the private claim route is verified.";

import type {
  OpenNoteDeposit,
  PreparedCallMeta,
  SmokeFlowId,
  NormalizedStrk20Action,
} from "./types.ts";

type RawAction = {
  type: string;
  token?: string;
  amount?: string;
  recipient?: string;
  contract?: string;
  calldata?: unknown[];
};

type RawProof = {
  data?: string;
  output?: unknown[];
  proof_facts?: unknown[];
};

type RawPrepared = {
  call?: {
    contract_address?: string;
    entry_point?: string;
    calldata?: unknown[];
  };
  proof?: RawProof;
};

type ReceiptLike = {
  events?: Array<{
    data?: unknown[];
  }>;
};

export function normalizeActions(actions: RawAction[]): NormalizedStrk20Action[] {
  return actions.map((action) => {
    if (action.type === "transfer") {
      return {
        type: "transfer",
        token: String(action.token ?? ""),
        amount: String(action.amount ?? ""),
        recipient: String(action.recipient ?? ""),
      };
    }
    if (action.type === "invoke") {
      return {
        type: "invoke",
        contract: String(action.contract ?? ""),
        calldata: (action.calldata ?? []).map((item) => String(item)),
      };
    }
    if (action.type === "deposit" || action.type === "withdraw") {
      const normalized: NormalizedStrk20Action = {
        type: action.type,
        token: String(action.token ?? ""),
        amount: String(action.amount ?? ""),
      };
      if (action.recipient !== undefined) {
        normalized.recipient = String(action.recipient);
      }
      return normalized;
    }
    throw new Error(`unsupported STRK20 action type: ${action.type}`);
  });
}

export function isEmptySimulatedProof(proof: RawProof): boolean {
  return (
    (proof.data ?? "") === "" &&
    (proof.output?.length ?? 0) === 0 &&
    (proof.proof_facts?.length ?? 0) === 0
  );
}

export function normalizePreparedCall(prepared: RawPrepared): PreparedCallMeta {
  const call = prepared.call ?? {};
  return {
    contractAddress: String(call.contract_address ?? ""),
    entryPoint: String(call.entry_point ?? ""),
    calldataLength: call.calldata?.length ?? 0,
    emptyProof: isEmptySimulatedProof(prepared.proof ?? {}),
  };
}

export function expectedNoteDepositsForFlow(
  flow: SmokeFlowId,
  input: { token: string; amount: string },
): OpenNoteDeposit[] {
  if (flow !== "claim_release") return [];
  return [
    {
      noteId: "${openNoteIds[0]}",
      token: input.token,
      amount: input.amount,
    },
  ];
}

export function decodeOpenNoteDeposits(raw: unknown): OpenNoteDeposit[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];

  if (typeof raw[0] === "object" && raw[0] !== null) {
    return raw.map((entry) => {
      const row = entry as Record<string, unknown>;
      return {
        noteId: String(row.note_id ?? row.noteId ?? ""),
        token: String(row.token ?? ""),
        amount: String(row.amount ?? ""),
      };
    });
  }

  const felts = raw.map((item) => String(item));
  const count = Number(BigInt(felts[0] ?? "0x0"));
  if (!Number.isFinite(count) || count < 0) {
    throw new Error("invalid OpenNoteDeposit span length");
  }
  const deposits: OpenNoteDeposit[] = [];
  let offset = 1;
  for (let index = 0; index < count; index += 1) {
    const noteId = felts[offset];
    const token = felts[offset + 1];
    const amount = felts[offset + 2];
    if (noteId === undefined || token === undefined || amount === undefined) {
      throw new Error("truncated OpenNoteDeposit span");
    }
    deposits.push({ noteId, token, amount });
    offset += 3;
  }
  return deposits;
}

export function decodeOpenNoteDepositsFromReceipt(
  receipt: unknown,
): OpenNoteDeposit[] {
  const events = (receipt as ReceiptLike | null)?.events;
  if (!Array.isArray(events) || events.length === 0) return [];

  const decoded: OpenNoteDeposit[] = [];
  for (const event of events) {
    const data = event?.data;
    if (!Array.isArray(data) || data.length < 4) continue;
    try {
      const deposits = decodeOpenNoteDeposits(data);
      if (deposits.length > 0) decoded.push(...deposits);
    } catch {
      // Best effort only: unrelated events are expected in the receipt.
    }
  }
  return decoded;
}

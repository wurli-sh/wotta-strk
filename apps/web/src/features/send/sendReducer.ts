export type SendStage =
  | "idle"
  | "resolving"
  | "quoting"
  | "ready"
  | "approving"
  | "submitting"
  | "delivering"
  | "complete"
  | "error";

export {
  NOX_ROUTE_ID,
  PUBLIC_DEFAULT_ROUTE_ID,
} from "./routeIds.ts";
import {
  NOX_ROUTE_ID,
  PUBLIC_DEFAULT_ROUTE_ID,
} from "./routeIds.ts";

export type SendState = {
  stage: SendStage;
  to: string;
  routeId: string;
  amount: string;
  confidentialMode: boolean;
  error: string | null;
  intentId: string | null;
  accessToken: string | null;
  sourceTx: string | null;
  recoveryUrl: string | null;
  grossDebit: string | null;
  maxFee: string | null;
  bearerMode: boolean;
  deliveryError: string | null;
};

export type SendAction =
  | { type: "patch"; patch: Partial<SendState> }
  | { type: "resetQuote" }
  | { type: "setConfidentialMode"; enabled: boolean }
  | { type: "error"; message: string };

export const initialSendState: SendState = {
  stage: "idle",
  to: "",
  routeId: PUBLIC_DEFAULT_ROUTE_ID,
  amount: "1",
  confidentialMode: false,
  error: null,
  intentId: null,
  accessToken: null,
  sourceTx: null,
  recoveryUrl: null,
  grossDebit: null,
  maxFee: null,
  bearerMode: false,
  deliveryError: null,
};

export function sendReducer(state: SendState, action: SendAction): SendState {
  switch (action.type) {
    case "patch":
      return { ...state, ...action.patch };
    case "resetQuote":
      return {
        ...state,
        stage: state.stage === "complete" ? state.stage : "idle",
        intentId: null,
        accessToken: null,
        sourceTx: null,
        grossDebit: null,
        maxFee: null,
        error: null,
        deliveryError: null,
      };
    case "setConfidentialMode": {
      const next = {
        ...state,
        confidentialMode: action.enabled,
        routeId: action.enabled ? NOX_ROUTE_ID : PUBLIC_DEFAULT_ROUTE_ID,
      };
      if (state.stage === "complete") return next;
      return {
        ...next,
        stage: "idle",
        intentId: null,
        accessToken: null,
        sourceTx: null,
        grossDebit: null,
        maxFee: null,
        error: null,
        deliveryError: null,
        recoveryUrl: null,
        bearerMode: false,
      };
    }
    case "error":
      return { ...state, stage: "error", error: action.message };
    default:
      return state;
  }
}

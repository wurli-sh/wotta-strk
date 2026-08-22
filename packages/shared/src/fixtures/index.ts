import protocolFixtures from "./generated/protocol-fixtures.json" with { type: "json" };

export const PROTOCOL_FIXTURES = protocolFixtures;

export type ProtocolFixtures = typeof protocolFixtures;

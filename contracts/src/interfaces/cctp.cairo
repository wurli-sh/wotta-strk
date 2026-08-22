use crate::libraries::types::ClaimRecord;

#[starknet::interface]
pub trait IMessageTransmitterV2<TContractState> {
    fn receive_message(
        ref self: TContractState, message: ByteArray, attestation: ByteArray,
    ) -> bool;
}

#[starknet::interface]
pub trait IWottaEscrowPool<TContractState> {
    fn deposit_public(
        ref self: TContractState,
        claim_hash: felt252,
        refund_recipient: starknet::ContractAddress,
        expires_at: u64,
    );
    fn fund_from_router(
        ref self: TContractState,
        claim_hash: felt252,
        refund_recipient: starknet::ContractAddress,
        expires_at: u64,
    );
    fn refund_public(ref self: TContractState, claim_hash: felt252);
    fn claim(self: @TContractState, claim_hash: felt252) -> ClaimRecord;
    fn denomination(self: @TContractState) -> u128;
    fn privacy_pool(self: @TContractState) -> starknet::ContractAddress;
    fn usdc(self: @TContractState) -> starknet::ContractAddress;
    fn router(self: @TContractState) -> starknet::ContractAddress;
    /// Total USDC reserved for claims which have not been claimed or refunded.
    ///
    /// This is a solvency invariant, not a user balance: all Wotta escrow pools
    /// use one immutable denomination, so every live claim reserves exactly one
    /// denomination of USDC.
    fn outstanding_liability(self: @TContractState) -> u256;
}

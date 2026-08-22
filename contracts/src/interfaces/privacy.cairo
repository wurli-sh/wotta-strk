use crate::libraries::types::OpenNoteDeposit;

#[starknet::interface]
pub trait IPrivacyInvoke<TContractState> {
    fn privacy_invoke(
        ref self: TContractState,
        action: u8,
        claim_hash: felt252,
        public_refund_recipient: starknet::ContractAddress,
        private_refund_hash: felt252,
        expires_at: u64,
        secret: felt252,
        note_id: felt252,
        provided_amount: u128,
    ) -> Span<OpenNoteDeposit>;
}

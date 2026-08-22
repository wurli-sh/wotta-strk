#[starknet::interface]
pub trait IPrivacyPoolHarness<TContractState> {
    fn fund_private(
        ref self: TContractState,
        escrow: starknet::ContractAddress,
        claim_hash: felt252,
        refund_hash: felt252,
        expires_at: u64,
        amount: u128,
    );
    fn invoke_unbacked_fund(
        ref self: TContractState,
        escrow: starknet::ContractAddress,
        claim_hash: felt252,
        refund_hash: felt252,
        expires_at: u64,
        amount: u128,
    );
    fn claim_private(
        ref self: TContractState,
        escrow: starknet::ContractAddress,
        claim_secret: felt252,
        note_id: felt252,
    );
    fn refund_private(
        ref self: TContractState,
        escrow: starknet::ContractAddress,
        refund_secret: felt252,
        note_id: felt252,
    );
    fn last_open_note_id(self: @TContractState) -> felt252;
}

/// Test-only model of the STRK20 pool's relevant ordering:
/// `TransferTo(escrow)` is applied before `Invoke(escrow.privacy_invoke)`, and
/// an `OpenNoteDeposit` returned by the escrow is collected with `transfer_from`.
#[starknet::contract]
pub mod MockPrivacyPool {
    use core::num::traits::Zero;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, contract_address_const, get_contract_address};

    use crate::interfaces::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};
    use crate::interfaces::privacy::{IPrivacyInvokeDispatcher, IPrivacyInvokeDispatcherTrait};
    use crate::libraries::types::{CLAIM, PRIVATE_FUND, PRIVATE_REFUND, OpenNoteDeposit};
    use super::IPrivacyPoolHarness;

    #[storage]
    struct Storage {
        usdc: ContractAddress,
        last_open_note_id: felt252,
    }

    #[constructor]
    fn constructor(ref self: ContractState, usdc: ContractAddress) {
        self.usdc.write(usdc);
    }

    #[abi(embed_v0)]
    impl HarnessImpl of IPrivacyPoolHarness<ContractState> {
        fn fund_private(
            ref self: ContractState,
            escrow: ContractAddress,
            claim_hash: felt252,
            refund_hash: felt252,
            expires_at: u64,
            amount: u128,
        ) {
            let token = IERC20Dispatcher { contract_address: self.usdc.read() };
            let paid = token.transfer(escrow, amount.into());
            assert(paid, 'TRANSFER');
            invoke_fund(ref self, escrow, claim_hash, refund_hash, expires_at, amount);
        }

        fn invoke_unbacked_fund(
            ref self: ContractState,
            escrow: ContractAddress,
            claim_hash: felt252,
            refund_hash: felt252,
            expires_at: u64,
            amount: u128,
        ) {
            invoke_fund(ref self, escrow, claim_hash, refund_hash, expires_at, amount);
        }

        fn claim_private(
            ref self: ContractState,
            escrow: ContractAddress,
            claim_secret: felt252,
            note_id: felt252,
        ) {
            let helper = IPrivacyInvokeDispatcher { contract_address: escrow };
            let deposits = helper.privacy_invoke(
                CLAIM,
                0,
                contract_address_const::<0>(),
                0,
                0,
                claim_secret,
                note_id,
                0,
            );
            collect_open_note(ref self, escrow, deposits);
        }

        fn refund_private(
            ref self: ContractState,
            escrow: ContractAddress,
            refund_secret: felt252,
            note_id: felt252,
        ) {
            let helper = IPrivacyInvokeDispatcher { contract_address: escrow };
            let deposits = helper.privacy_invoke(
                PRIVATE_REFUND,
                0,
                contract_address_const::<0>(),
                0,
                0,
                refund_secret,
                note_id,
                0,
            );
            collect_open_note(ref self, escrow, deposits);
        }

        fn last_open_note_id(self: @ContractState) -> felt252 {
            self.last_open_note_id.read()
        }
    }

    fn invoke_fund(
        ref self: ContractState,
        escrow: ContractAddress,
        claim_hash: felt252,
        refund_hash: felt252,
        expires_at: u64,
        amount: u128,
    ) {
        let helper = IPrivacyInvokeDispatcher { contract_address: escrow };
        let deposits = helper.privacy_invoke(
            PRIVATE_FUND,
            claim_hash,
            contract_address_const::<0>(),
            refund_hash,
            expires_at,
            0,
            0,
            amount,
        );
        assert(deposits.is_empty(), 'FUND_DEPOSITS');
    }

    fn collect_open_note(
        ref self: ContractState, escrow: ContractAddress, deposits: Span<OpenNoteDeposit>
    ) {
        assert(deposits.len() == 1, 'BAD_DEPOSITS');
        let deposit = *deposits.at(0);
        assert(deposit.token == self.usdc.read(), 'BAD_TOKEN');
        assert(!deposit.note_id.is_zero(), 'ZERO_NOTE');

        let token = IERC20Dispatcher { contract_address: deposit.token };
        let pulled = token.transfer_from(escrow, get_contract_address(), deposit.amount.into());
        assert(pulled, 'TRANSFER_FROM');
        self.last_open_note_id.write(deposit.note_id);
    }
}

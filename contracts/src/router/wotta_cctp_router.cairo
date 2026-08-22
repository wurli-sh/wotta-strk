#[starknet::interface]
pub trait IWottaCctpRouter<TContractState> {
    fn settle(ref self: TContractState, message: ByteArray, attestation: ByteArray);
    fn processed(self: @TContractState, intent_id: felt252) -> bool;
    fn message_transmitter(self: @TContractState) -> starknet::ContractAddress;
    fn token_messenger(self: @TContractState) -> starknet::ContractAddress;
    fn usdc(self: @TContractState) -> starknet::ContractAddress;
}

#[starknet::contract]
pub mod WottaCctpRouter {
    use core::num::traits::Zero;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_contract_address};

    use crate::interfaces::cctp::{
        IMessageTransmitterV2Dispatcher, IMessageTransmitterV2DispatcherTrait,
        IWottaEscrowPoolDispatcher, IWottaEscrowPoolDispatcherTrait,
    };
    use crate::interfaces::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};
    use crate::libraries::cctp_codec;
    use crate::libraries::types::{CctpMessageV2, FUNDING_CCTP, denomination_code_to_amount};
    use super::IWottaCctpRouter;

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Settled: Settled,
        UnderfundedRefunded: UnderfundedRefunded,
        SurplusRefunded: SurplusRefunded,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Settled {
        pub intent_id: felt252,
        pub claim_hash: felt252,
        pub denomination: u128,
        pub received_amount: u128,
        pub funding_kind: u8,
    }

    #[derive(Drop, starknet::Event)]
    pub struct UnderfundedRefunded {
        pub intent_id: felt252,
        pub received_amount: u128,
        pub refund_recipient: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct SurplusRefunded {
        pub intent_id: felt252,
        pub surplus_amount: u128,
        pub refund_recipient: ContractAddress,
    }

    #[storage]
    struct Storage {
        messenger: ContractAddress,
        usdc: ContractAddress,
        token_messenger: ContractAddress,
        processed_intents: Map<felt252, bool>,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        messenger: ContractAddress,
        usdc: ContractAddress,
        token_messenger: ContractAddress,
    ) {
        self.messenger.write(messenger);
        self.usdc.write(usdc);
        self.token_messenger.write(token_messenger);
    }

    #[abi(embed_v0)]
    impl RouterImpl of IWottaCctpRouter<ContractState> {
        fn settle(ref self: ContractState, message: ByteArray, attestation: ByteArray) {
            let decoded = cctp_codec::decode(@message);
            validate_bindings(@self, decoded);

            assert(!self.processed_intents.read(decoded.hook.intent_id), 'INTENT_USED');
            let token = IERC20Dispatcher { contract_address: self.usdc.read() };
            let before = token.balance_of(get_contract_address());

            let messenger = IMessageTransmitterV2Dispatcher {
                contract_address: self.messenger.read(),
            };
            let ok = messenger.receive_message(message, attestation);
            assert(ok, 'RECEIVE_FAIL');

            let after = token.balance_of(get_contract_address());
            let received_u256 = after - before;
            let received: u128 = received_u256.try_into().unwrap();
            let denomination = denomination_code_to_amount(decoded.hook.denomination_code);

            self.processed_intents.write(decoded.hook.intent_id, true);

            if received < denomination {
                if received > 0 {
                    let refunded = token
                        .transfer(decoded.hook.public_refund_recipient, received.into());
                    assert(refunded, 'REFUND_FAIL');
                }
                self
                    .emit(
                        Event::UnderfundedRefunded(
                            UnderfundedRefunded {
                                intent_id: decoded.hook.intent_id,
                                received_amount: received,
                                refund_recipient: decoded.hook.public_refund_recipient,
                            },
                        ),
                    );
                return;
            }

            let approved = token.approve(decoded.hook.escrow_pool, denomination.into());
            assert(approved, 'APPROVE_FAIL');

            let pool = IWottaEscrowPoolDispatcher {
                contract_address: decoded.hook.escrow_pool,
            };
            pool
                .fund_from_router(
                    decoded.hook.claim_hash,
                    decoded.hook.public_refund_recipient,
                    decoded.hook.expires_at,
                );

            let surplus = received - denomination;
            if surplus > 0 {
                let refunded = token
                    .transfer(decoded.hook.public_refund_recipient, surplus.into());
                assert(refunded, 'SURPLUS_FAIL');
                self
                    .emit(
                        Event::SurplusRefunded(
                            SurplusRefunded {
                                intent_id: decoded.hook.intent_id,
                                surplus_amount: surplus,
                                refund_recipient: decoded.hook.public_refund_recipient,
                            },
                        ),
                    );
            }

            self
                .emit(
                    Event::Settled(
                        Settled {
                            intent_id: decoded.hook.intent_id,
                            claim_hash: decoded.hook.claim_hash,
                            denomination,
                            received_amount: received,
                            funding_kind: FUNDING_CCTP,
                        },
                    ),
                );
        }

        fn processed(self: @ContractState, intent_id: felt252) -> bool {
            self.processed_intents.read(intent_id)
        }

        fn message_transmitter(self: @ContractState) -> ContractAddress {
            self.messenger.read()
        }

        fn token_messenger(self: @ContractState) -> ContractAddress {
            self.token_messenger.read()
        }

        fn usdc(self: @ContractState) -> ContractAddress {
            self.usdc.read()
        }
    }

    fn validate_bindings(self: @ContractState, decoded: CctpMessageV2) {
        assert(decoded.destination_domain == cctp_codec::STARKNET_DOMAIN, 'BAD_DEST_DOMAIN');
        assert(decoded.recipient == self.token_messenger.read(), 'BAD_RECIPIENT');
        assert(decoded.mint_recipient == get_contract_address(), 'BAD_MINT_RECIP');
        assert(decoded.destination_caller == get_contract_address(), 'BAD_DEST_CALL');
        assert(!decoded.hook.escrow_pool.is_zero(), 'BAD_POOL');

        let pool = IWottaEscrowPoolDispatcher { contract_address: decoded.hook.escrow_pool };
        assert(pool.router() == get_contract_address(), 'POOL_ROUTER');
        assert(pool.usdc() == self.usdc.read(), 'POOL_USDC');
        assert(
            pool.denomination() == denomination_code_to_amount(decoded.hook.denomination_code),
            'POOL_DENOM',
        );
        assert(!pool.privacy_pool().is_zero(), 'POOL_PRIVACY');
    }
}

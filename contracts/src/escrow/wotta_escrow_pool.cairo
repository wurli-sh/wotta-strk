#[starknet::contract]
pub mod WottaEscrowPool {
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use core::num::traits::Zero;
    use starknet::{ContractAddress, get_block_timestamp, get_caller_address, get_contract_address};

    use crate::interfaces::cctp::IWottaEscrowPool;
    use crate::interfaces::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};
    use crate::interfaces::privacy::IPrivacyInvoke;
    use crate::libraries::claim_hash::{claim_hash as compute_claim_hash, refund_hash as compute_refund_hash};
    use crate::libraries::types::{
        ClaimRecord, OpenNoteDeposit, CLAIM, FUNDING_CCTP, FUNDING_PRIVATE, FUNDING_PUBLIC_DIRECT,
        PRIVATE_FUND, PRIVATE_REFUND, STATUS_CLAIMED, STATUS_FUNDED, STATUS_NONE, STATUS_REFUNDED,
        is_supported_denomination,
    };

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        PublicDeposited: PublicDeposited,
        RouterFunded: RouterFunded,
        PrivateFunded: PrivateFunded,
        Claimed: Claimed,
        Refunded: Refunded,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PublicDeposited {
        pub claim_hash: felt252,
        pub denomination: u128,
        pub expires_at: u64,
        pub funding_kind: u8,
    }

    #[derive(Drop, starknet::Event)]
    pub struct RouterFunded {
        pub claim_hash: felt252,
        pub denomination: u128,
        pub expires_at: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PrivateFunded {
        pub claim_hash: felt252,
        pub denomination: u128,
        pub expires_at: u64,
        pub refund_hash: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Claimed {
        pub claim_hash: felt252,
        pub denomination: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Refunded {
        pub claim_hash: felt252,
        pub denomination: u128,
        pub funding_kind: u8,
    }

    #[storage]
    struct Storage {
        privacy_pool: ContractAddress,
        usdc: ContractAddress,
        router: ContractAddress,
        denomination: u128,
        chain_id: felt252,
        claims: Map<felt252, ClaimRecord>,
        private_refund_to_claim: Map<felt252, felt252>,
        outstanding_liability: u256,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        privacy_pool: ContractAddress,
        usdc: ContractAddress,
        router: ContractAddress,
        denomination: u128,
        chain_id: felt252,
    ) {
        assert(is_supported_denomination(denomination), 'BAD_DENOM');
        assert(!privacy_pool.is_zero(), 'ZERO_PRIVACY');
        assert(!usdc.is_zero(), 'ZERO_USDC');
        self.privacy_pool.write(privacy_pool);
        self.usdc.write(usdc);
        self.router.write(router);
        self.denomination.write(denomination);
        self.chain_id.write(chain_id);
    }

    #[abi(embed_v0)]
    impl EscrowImpl of IWottaEscrowPool<ContractState> {
        fn deposit_public(
            ref self: ContractState,
            claim_hash: felt252,
            refund_recipient: ContractAddress,
            expires_at: u64,
        ) {
            assert(!claim_hash.is_zero(), 'ZERO_CLAIM');
            assert(!refund_recipient.is_zero(), 'ZERO_REFUND');
            assert_new_claim(@self, claim_hash);
            assert_future_expiry(expires_at);

            let token = IERC20Dispatcher { contract_address: self.usdc.read() };
            let denomination = self.denomination.read();
            reserve_liability(ref self, denomination);
            self
                .claims
                .write(
                    claim_hash,
                    ClaimRecord {
                        status: STATUS_FUNDED,
                        funding_kind: FUNDING_PUBLIC_DIRECT,
                        public_refund_recipient: refund_recipient,
                        private_refund_hash: 0,
                        expires_at,
                        funded_at: get_block_timestamp(),
                    },
                );
            let before = token.balance_of(get_contract_address());
            let ok = token
                .transfer_from(get_caller_address(), get_contract_address(), denomination.into());
            assert(ok, 'TRANSFER_FROM');
            let after = token.balance_of(get_contract_address());
            assert(after - before == denomination.into(), 'BAD_DELTA');
            assert_collateralized(@self);

            self
                .emit(
                    Event::PublicDeposited(
                        PublicDeposited {
                            claim_hash: claim_hash,
                            denomination,
                            expires_at,
                            funding_kind: FUNDING_PUBLIC_DIRECT,
                        },
                    ),
                );
        }

        fn fund_from_router(
            ref self: ContractState,
            claim_hash: felt252,
            refund_recipient: ContractAddress,
            expires_at: u64,
        ) {
            assert(get_caller_address() == self.router.read(), 'ONLY_ROUTER');
            assert(!claim_hash.is_zero(), 'ZERO_CLAIM');
            assert(!refund_recipient.is_zero(), 'ZERO_REFUND');
            assert_new_claim(@self, claim_hash);
            assert_future_expiry(expires_at);

            let token = IERC20Dispatcher { contract_address: self.usdc.read() };
            let denomination = self.denomination.read();
            reserve_liability(ref self, denomination);
            self
                .claims
                .write(
                    claim_hash,
                    ClaimRecord {
                        status: STATUS_FUNDED,
                        funding_kind: FUNDING_CCTP,
                        public_refund_recipient: refund_recipient,
                        private_refund_hash: 0,
                        expires_at,
                        funded_at: get_block_timestamp(),
                    },
                );
            let before = token.balance_of(get_contract_address());
            let ok = token
                .transfer_from(get_caller_address(), get_contract_address(), denomination.into());
            assert(ok, 'TRANSFER_FROM');
            let after = token.balance_of(get_contract_address());
            assert(after - before == denomination.into(), 'BAD_DELTA');
            assert_collateralized(@self);

            self
                .emit(
                    Event::RouterFunded(
                        RouterFunded {
                            claim_hash: claim_hash, denomination, expires_at,
                        },
                    ),
                );
        }

        fn refund_public(ref self: ContractState, claim_hash: felt252) {
            let record = self.claims.read(claim_hash);
            assert(record.status == STATUS_FUNDED, 'NOT_FUNDED');
            assert(record.funding_kind != FUNDING_PRIVATE, 'ONLY_PUBLIC');
            assert(record.expires_at <= get_block_timestamp(), 'NOT_EXPIRED');
            release_liability(ref self, self.denomination.read());

            self
                .claims
                .write(
                    claim_hash,
                    ClaimRecord {
                        status: STATUS_REFUNDED,
                        funding_kind: record.funding_kind,
                        public_refund_recipient: record.public_refund_recipient,
                        private_refund_hash: record.private_refund_hash,
                        expires_at: record.expires_at,
                        funded_at: record.funded_at,
                    },
                );

            let token = IERC20Dispatcher { contract_address: self.usdc.read() };
            let ok = token
                .transfer(record.public_refund_recipient, self.denomination.read().into());
            assert(ok, 'TRANSFER');

            self
                .emit(
                    Event::Refunded(
                        Refunded {
                            claim_hash: claim_hash,
                            denomination: self.denomination.read(),
                            funding_kind: record.funding_kind,
                        },
                    ),
                );
        }

        fn claim(self: @ContractState, claim_hash: felt252) -> ClaimRecord {
            self.claims.read(claim_hash)
        }

        fn denomination(self: @ContractState) -> u128 {
            self.denomination.read()
        }

        fn privacy_pool(self: @ContractState) -> ContractAddress {
            self.privacy_pool.read()
        }

        fn usdc(self: @ContractState) -> ContractAddress {
            self.usdc.read()
        }

        fn router(self: @ContractState) -> ContractAddress {
            self.router.read()
        }

        fn outstanding_liability(self: @ContractState) -> u256 {
            self.outstanding_liability.read()
        }
    }

    #[abi(embed_v0)]
    impl PrivacyImpl of IPrivacyInvoke<ContractState> {
        fn privacy_invoke(
            ref self: ContractState,
            action: u8,
            claim_hash: felt252,
            public_refund_recipient: ContractAddress,
            private_refund_hash: felt252,
            expires_at: u64,
            secret: felt252,
            note_id: felt252,
            provided_amount: u128,
        ) -> Span<OpenNoteDeposit> {
            assert(get_caller_address() == self.privacy_pool.read(), 'ONLY_PRIVACY');

            if action == PRIVATE_FUND {
                assert(!claim_hash.is_zero(), 'ZERO_CLAIM');
                assert(!private_refund_hash.is_zero(), 'ZERO_REFUND_HASH');
                assert_new_claim(@self, claim_hash);
                assert(
                    self.private_refund_to_claim.read(private_refund_hash).is_zero(),
                    'REFUND_EXISTS',
                );
                assert_future_expiry(expires_at);
                assert(provided_amount == self.denomination.read(), 'BAD_AMOUNT');
                reserve_liability(ref self, self.denomination.read());
                assert_collateralized(@self);

                self
                    .claims
                    .write(
                        claim_hash,
                        ClaimRecord {
                            status: STATUS_FUNDED,
                            funding_kind: FUNDING_PRIVATE,
                            public_refund_recipient,
                            private_refund_hash,
                            expires_at,
                            funded_at: get_block_timestamp(),
                        },
                    );
                self.private_refund_to_claim.write(private_refund_hash, claim_hash);

                self
                    .emit(
                        Event::PrivateFunded(
                            PrivateFunded {
                                claim_hash: claim_hash,
                                denomination: self.denomination.read(),
                                expires_at,
                                refund_hash: private_refund_hash,
                            },
                        ),
                    );
                return array![].span();
            }

            if action == CLAIM {
                assert(!secret.is_zero(), 'ZERO_SECRET');
                assert(!note_id.is_zero(), 'ZERO_NOTE');
                let derived = compute_claim_hash(self.chain_id.read(), get_contract_address(), secret);
                assert(!derived.is_zero(), 'ZERO_CLAIM');
                let record = self.claims.read(derived);
                assert(record.status == STATUS_FUNDED, 'NOT_FUNDED');
                assert(record.expires_at > get_block_timestamp(), 'EXPIRED');
                release_liability(ref self, self.denomination.read());
                self
                    .claims
                    .write(
                        derived,
                        ClaimRecord {
                            status: STATUS_CLAIMED,
                            funding_kind: record.funding_kind,
                            public_refund_recipient: record.public_refund_recipient,
                            private_refund_hash: record.private_refund_hash,
                            expires_at: record.expires_at,
                            funded_at: record.funded_at,
                        },
                    );

                let token = IERC20Dispatcher { contract_address: self.usdc.read() };
                let approved = token
                    .approve(self.privacy_pool.read(), self.denomination.read().into());
                assert(approved, 'APPROVE');

                self
                    .emit(
                        Event::Claimed(
                            Claimed { claim_hash: derived, denomination: self.denomination.read() },
                        ),
                    );
                return array![
                    OpenNoteDeposit {
                        note_id, token: self.usdc.read(), amount: self.denomination.read(),
                    },
                ]
                    .span();
            }

            if action == PRIVATE_REFUND {
                assert(!secret.is_zero(), 'ZERO_SECRET');
                assert(!note_id.is_zero(), 'ZERO_NOTE');
                let derived_refund_hash = compute_refund_hash(
                    self.chain_id.read(), get_contract_address(), secret,
                );
                let claim_key = self.private_refund_to_claim.read(derived_refund_hash);
                assert(!claim_key.is_zero(), 'REFUND_UNKNOWN');
                let record = self.claims.read(claim_key);
                assert(record.private_refund_hash == derived_refund_hash, 'REFUND_MISMATCH');
                assert(record.funding_kind == FUNDING_PRIVATE, 'NOT_PRIVATE');
                assert(record.status == STATUS_FUNDED, 'NOT_FUNDED');
                assert(record.expires_at <= get_block_timestamp(), 'NOT_EXPIRED');
                release_liability(ref self, self.denomination.read());
                self
                    .claims
                    .write(
                        claim_key,
                        ClaimRecord {
                            status: STATUS_REFUNDED,
                            funding_kind: record.funding_kind,
                            public_refund_recipient: record.public_refund_recipient,
                            private_refund_hash: record.private_refund_hash,
                            expires_at: record.expires_at,
                            funded_at: record.funded_at,
                        },
                    );

                let token = IERC20Dispatcher { contract_address: self.usdc.read() };
                let approved = token
                    .approve(self.privacy_pool.read(), self.denomination.read().into());
                assert(approved, 'APPROVE');

                self
                    .emit(
                        Event::Refunded(
                            Refunded {
                                claim_hash: claim_key,
                                denomination: self.denomination.read(),
                                funding_kind: FUNDING_PRIVATE,
                            },
                        ),
                    );
                return array![
                    OpenNoteDeposit {
                        note_id, token: self.usdc.read(), amount: self.denomination.read(),
                    },
                ]
                    .span();
            }

            assert(false, 'BAD_ACTION');
            array![].span()
        }
    }

    fn assert_new_claim(self: @ContractState, claim_hash: felt252) {
        let existing = self.claims.read(claim_hash);
        assert(existing.status == STATUS_NONE, 'CLAIM_EXISTS');
    }

    fn assert_future_expiry(expires_at: u64) {
        assert(expires_at > get_block_timestamp(), 'BAD_EXPIRY');
    }

    /// Reserve one fixed-denomination claim before an external token transfer.
    /// If that transfer reverts, the state update reverts with it. This keeps
    /// duplicate/re-entrant funding from observing an unrecorded live claim.
    fn reserve_liability(ref self: ContractState, amount: u128) {
        let next = self.outstanding_liability.read() + amount.into();
        self.outstanding_liability.write(next);
    }

    /// Release exactly one fixed-denomination claim before authorizing the
    /// privacy pool (or public refund) to pull its backing USDC.
    fn release_liability(ref self: ContractState, amount: u128) {
        let current = self.outstanding_liability.read();
        let amount_u256: u256 = amount.into();
        assert(current >= amount_u256, 'LIABILITY');
        self.outstanding_liability.write(current - amount_u256);
    }

    /// A private fund is valid only once the preceding STRK20 withdrawal has
    /// actually collateralized the new live claim. The privacy pool executes
    /// withdrawals before its external `privacy_invoke` call; this check makes
    /// the ordering an on-chain solvency invariant and prevents a later claim
    /// from consuming funds reserved for an earlier live claim.
    fn assert_collateralized(self: @ContractState) {
        let token = IERC20Dispatcher { contract_address: self.usdc.read() };
        let balance = token.balance_of(get_contract_address());
        assert(balance >= self.outstanding_liability.read(), 'UNDERCOLLATERALIZED');
    }
}

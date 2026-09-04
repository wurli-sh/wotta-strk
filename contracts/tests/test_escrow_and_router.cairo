use snforge_std::{
    declare, start_cheat_chain_id_global, stop_cheat_chain_id_global, ContractClassTrait,
    DeclareResultTrait,
};
use starknet::{ContractAddress, contract_address_const};

use wotta_contracts::interfaces::cctp::{
    IWottaEscrowPoolDispatcher, IWottaEscrowPoolDispatcherTrait,
};
use wotta_contracts::interfaces::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};
use wotta_contracts::libraries::cctp_codec;
use wotta_contracts::libraries::claim_hash::{claim_hash, refund_hash};
use wotta_contracts::libraries::types::{
    DENOMINATION_1, HOOK_MAGIC, HOOK_MANIFEST_VERSION, HOOK_VERSION, STATUS_CLAIMED,
    STATUS_FUNDED, STATUS_REFUNDED, WottaHookV1,
};
use wotta_contracts::mocks::mock_privacy_pool::{
    IPrivacyPoolHarnessDispatcher, IPrivacyPoolHarnessDispatcherTrait,
};
use wotta_contracts::router::wotta_cctp_router::{
    IWottaCctpRouterDispatcher, IWottaCctpRouterDispatcherTrait,
};

fn deploy_token() -> ContractAddress {
    let class = declare("MockErc20").unwrap().contract_class();
    let (address, _) = class.deploy(@array![]).unwrap();
    address
}

fn deploy_pool(
    privacy: ContractAddress,
    usdc: ContractAddress,
    router: ContractAddress,
    denomination: u128,
) -> ContractAddress {
    let class = declare("WottaEscrowPool").unwrap().contract_class();
    let (address, _) = class
        .deploy(
            @array![privacy.into(), usdc.into(), router.into(), denomination.into(), 'SN_MAIN'],
        )
        .unwrap();
    address
}

fn deploy_privacy_pool(token: ContractAddress) -> ContractAddress {
    let class = declare("MockPrivacyPool").unwrap().contract_class();
    let (address, _) = class.deploy(@array![token.into()]).unwrap();
    address
}

fn deploy_messenger(token: ContractAddress) -> ContractAddress {
    let class = declare("MockCctpMessenger").unwrap().contract_class();
    let (address, _) = class.deploy(@array![token.into()]).unwrap();
    address
}

fn deploy_router(
    owner: ContractAddress, messenger: ContractAddress, usdc: ContractAddress,
) -> ContractAddress {
    let class = declare("WottaCctpRouter").unwrap().contract_class();
    let (address, _) = class
        .deploy(@array![owner.into(), messenger.into(), usdc.into(), messenger.into()])
        .unwrap();
    address
}

fn unpause_router(router: ContractAddress, owner: ContractAddress) {
    let router_disp = IWottaCctpRouterDispatcher { contract_address: router };
    snforge_std::start_cheat_caller_address(router, owner);
    router_disp.unpause();
    snforge_std::stop_cheat_caller_address(router);
}

fn deploy_active_router(
    owner: ContractAddress, messenger: ContractAddress, usdc: ContractAddress,
) -> ContractAddress {
    let router = deploy_router(owner, messenger, usdc);
    unpause_router(router, owner);
    router
}

#[test]
fn mainnet_router_deploys_paused_with_no_cctp_domains() {
    start_cheat_chain_id_global('SN_MAIN');
    let usdc = deploy_token();
    let messenger = deploy_messenger(usdc);
    let router = deploy_router(contract_address_const::<0xAAA>(), messenger, usdc);
    stop_cheat_chain_id_global();

    let router_disp = IWottaCctpRouterDispatcher { contract_address: router };
    assert(router_disp.paused(), 'NOT_PAUSED');
    assert(!router_disp.is_source_domain_admitted(5), 'SOLANA_ADMITTED');
    assert(!router_disp.is_source_domain_admitted(6), 'BASE_ADMITTED');
    assert(!router_disp.is_source_domain_admitted(0), 'ETH_ADMITTED');
    assert(!router_disp.is_source_domain_admitted(3), 'ARB_ADMITTED');
    assert(!router_disp.is_source_domain_admitted(27), 'STELLAR_ADMITTED');
}

#[test]
fn sepolia_router_preserves_existing_testnet_domains() {
    start_cheat_chain_id_global('SN_SEPOLIA');
    let usdc = deploy_token();
    let messenger = deploy_messenger(usdc);
    let owner = contract_address_const::<0xAAA>();
    let router = deploy_router(owner, messenger, usdc);
    stop_cheat_chain_id_global();

    let router_disp = IWottaCctpRouterDispatcher { contract_address: router };
    assert(router_disp.paused(), 'NOT_PAUSED');
    assert(router_disp.is_source_domain_admitted(0), 'ETH_NOT_ADMITTED');
    assert(router_disp.is_source_domain_admitted(3), 'ARB_NOT_ADMITTED');
    assert(router_disp.is_source_domain_admitted(5), 'SOLANA_NOT_ADMITTED');
    assert(router_disp.is_source_domain_admitted(6), 'BASE_NOT_ADMITTED');
    assert(router_disp.is_source_domain_admitted(27), 'STELLAR_NOT_ADMITTED');
}

#[test]
fn public_deposit_and_refund_after_expiry() {
    let usdc = deploy_token();
    let privacy = contract_address_const::<0x111>();
    let router = contract_address_const::<0x222>();
    let pool = deploy_pool(privacy, usdc, router, DENOMINATION_1);
    let depositor = contract_address_const::<0x333>();
    let refund = contract_address_const::<0x444>();

    let token = IERC20Dispatcher { contract_address: usdc };
    snforge_std::start_cheat_caller_address(usdc, depositor);
    token.mint(depositor, DENOMINATION_1.into());
    token.approve(pool, DENOMINATION_1.into());
    snforge_std::stop_cheat_caller_address(usdc);

    let pool_disp = IWottaEscrowPoolDispatcher { contract_address: pool };
    let claim = 0xabc;
    let now: u64 = 1_700_000_000;
    snforge_std::start_cheat_block_timestamp(pool, now);
    snforge_std::start_cheat_caller_address(pool, depositor);
    pool_disp.deposit_public(claim, refund, now + 100);
    snforge_std::stop_cheat_caller_address(pool);

    let funded = pool_disp.claim(claim);
    assert(funded.status == STATUS_FUNDED, 'not funded');

    snforge_std::start_cheat_block_timestamp(pool, now + 101);
    pool_disp.refund_public(claim);
    let refunded = pool_disp.claim(claim);
    assert(refunded.status == STATUS_REFUNDED, 'not refunded');
    assert(token.balance_of(refund) == DENOMINATION_1.into(), 'refund amount');
}

#[test]
#[should_panic(expected: ('ZERO_CLAIM',))]
fn public_deposit_rejects_zero_claim_commitment() {
    let usdc = deploy_token();
    let privacy = contract_address_const::<0x111>();
    let router = contract_address_const::<0x222>();
    let pool = deploy_pool(privacy, usdc, router, DENOMINATION_1);
    let depositor = contract_address_const::<0x333>();
    let refund = contract_address_const::<0x444>();
    let token = IERC20Dispatcher { contract_address: usdc };

    snforge_std::start_cheat_caller_address(usdc, depositor);
    token.mint(depositor, DENOMINATION_1.into());
    token.approve(pool, DENOMINATION_1.into());
    snforge_std::stop_cheat_caller_address(usdc);

    let pool_disp = IWottaEscrowPoolDispatcher { contract_address: pool };
    snforge_std::start_cheat_block_timestamp(pool, 1_700_000_000);
    snforge_std::start_cheat_caller_address(pool, depositor);
    pool_disp.deposit_public(0, refund, 1_700_000_100);
}

#[test]
fn cctp_settle_funds_pool_with_exact_amount() {
    let usdc = deploy_token();
    let privacy = contract_address_const::<0x111>();
    let messenger = deploy_messenger(usdc);
    let owner = contract_address_const::<0x999>();
    let router = deploy_active_router(owner, messenger, usdc);
    let pool = deploy_pool(privacy, usdc, router, DENOMINATION_1);
    let refund = contract_address_const::<0x444>();

    let token = IERC20Dispatcher { contract_address: usdc };

    let hook = WottaHookV1 {
        magic: HOOK_MAGIC,
        version: HOOK_VERSION,
        intent_id: 0x55,
        denomination_code: 0,
        escrow_pool: pool,
        claim_hash: 0x777,
        public_refund_recipient: refund,
        expires_at: 1_800_000_000,
        manifest_version: HOOK_MANIFEST_VERSION,
    };
    // Use source_domain=6 (Base) which is admitted by default in the constructor
    let encoded = cctp_codec::encode_for_test(6, messenger, router, DENOMINATION_1, hook);
    let mut attestation: ByteArray = Default::default();
    attestation.append_byte(1);

    let router_disp = IWottaCctpRouterDispatcher { contract_address: router };
    snforge_std::start_cheat_block_timestamp(pool, 1_700_000_000);
    router_disp.settle(encoded, attestation);

    let pool_disp = IWottaEscrowPoolDispatcher { contract_address: pool };
    let funded = pool_disp.claim(0x777);
    assert(funded.status == STATUS_FUNDED, 'cctp not funded');
    assert(router_disp.processed(0x55), 'intent not marked');
    assert(token.balance_of(pool) == DENOMINATION_1.into(), 'pool balance');
    assert(token.allowance(router, pool) == 0, 'allowance remains');
}

#[test]
fn claim_hash_domain_separated() {
    let pool = contract_address_const::<0x123>();
    let a = claim_hash('SN_MAIN', pool, 0x111);
    let b = refund_hash('SN_MAIN', pool, 0x111);
    assert(a != b, 'tags must differ');
}

#[test]
fn private_fund_is_collateralized_then_claimed_to_an_open_note() {
    let usdc = deploy_token();
    let privacy = deploy_privacy_pool(usdc);
    let pool = deploy_pool(privacy, usdc, contract_address_const::<0x222>(), DENOMINATION_1);
    let now: u64 = 1_700_000_000;
    let claim_secret = 0x1234;
    let refund_secret = 0x5678;
    let claim = claim_hash('SN_MAIN', pool, claim_secret);
    let refund = refund_hash('SN_MAIN', pool, refund_secret);
    let token = IERC20Dispatcher { contract_address: usdc };
    let privacy_disp = IPrivacyPoolHarnessDispatcher { contract_address: privacy };
    let pool_disp = IWottaEscrowPoolDispatcher { contract_address: pool };

    token.mint(privacy, DENOMINATION_1.into());
    snforge_std::start_cheat_block_timestamp(pool, now);
    privacy_disp.fund_private(pool, claim, refund, now + 100, DENOMINATION_1);

    let funded = pool_disp.claim(claim);
    assert(funded.status == STATUS_FUNDED, 'private not funded');
    assert(pool_disp.outstanding_liability() == DENOMINATION_1.into(), 'liability');
    assert(token.balance_of(pool) == DENOMINATION_1.into(), 'escrow backed');

    privacy_disp.claim_private(pool, claim_secret, 0xabc);

    let claimed = pool_disp.claim(claim);
    assert(claimed.status == STATUS_CLAIMED, 'not claimed');
    assert(pool_disp.outstanding_liability() == 0, 'liability released');
    assert(token.balance_of(pool) == 0, 'escrow released');
    assert(token.balance_of(privacy) == DENOMINATION_1.into(), 'open note funded');
    assert(privacy_disp.last_open_note_id() == 0xabc, 'note id');
}

#[test]
#[should_panic(expected: ('UNDERCOLLATERALIZED',))]
fn private_fund_requires_the_preceding_pool_withdrawal() {
    let usdc = deploy_token();
    let privacy = deploy_privacy_pool(usdc);
    let pool = deploy_pool(privacy, usdc, contract_address_const::<0x222>(), DENOMINATION_1);
    let privacy_disp = IPrivacyPoolHarnessDispatcher { contract_address: privacy };

    snforge_std::start_cheat_block_timestamp(pool, 1_700_000_000);
    privacy_disp.invoke_unbacked_fund(pool, 0xaaa, 0xbbb, 1_700_000_100, DENOMINATION_1);
}

#[test]
fn expired_private_fund_can_refund_only_to_an_open_note() {
    let usdc = deploy_token();
    let privacy = deploy_privacy_pool(usdc);
    let pool = deploy_pool(privacy, usdc, contract_address_const::<0x222>(), DENOMINATION_1);
    let now: u64 = 1_700_000_000;
    let claim_secret = 0x8888;
    let refund_secret = 0x9999;
    let claim = claim_hash('SN_MAIN', pool, claim_secret);
    let refund = refund_hash('SN_MAIN', pool, refund_secret);
    let token = IERC20Dispatcher { contract_address: usdc };
    let privacy_disp = IPrivacyPoolHarnessDispatcher { contract_address: privacy };
    let pool_disp = IWottaEscrowPoolDispatcher { contract_address: pool };

    token.mint(privacy, DENOMINATION_1.into());
    snforge_std::start_cheat_block_timestamp(pool, now);
    privacy_disp.fund_private(pool, claim, refund, now + 100, DENOMINATION_1);

    snforge_std::start_cheat_block_timestamp(pool, now + 100);
    privacy_disp.refund_private(pool, refund_secret, 0xdef);

    let refunded = pool_disp.claim(claim);
    assert(refunded.status == STATUS_REFUNDED, 'not refunded');
    assert(pool_disp.outstanding_liability() == 0, 'liability released');
    assert(token.balance_of(pool) == 0, 'escrow released');
    assert(token.balance_of(privacy) == DENOMINATION_1.into(), 'refund note funded');
    assert(privacy_disp.last_open_note_id() == 0xdef, 'note id');
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2: adversarial router tests
// ─────────────────────────────────────────────────────────────────────────────

fn make_hook(intent_id: felt252, pool: ContractAddress, refund: ContractAddress) -> WottaHookV1 {
    WottaHookV1 {
        magic: HOOK_MAGIC,
        version: HOOK_VERSION,
        intent_id,
        denomination_code: 0,
        escrow_pool: pool,
        claim_hash: 0x777,
        public_refund_recipient: refund,
        expires_at: 1_800_000_000,
        manifest_version: HOOK_MANIFEST_VERSION,
    }
}

#[test]
#[should_panic(expected: ('PAUSED',))]
fn settle_fails_when_paused() {
    let usdc = deploy_token();
    let privacy = contract_address_const::<0x111>();
    let messenger = deploy_messenger(usdc);
    let owner = contract_address_const::<0xAAA>();
    let router = deploy_router(owner, messenger, usdc);
    let pool = deploy_pool(privacy, usdc, router, DENOMINATION_1);
    let refund = contract_address_const::<0x444>();

    // Constructor leaves the router paused; settle must fail closed.
    let router_disp = IWottaCctpRouterDispatcher { contract_address: router };
    let hook = make_hook(0x60, pool, refund);
    let encoded = cctp_codec::encode_for_test(6, messenger, router, DENOMINATION_1, hook);
    let mut attestation: ByteArray = Default::default();
    attestation.append_byte(1);
    snforge_std::start_cheat_block_timestamp(pool, 1_700_000_000);
    router_disp.settle(encoded, attestation);
}

#[test]
#[should_panic(expected: ('BAD_SOURCE_DOMAIN',))]
fn settle_fails_for_unadmitted_source_domain() {
    let usdc = deploy_token();
    let privacy = contract_address_const::<0x111>();
    let messenger = deploy_messenger(usdc);
    let owner = contract_address_const::<0xAAA>();
    let router = deploy_active_router(owner, messenger, usdc);
    let pool = deploy_pool(privacy, usdc, router, DENOMINATION_1);
    let refund = contract_address_const::<0x444>();

    let router_disp = IWottaCctpRouterDispatcher { contract_address: router };

    // source_domain=7 is not a supported Circle route in either environment.
    let hook = make_hook(0x61, pool, refund);
    let encoded = cctp_codec::encode_for_test(7, messenger, router, DENOMINATION_1, hook);
    let mut attestation: ByteArray = Default::default();
    attestation.append_byte(1);
    snforge_std::start_cheat_block_timestamp(pool, 1_700_000_000);
    router_disp.settle(encoded, attestation);
}

#[test]
#[should_panic(expected: ('NOT_OWNER',))]
fn pause_fails_for_non_owner() {
    let usdc = deploy_token();
    let messenger = deploy_messenger(usdc);
    let owner = contract_address_const::<0xAAA>();
    let attacker = contract_address_const::<0xDEAD>();
    let router = deploy_router(owner, messenger, usdc);
    unpause_router(router, owner);
    let router_disp = IWottaCctpRouterDispatcher { contract_address: router };
    snforge_std::start_cheat_caller_address(router, attacker);
    router_disp.pause();
}

#[test]
#[should_panic(expected: ('NOT_OWNER',))]
fn unpause_fails_for_non_owner() {
    let usdc = deploy_token();
    let messenger = deploy_messenger(usdc);
    let owner = contract_address_const::<0xAAA>();
    let attacker = contract_address_const::<0xDEAD>();
    let router = deploy_router(owner, messenger, usdc);
    let router_disp = IWottaCctpRouterDispatcher { contract_address: router };

    snforge_std::start_cheat_caller_address(router, attacker);
    router_disp.unpause();
}

#[test]
#[should_panic(expected: ('NOT_OWNER',))]
fn set_source_domain_fails_for_non_owner() {
    let usdc = deploy_token();
    let messenger = deploy_messenger(usdc);
    let owner = contract_address_const::<0xAAA>();
    let attacker = contract_address_const::<0xDEAD>();
    let router = deploy_router(owner, messenger, usdc);
    let router_disp = IWottaCctpRouterDispatcher { contract_address: router };
    snforge_std::start_cheat_caller_address(router, attacker);
    router_disp.set_source_domain_admitted(6, false);
}

#[test]
#[should_panic(expected: ('INTENT_USED',))]
fn settle_replay_is_rejected() {
    let usdc = deploy_token();
    let privacy = contract_address_const::<0x111>();
    let messenger = deploy_messenger(usdc);
    let owner = contract_address_const::<0x999>();
    let router = deploy_active_router(owner, messenger, usdc);
    let pool = deploy_pool(privacy, usdc, router, DENOMINATION_1);
    let refund = contract_address_const::<0x444>();
    let token = IERC20Dispatcher { contract_address: usdc };

    let hook = make_hook(0x62, pool, refund);
    let encoded = cctp_codec::encode_for_test(6, messenger, router, DENOMINATION_1, hook);
    let mut attestation: ByteArray = Default::default();
    attestation.append_byte(1);
    snforge_std::start_cheat_block_timestamp(pool, 1_700_000_000);

    let router_disp = IWottaCctpRouterDispatcher { contract_address: router };
    // First settle: fund the pool
    router_disp.settle(encoded.clone(), attestation.clone());
    // Mint again so the messenger can pretend to transfer
    token.mint(messenger, DENOMINATION_1.into());
    // Second settle: must revert with INTENT_USED
    router_disp.settle(encoded, attestation);
}

#[test]
#[should_panic(expected: ('BAD_MSG_LEN',))]
fn settle_rejects_malformed_message_bytes() {
    let usdc = deploy_token();
    let messenger = deploy_messenger(usdc);
    let router = deploy_active_router(contract_address_const::<0xAAA>(), messenger, usdc);
    let router_disp = IWottaCctpRouterDispatcher { contract_address: router };
    let message: ByteArray = Default::default();
    let mut attestation: ByteArray = Default::default();
    attestation.append_byte(1);
    router_disp.settle(message, attestation);
}

#[test]
#[should_panic(expected: ('BAD_HOOK_VER',))]
fn settle_rejects_unsupported_hook_version() {
    let usdc = deploy_token();
    let messenger = deploy_messenger(usdc);
    let router = deploy_active_router(contract_address_const::<0xAAA>(), messenger, usdc);
    let pool = deploy_pool(contract_address_const::<0x111>(), usdc, router, DENOMINATION_1);
    let encoded = cctp_codec::encode_for_test_with_bindings(
        6, 25, messenger, router, router, DENOMINATION_1, 1, 2,
        make_hook(0x70, pool, contract_address_const::<0x444>()),
    );
    let mut attestation: ByteArray = Default::default();
    attestation.append_byte(1);
    IWottaCctpRouterDispatcher { contract_address: router }.settle(encoded, attestation);
}

#[test]
#[should_panic(expected: ('BAD_RECIPIENT',))]
fn settle_rejects_wrong_circle_recipient() {
    let usdc = deploy_token();
    let messenger = deploy_messenger(usdc);
    let router = deploy_active_router(contract_address_const::<0xAAA>(), messenger, usdc);
    let pool = deploy_pool(contract_address_const::<0x111>(), usdc, router, DENOMINATION_1);
    let encoded = cctp_codec::encode_for_test_with_bindings(
        6, 25, contract_address_const::<0xBAD>(), router, router, DENOMINATION_1, 1, 1,
        make_hook(0x71, pool, contract_address_const::<0x444>()),
    );
    let mut attestation: ByteArray = Default::default();
    attestation.append_byte(1);
    IWottaCctpRouterDispatcher { contract_address: router }.settle(encoded, attestation);
}

#[test]
#[should_panic(expected: ('BAD_DEST_CALL',))]
fn settle_rejects_wrong_destination_caller() {
    let usdc = deploy_token();
    let messenger = deploy_messenger(usdc);
    let router = deploy_active_router(contract_address_const::<0xAAA>(), messenger, usdc);
    let pool = deploy_pool(contract_address_const::<0x111>(), usdc, router, DENOMINATION_1);
    let encoded = cctp_codec::encode_for_test_with_bindings(
        6, 25, messenger, contract_address_const::<0xBAD>(), router, DENOMINATION_1, 1, 1,
        make_hook(0x72, pool, contract_address_const::<0x444>()),
    );
    let mut attestation: ByteArray = Default::default();
    attestation.append_byte(1);
    IWottaCctpRouterDispatcher { contract_address: router }.settle(encoded, attestation);
}

#[test]
#[should_panic(expected: ('BAD_MINT_RECIP',))]
fn settle_rejects_wrong_mint_recipient() {
    let usdc = deploy_token();
    let messenger = deploy_messenger(usdc);
    let router = deploy_active_router(contract_address_const::<0xAAA>(), messenger, usdc);
    let pool = deploy_pool(contract_address_const::<0x111>(), usdc, router, DENOMINATION_1);
    let encoded = cctp_codec::encode_for_test_with_bindings(
        6, 25, messenger, router, contract_address_const::<0xBAD>(), DENOMINATION_1, 1, 1,
        make_hook(0x73, pool, contract_address_const::<0x444>()),
    );
    let mut attestation: ByteArray = Default::default();
    attestation.append_byte(1);
    IWottaCctpRouterDispatcher { contract_address: router }.settle(encoded, attestation);
}

#[test]
#[should_panic(expected: ('BAD_DEST_DOMAIN',))]
fn settle_rejects_wrong_destination_domain() {
    let usdc = deploy_token();
    let messenger = deploy_messenger(usdc);
    let router = deploy_active_router(contract_address_const::<0xAAA>(), messenger, usdc);
    let pool = deploy_pool(contract_address_const::<0x111>(), usdc, router, DENOMINATION_1);
    let encoded = cctp_codec::encode_for_test_with_bindings(
        6, 24, messenger, router, router, DENOMINATION_1, 1, 1,
        make_hook(0x76, pool, contract_address_const::<0x444>()),
    );
    let mut attestation: ByteArray = Default::default();
    attestation.append_byte(1);
    IWottaCctpRouterDispatcher { contract_address: router }.settle(encoded, attestation);
}

#[test]
#[should_panic(expected: ('BAD_HOOK_MAGIC',))]
fn settle_rejects_wrong_hook_magic() {
    let usdc = deploy_token();
    let messenger = deploy_messenger(usdc);
    let router = deploy_active_router(contract_address_const::<0xAAA>(), messenger, usdc);
    let pool = deploy_pool(contract_address_const::<0x111>(), usdc, router, DENOMINATION_1);
    let encoded = cctp_codec::encode_for_test_with_hook_magic(
        6, 25, messenger, router, router, DENOMINATION_1, 1, 1,
        make_hook(0x77, pool, contract_address_const::<0x444>()),
        0x58585858,
    );
    let mut attestation: ByteArray = Default::default();
    attestation.append_byte(1);
    IWottaCctpRouterDispatcher { contract_address: router }.settle(encoded, attestation);
}

#[test]
#[should_panic(expected: ('BAD_MANIFEST',))]
fn settle_rejects_wrong_manifest_version() {
    let usdc = deploy_token();
    let messenger = deploy_messenger(usdc);
    let router = deploy_active_router(contract_address_const::<0xAAA>(), messenger, usdc);
    let pool = deploy_pool(contract_address_const::<0x111>(), usdc, router, DENOMINATION_1);
    let mut hook = make_hook(0x78, pool, contract_address_const::<0x444>());
    hook.manifest_version = 2;
    let encoded = cctp_codec::encode_for_test(6, messenger, router, DENOMINATION_1, hook);
    let mut attestation: ByteArray = Default::default();
    attestation.append_byte(1);
    IWottaCctpRouterDispatcher { contract_address: router }.settle(encoded, attestation);
}

#[test]
#[should_panic(expected: ('POOL_DENOM',))]
fn settle_rejects_denomination_mismatch() {
    let usdc = deploy_token();
    let messenger = deploy_messenger(usdc);
    let router = deploy_active_router(contract_address_const::<0xAAA>(), messenger, usdc);
    let pool = deploy_pool(contract_address_const::<0x111>(), usdc, router, DENOMINATION_1);
    let mut hook = make_hook(0x79, pool, contract_address_const::<0x444>());
    hook.denomination_code = 1;
    let encoded = cctp_codec::encode_for_test(6, messenger, router, DENOMINATION_1, hook);
    let mut attestation: ByteArray = Default::default();
    attestation.append_byte(1);
    IWottaCctpRouterDispatcher { contract_address: router }.settle(encoded, attestation);
}

#[test]
fn underfunding_refunds_without_creating_a_claim() {
    let usdc = deploy_token();
    let messenger = deploy_messenger(usdc);
    let router = deploy_active_router(contract_address_const::<0xAAA>(), messenger, usdc);
    let pool = deploy_pool(contract_address_const::<0x111>(), usdc, router, DENOMINATION_1);
    let refund = contract_address_const::<0x444>();
    let encoded = cctp_codec::encode_for_test(
        6, messenger, router, 500_000, make_hook(0x74, pool, refund),
    );
    let mut attestation: ByteArray = Default::default();
    attestation.append_byte(1);
    IWottaCctpRouterDispatcher { contract_address: router }.settle(encoded, attestation);
    let token = IERC20Dispatcher { contract_address: usdc };
    assert(token.balance_of(refund) == 500_000, 'bad underfund refund');
    assert(IWottaEscrowPoolDispatcher { contract_address: pool }.claim(0x777).status == 0, 'claim created');
}

#[test]
fn surplus_is_refunded_and_pool_receives_only_the_denomination() {
    let usdc = deploy_token();
    let messenger = deploy_messenger(usdc);
    let router = deploy_active_router(contract_address_const::<0xAAA>(), messenger, usdc);
    let pool = deploy_pool(contract_address_const::<0x111>(), usdc, router, DENOMINATION_1);
    let refund = contract_address_const::<0x444>();
    let encoded = cctp_codec::encode_for_test(
        6, messenger, router, 1_500_000, make_hook(0x75, pool, refund),
    );
    let mut attestation: ByteArray = Default::default();
    attestation.append_byte(1);
    snforge_std::start_cheat_block_timestamp(pool, 1_700_000_000);
    IWottaCctpRouterDispatcher { contract_address: router }.settle(encoded, attestation);
    let token = IERC20Dispatcher { contract_address: usdc };
    assert(token.balance_of(pool) == DENOMINATION_1.into(), 'pool overfunded');
    assert(token.balance_of(refund) == 500_000, 'bad surplus refund');
}

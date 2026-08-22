use snforge_std::{declare, ContractClassTrait, DeclareResultTrait};
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
    messenger: ContractAddress, usdc: ContractAddress,
) -> ContractAddress {
    let class = declare("WottaCctpRouter").unwrap().contract_class();
    let (address, _) = class
        .deploy(@array![messenger.into(), usdc.into(), messenger.into()])
        .unwrap();
    address
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
    let router = deploy_router(messenger, usdc);
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
    let encoded = cctp_codec::encode_for_test(0, messenger, router, DENOMINATION_1, hook);
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

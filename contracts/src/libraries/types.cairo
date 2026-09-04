use starknet::ContractAddress;

pub const DENOMINATION_01: u128 = 100_000;
pub const DENOMINATION_1: u128 = 1_000_000;
pub const DENOMINATION_10: u128 = 10_000_000;
pub const DENOMINATION_50: u128 = 50_000_000;
pub const DENOMINATION_100: u128 = 100_000_000;

pub const STATUS_NONE: u8 = 0;
pub const STATUS_FUNDED: u8 = 1;
pub const STATUS_CLAIMED: u8 = 2;
pub const STATUS_REFUNDED: u8 = 3;

pub const FUNDING_PUBLIC_DIRECT: u8 = 1;
pub const FUNDING_CCTP: u8 = 2;
pub const FUNDING_PRIVATE: u8 = 3;

pub const PRIVATE_FUND: u8 = 1;
pub const CLAIM: u8 = 2;
pub const PRIVATE_REFUND: u8 = 3;

pub const HOOK_MAGIC: felt252 = 'WOTT';
pub const HOOK_VERSION: felt252 = 1;
pub const HOOK_MANIFEST_VERSION: felt252 = 1;
pub const CCTP_MESSAGE_VERSION: felt252 = 1;

#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct OpenNoteDeposit {
    pub note_id: felt252,
    pub token: ContractAddress,
    pub amount: u128,
}

#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct ClaimRecord {
    pub status: u8,
    pub funding_kind: u8,
    pub public_refund_recipient: ContractAddress,
    pub private_refund_hash: felt252,
    pub expires_at: u64,
    pub funded_at: u64,
}

#[derive(Copy, Drop, Serde)]
pub struct WottaHookV1 {
    pub magic: felt252,
    pub version: felt252,
    pub intent_id: felt252,
    pub denomination_code: felt252,
    pub escrow_pool: ContractAddress,
    pub claim_hash: felt252,
    pub public_refund_recipient: ContractAddress,
    pub expires_at: u64,
    pub manifest_version: felt252,
}

#[derive(Copy, Drop, Serde)]
pub struct CctpMessageV2 {
    pub source_domain: u32,
    pub destination_domain: u32,
    pub recipient: ContractAddress,
    pub destination_caller: ContractAddress,
    pub mint_recipient: ContractAddress,
    pub amount: u128,
    pub hook: WottaHookV1,
}

pub fn is_supported_denomination(denomination: u128) -> bool {
    denomination == DENOMINATION_01
        || denomination == DENOMINATION_1
        || denomination == DENOMINATION_10
        || denomination == DENOMINATION_50
        || denomination == DENOMINATION_100
}

/// Escrow claim hashes bind to SN_MAIN / SN_SEPOLIA only.
pub fn is_supported_chain_id(chain_id: felt252) -> bool {
    chain_id == 'SN_MAIN' || chain_id == 'SN_SEPOLIA'
}

pub fn denomination_code_to_amount(code: felt252) -> u128 {
    if code == 0 {
        DENOMINATION_1
    } else if code == 1 {
        DENOMINATION_10
    } else if code == 2 {
        DENOMINATION_50
    } else if code == 3 {
        DENOMINATION_100
    } else if code == 4 {
        DENOMINATION_01
    } else {
        assert(false, 'BAD_DENOM_CODE');
        0
    }
}

pub fn denomination_amount_to_code(amount: u128) -> felt252 {
    if amount == DENOMINATION_1 {
        0
    } else if amount == DENOMINATION_10 {
        1
    } else if amount == DENOMINATION_50 {
        2
    } else if amount == DENOMINATION_100 {
        3
    } else if amount == DENOMINATION_01 {
        4
    } else {
        assert(false, 'BAD_DENOM');
        0
    }
}

use core::byte_array::ByteArrayTrait;
use starknet::ContractAddress;

use crate::libraries::types::{CctpMessageV2, WottaHookV1};

// Circle MessageV2 and BurnMessageV2 byte offsets.
pub const MESSAGE_BODY_OFFSET: usize = 148;
pub const BURN_HOOK_OFFSET: usize = 228;
pub const HOOK_WRAPPER_LENGTH: usize = 136;
pub const MESSAGE_LENGTH: usize = MESSAGE_BODY_OFFSET + BURN_HOOK_OFFSET + HOOK_WRAPPER_LENGTH;
pub const STARKNET_DOMAIN: u32 = 25;
const CCTP_WRAPPER_MAGIC: u32 = 0x43435450; // "CCTP"
const WOTTA_HOOK_MAGIC: u32 = 0x574f5454; // "WOTT"

pub fn decode(message: @ByteArray) -> CctpMessageV2 {
    assert(message.len() == MESSAGE_LENGTH, 'BAD_MSG_LEN');

    let hook_offset = MESSAGE_BODY_OFFSET + BURN_HOOK_OFFSET;
    assert(read_u32_be(message, hook_offset) == CCTP_WRAPPER_MAGIC, 'BAD_WRAP_MAGIC');
    assert(read_u8(message, hook_offset + 4) == 1, 'BAD_WRAP_VER');
    assert(read_u16_be(message, hook_offset + 5) == 129, 'BAD_WRAP_LEN');

    let hook_start = hook_offset + 7;
    assert(read_u32_be(message, hook_start) == WOTTA_HOOK_MAGIC, 'BAD_HOOK_MAGIC');
    assert(read_u8(message, hook_start + 4) == 1, 'BAD_HOOK_VER');

    let manifest_version = read_u16_be(message, hook_start + 127);
    assert(manifest_version == 1, 'BAD_MANIFEST');

    CctpMessageV2 {
        destination_domain: read_u32_be(message, 8),
        recipient: read_address32(message, 76),
        destination_caller: read_address32(message, 108),
        mint_recipient: read_address32(message, MESSAGE_BODY_OFFSET + 36),
        amount: read_u256_be(message, MESSAGE_BODY_OFFSET + 68).try_into().unwrap(),
        hook: WottaHookV1 {
            magic: 'WOTT',
            version: 1,
            intent_id: read_u128_be(message, hook_start + 5).into(),
            denomination_code: read_u16_be(message, hook_start + 21).into(),
            escrow_pool: read_address32(message, hook_start + 23),
            claim_hash: read_felt32(message, hook_start + 55),
            public_refund_recipient: read_address32(message, hook_start + 87),
            expires_at: read_u64_be(message, hook_start + 119),
            manifest_version: manifest_version.into(),
        },
    }
}

fn read_u8(data: @ByteArray, offset: usize) -> u8 {
    data.at(offset).unwrap()
}

fn read_u16_be(data: @ByteArray, offset: usize) -> u16 {
    let mut value: u16 = 0;
    let mut i: usize = 0;
    while i < 2 {
        value = value * 256 + read_u8(data, offset + i).into();
        i += 1;
    };
    value
}

fn read_u32_be(data: @ByteArray, offset: usize) -> u32 {
    let mut value: u32 = 0;
    let mut i: usize = 0;
    while i < 4 {
        value = value * 256 + read_u8(data, offset + i).into();
        i += 1;
    };
    value
}

fn read_u64_be(data: @ByteArray, offset: usize) -> u64 {
    let mut value: u64 = 0;
    let mut i: usize = 0;
    while i < 8 {
        value = value * 256 + read_u8(data, offset + i).into();
        i += 1;
    };
    value
}

fn read_u128_be(data: @ByteArray, offset: usize) -> u128 {
    let mut value: u128 = 0;
    let mut i: usize = 0;
    while i < 16 {
        value = value * 256 + read_u8(data, offset + i).into();
        i += 1;
    };
    value
}

fn read_u256_be(data: @ByteArray, offset: usize) -> u256 {
    u256 { high: read_u128_be(data, offset), low: read_u128_be(data, offset + 16) }
}

fn read_felt32(data: @ByteArray, offset: usize) -> felt252 {
    read_u256_be(data, offset).try_into().unwrap()
}

fn read_address32(data: @ByteArray, offset: usize) -> ContractAddress {
    read_felt32(data, offset).try_into().unwrap()
}

// Exact Circle-format encoder used by contract tests and shared fixtures.
pub fn encode_for_test(
    source_domain: u32,
    token_messenger: ContractAddress,
    router: ContractAddress,
    amount: u128,
    hook: WottaHookV1,
) -> ByteArray {
    let mut out: ByteArray = Default::default();
    append_u32_be(ref out, 0);
    append_u32_be(ref out, source_domain);
    append_u32_be(ref out, STARKNET_DOMAIN);
    append_u256_be(ref out, 9);
    append_u256_be(ref out, 0x123);
    append_address32(ref out, token_messenger);
    append_address32(ref out, router);
    append_u32_be(ref out, 0);
    append_u32_be(ref out, 0);

    append_u32_be(ref out, 0);
    append_u256_be(ref out, 0x456);
    append_address32(ref out, router);
    append_u256_be(ref out, amount.into());
    append_u256_be(ref out, 0x123);
    append_u256_be(ref out, 0);
    append_u256_be(ref out, 0);
    append_u256_be(ref out, 0);

    append_u32_be(ref out, CCTP_WRAPPER_MAGIC);
    out.append_byte(1);
    append_u16_be(ref out, 129);
    append_u32_be(ref out, WOTTA_HOOK_MAGIC);
    out.append_byte(1);
    append_u128_be(ref out, hook.intent_id.try_into().unwrap());
    append_u16_be(ref out, hook.denomination_code.try_into().unwrap());
    append_address32(ref out, hook.escrow_pool);
    append_u256_be(ref out, hook.claim_hash.into());
    append_address32(ref out, hook.public_refund_recipient);
    append_u64_be(ref out, hook.expires_at);
    append_u16_be(ref out, hook.manifest_version.try_into().unwrap());
    out
}

fn append_u16_be(ref out: ByteArray, value: u16) {
    append_u128_fixed_be(ref out, value.into(), 2);
}

fn append_u32_be(ref out: ByteArray, value: u32) {
    append_u128_fixed_be(ref out, value.into(), 4);
}

fn append_u64_be(ref out: ByteArray, value: u64) {
    append_u128_fixed_be(ref out, value.into(), 8);
}

fn append_u128_be(ref out: ByteArray, value: u128) {
    append_u128_fixed_be(ref out, value, 16);
}

fn append_u256_be(ref out: ByteArray, value: u256) {
    append_u128_be(ref out, value.high);
    append_u128_be(ref out, value.low);
}

fn append_address32(ref out: ByteArray, value: ContractAddress) {
    let felt: felt252 = value.into();
    append_u256_be(ref out, felt.into());
}

fn append_u128_fixed_be(ref out: ByteArray, value: u128, width: usize) {
    let mut reversed: Array<u8> = array![];
    let mut current = value;
    let mut i: usize = 0;
    while i < width {
        reversed.append((current % 256).try_into().unwrap());
        current /= 256;
        i += 1;
    };
    assert(current == 0, 'VALUE_OVERFLOW');
    let mut span = reversed.span();
    while let Some(byte) = span.pop_back() {
        out.append_byte(*byte);
    };
}

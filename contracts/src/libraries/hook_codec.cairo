use starknet::ContractAddress;

use crate::libraries::types::{HOOK_MAGIC, HOOK_MANIFEST_VERSION, HOOK_VERSION, WottaHookV1};

pub const HOOK_FIELD_COUNT: usize = 9;

pub fn encode(hook: WottaHookV1) -> Array<felt252> {
    let mut out = array![];
    out.append(hook.magic);
    out.append(hook.version);
    out.append(hook.intent_id);
    out.append(hook.denomination_code);
    out.append(hook.escrow_pool.into());
    out.append(hook.claim_hash);
    out.append(hook.public_refund_recipient.into());
    out.append(hook.expires_at.into());
    out.append(hook.manifest_version);
    out
}

pub fn decode(data: Span<felt252>) -> WottaHookV1 {
    assert(data.len() == HOOK_FIELD_COUNT, 'BAD_HOOK_LEN');

    let magic = *data.at(0);
    let version = *data.at(1);
    let manifest_version = *data.at(8);

    assert(magic == HOOK_MAGIC, 'BAD_HOOK_MAGIC');
    assert(version == HOOK_VERSION, 'BAD_HOOK_VER');
    assert(manifest_version == HOOK_MANIFEST_VERSION, 'BAD_MANIFEST');

    let escrow_pool: ContractAddress = (*data.at(4)).try_into().unwrap();
    let public_refund_recipient: ContractAddress = (*data.at(6)).try_into().unwrap();
    let expires_at: u64 = (*data.at(7)).try_into().unwrap();

    WottaHookV1 {
        magic,
        version,
        intent_id: *data.at(2),
        denomination_code: *data.at(3),
        escrow_pool,
        claim_hash: *data.at(5),
        public_refund_recipient,
        expires_at,
        manifest_version,
    }
}

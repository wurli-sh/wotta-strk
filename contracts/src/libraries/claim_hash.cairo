use core::poseidon::poseidon_hash_span;
use starknet::ContractAddress;

pub const CLAIM_TAG: felt252 = 'WOTTA_CLAIM_V1';
pub const REFUND_TAG: felt252 = 'WOTTA_REFUND_V1';

pub fn claim_hash(chain_id: felt252, pool_address: ContractAddress, claim_secret: felt252) -> felt252 {
    let data = array![CLAIM_TAG, chain_id, pool_address.into(), claim_secret];
    poseidon_hash_span(data.span())
}

pub fn refund_hash(
    chain_id: felt252, pool_address: ContractAddress, refund_secret: felt252
) -> felt252 {
    let data = array![REFUND_TAG, chain_id, pool_address.into(), refund_secret];
    poseidon_hash_span(data.span())
}

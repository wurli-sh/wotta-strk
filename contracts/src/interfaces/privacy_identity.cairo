use starknet::{ClassHash, ContractAddress};

#[derive(Drop, Serde)]
pub struct Call {
    pub to: ContractAddress,
    pub selector: felt252,
    pub calldata: Array<felt252>,
}

#[starknet::interface]
pub trait IWottaPrivacyIdentity<TContractState> {
    fn is_valid_signature(
        self: @TContractState, hash: felt252, signature: Array<felt252>,
    ) -> felt252;
    fn execute(ref self: TContractState, calls: Array<Call>);
}

#[starknet::interface]
pub trait ISRC6<TContractState> {
    fn is_valid_signature(
        self: @TContractState, hash: felt252, signature: Array<felt252>,
    ) -> felt252;
}

#[starknet::interface]
pub trait IUpgradeable<TContractState> {
    fn upgrade(ref self: TContractState, new_class_hash: ClassHash);
}

#[derive(Drop, Debug, PartialEq, starknet::Event)]
pub struct Upgraded {
    pub class_hash: ClassHash,
}

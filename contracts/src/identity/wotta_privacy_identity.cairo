use crate::interfaces::privacy_identity::IWottaPrivacyIdentity;

#[starknet::contract]
pub mod WottaPrivacyIdentity {
    use core::poseidon::poseidon_hash_span;
    use openzeppelin_access::ownable::OwnableComponent;
    use starknet::syscalls::{call_contract_syscall, replace_class_syscall};
    use starknet::{ClassHash, ContractAddress, SyscallResultTrait, get_tx_info};
    use crate::interfaces::privacy_identity::{
        Call, ISRC6Dispatcher, ISRC6DispatcherTrait, IUpgradeable, Upgraded,
    };
    use super::IWottaPrivacyIdentity;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);
    impl InternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[abi(embed_v0)]
    impl OwnableTwoStepImpl = OwnableComponent::OwnableTwoStepImpl<ContractState>;

    const STARKNET_MESSAGE: felt252 = 'StarkNet Message';
    const STARKNET_DOMAIN_TYPE_HASH: felt252 =
        0x1ff2f602e42168014d405a94f75e8a93d640751d71d16311266e140d8b0a210;
    const MESSAGE_TYPE_HASH: felt252 =
        0x16a33dca499bb0eafbd5b97b1e86eb85147c19b42b9c144a12c809ee577c175;
    const DOMAIN_NAME: felt252 = 'Wotta';
    const DOMAIN_VERSION: felt252 = 1;
    const DOMAIN_REVISION: felt252 = 1;

    #[storage]
    struct Storage {
        #[substorage(v0)]
        ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        #[flat]
        OwnableEvent: OwnableComponent::Event,
        Upgraded: Upgraded,
    }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress) {
        self.ownable.initializer(owner);
    }

    #[abi(embed_v0)]
    impl WottaPrivacyIdentityImpl of IWottaPrivacyIdentity<ContractState> {
        fn is_valid_signature(
            self: @ContractState, hash: felt252, signature: Array<felt252>,
        ) -> felt252 {
            let owner = self.ownable.owner();
            let chain_id = get_tx_info().unbox().chain_id;
            let message_hash = snip12_message_hash(hash, owner.into(), chain_id);
            ISRC6Dispatcher { contract_address: owner }.is_valid_signature(message_hash, signature)
        }

        fn execute(ref self: ContractState, calls: Array<Call>) {
            self.ownable.assert_only_owner();
            for call in calls {
                call_contract_syscall(call.to, call.selector, call.calldata.span())
                    .unwrap_syscall();
            }
        }
    }

    #[abi(embed_v0)]
    impl UpgradeableImpl of IUpgradeable<ContractState> {
        fn upgrade(ref self: ContractState, new_class_hash: ClassHash) {
            self.ownable.assert_only_owner();
            replace_class_syscall(new_class_hash).unwrap_syscall();
            self.emit(Event::Upgraded(Upgraded { class_hash: new_class_hash }));
        }
    }

    fn snip12_message_hash(hash: felt252, signer: felt252, chain_id: felt252) -> felt252 {
        let domain_separator = poseidon_hash_span(
            array![STARKNET_DOMAIN_TYPE_HASH, DOMAIN_NAME, DOMAIN_VERSION, chain_id, DOMAIN_REVISION]
                .span(),
        );
        let struct_hash = poseidon_hash_span(array![MESSAGE_TYPE_HASH, hash].span());
        poseidon_hash_span(array![STARKNET_MESSAGE, domain_separator, signer, struct_hash].span())
    }
}

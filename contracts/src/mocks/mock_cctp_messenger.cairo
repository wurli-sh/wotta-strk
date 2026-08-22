#[starknet::contract]
pub mod MockCctpMessenger {
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::ContractAddress;

    use crate::interfaces::cctp::IMessageTransmitterV2;
    use crate::interfaces::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};
    use crate::libraries::cctp_codec;

    #[storage]
    struct Storage {
        token: ContractAddress,
        processed_intent: Map<felt252, bool>,
    }

    #[constructor]
    fn constructor(ref self: ContractState, token: ContractAddress) {
        self.token.write(token);
    }

    #[abi(embed_v0)]
    impl CctpImpl of IMessageTransmitterV2<ContractState> {
        fn receive_message(
            ref self: ContractState, message: ByteArray, attestation: ByteArray,
        ) -> bool {
            assert(attestation.len() > 0, 'NO_ATTEST');
            assert(attestation.at(0).unwrap() == 1, 'BAD_ATTEST');

            let decoded = cctp_codec::decode(@message);
            assert(!self.processed_intent.read(decoded.hook.intent_id), 'NONCE_USED');

            self.processed_intent.write(decoded.hook.intent_id, true);
            let token = IERC20Dispatcher { contract_address: self.token.read() };
            token.mint(decoded.mint_recipient, decoded.amount.into());
            true
        }
    }
}

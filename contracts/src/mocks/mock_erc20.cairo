#[starknet::contract]
pub mod MockErc20 {
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess};
    use starknet::{ContractAddress, get_caller_address};

    use crate::interfaces::erc20::IERC20;

    #[storage]
    struct Storage {
        balances: Map<ContractAddress, u256>,
        allowances: Map<(ContractAddress, ContractAddress), u256>,
    }

    #[abi(embed_v0)]
    impl Erc20Impl of IERC20<ContractState> {
        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.read(account)
        }

        fn allowance(
            self: @ContractState, owner: ContractAddress, spender: ContractAddress
        ) -> u256 {
            self.allowances.read((owner, spender))
        }

        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            let owner = get_caller_address();
            self.allowances.write((owner, spender), amount);
            true
        }

        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool {
            let sender = get_caller_address();
            internal_transfer(ref self, sender, recipient, amount);
            true
        }

        fn transfer_from(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u256,
        ) -> bool {
            let spender = get_caller_address();
            let allowance = self.allowances.read((sender, spender));
            assert(allowance >= amount, 'ALLOWANCE');
            self.allowances.write((sender, spender), allowance - amount);
            internal_transfer(ref self, sender, recipient, amount);
            true
        }

        fn mint(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool {
            let balance = self.balances.read(recipient);
            self.balances.write(recipient, balance + amount);
            true
        }
    }

    fn internal_transfer(
        ref self: ContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256
    ) {
        let sender_balance = self.balances.read(sender);
        assert(sender_balance >= amount, 'BALANCE');
        self.balances.write(sender, sender_balance - amount);
        let recipient_balance = self.balances.read(recipient);
        self.balances.write(recipient, recipient_balance + amount);
    }
}

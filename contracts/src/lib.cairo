pub mod interfaces {
    pub mod erc20;
    pub mod cctp;
    pub mod privacy;
}

pub mod libraries {
    pub mod types;
    pub mod claim_hash;
    pub mod hook_codec;
    pub mod cctp_codec;
}

pub mod mocks {
    pub mod mock_erc20;
    pub mod mock_cctp_messenger;
    pub mod mock_privacy_pool;
}

pub mod escrow {
    pub mod wotta_escrow_pool;
}

pub mod router {
    pub mod wotta_cctp_router;
}

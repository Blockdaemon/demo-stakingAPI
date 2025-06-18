export const BatchDepositV2ABI = [
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "depositContract",
                "type": "address"
            }
        ],
        "stateMutability": "nonpayable",
        "type": "constructor"
    },
    {
        "inputs": [],
        "name": "DeadlineExceeded",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "DepositFailed",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "ExcessiveBalance",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "FundingNotAccepted",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "InvalidLength",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "ZeroAddress",
        "type": "error"
    },
    {
        "stateMutability": "payable",
        "type": "fallback"
    },
    {
        "inputs": [],
        "name": "DEPOSIT_CONTRACT",
        "outputs": [
            {
                "internalType": "address",
                "name": "",
                "type": "address"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "DEPOSIT_DATA_SIZE",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "deadline",
                "type": "uint256"
            },
            {
                "internalType": "uint256[]",
                "name": "values",
                "type": "uint256[]"
            },
            {
                "internalType": "bytes",
                "name": "argv",
                "type": "bytes"
            }
        ],
        "name": "batchDeposit",
        "outputs": [],
        "stateMutability": "payable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "bytes4",
                "name": "interfaceId",
                "type": "bytes4"
            }
        ],
        "name": "supportsInterface",
        "outputs": [
            {
                "internalType": "bool",
                "name": "",
                "type": "bool"
            }
        ],
        "stateMutability": "pure",
        "type": "function"
    },
    {
        "stateMutability": "payable",
        "type": "receive"
    }
] as const;
export const BatchDepositV1ABI = [
    {
        "inputs": [
            {
                "internalType": "contract IDepositContract",
                "name": "_depositContract",
                "type": "address"
            }
        ],
        "stateMutability": "nonpayable",
        "type": "constructor"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "validUntil",
                "type": "uint256"
            },
            {
                "internalType": "bytes",
                "name": "args",
                "type": "bytes"
            }
        ],
        "name": "batchDeposit",
        "outputs": [],
        "stateMutability": "payable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "depositContract",
        "outputs": [
            {
                "internalType": "contract IDepositContract",
                "name": "",
                "type": "address"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    }
] as const;
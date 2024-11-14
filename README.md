# OTC Swap Smart Contract

A secure and efficient smart contract for peer-to-peer token swaps on Ethereum, enabling users to create, fill, and manage OTC (Over-The-Counter) token swap orders with optional counterparty specification.

## Features

- 🤝 Peer-to-peer token swaps
- 🔒 Optional counterparty specification
- ⚡ Gas-efficient implementation
- 🛡️ Comprehensive security measures
- 🧪 Extensive test coverage
- 📋 Batch order querying
- ✅ OpenZeppelin standard compliance

## Security Features

- Reentrancy protection
- SafeERC20 implementation
- Input validation
- Access control
- Arithmetic overflow protection

## Prerequisites

- Node.js >= 14.0.0
- npm >= 6.0.0
- Hardhat

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/otc-swap-contract.git
cd otc-swap-contract
```

2. Install dependencies:
```bash
npm install
```

3. Compile contracts:
```bash
npx hardhat compile
```

4. Run tests:
```bash
npx hardhat test
```

## Contract Overview

The OTC Swap contract enables users to:

1. Create swap orders specifying:
    - Sell token and amount
    - Buy token and amount
    - Optional specific counterparty

2. Fill existing orders
3. Cancel orders
4. Query order details and status

### Core Functions

```solidity
function createOrder(
    address partner,
    address sellToken,
    uint256 sellAmount,
    address buyToken,
    uint256 buyAmount
) external returns (uint256)

function fillOrder(uint256 orderId) external

function cancelOrder(uint256 orderId) external

function getOrder(uint256 orderId) external view returns (
    address maker,
    address partner,
    address sellToken,
    uint256 sellAmount,
    address buyToken,
    uint256 buyAmount,
    uint256 createdAt,
    bool active
)
```

## Usage Example

```javascript
// Create an order
const sellAmount = ethers.parseEther('100');
const buyAmount = ethers.parseEther('200');
await tokenA.approve(otcSwap.address, sellAmount);
const orderId = await otcSwap.createOrder(
    ethers.ZeroAddress,  // Allow any counterparty
    tokenA.address,      // Sell token
    sellAmount,          // Sell amount
    tokenB.address,      // Buy token
    buyAmount           // Buy amount
);

// Fill an order
await tokenB.approve(otcSwap.address, buyAmount);
await otcSwap.fillOrder(orderId);
```

## Testing

The contract includes a comprehensive test suite covering:

- Basic functionality
- Edge cases
- Security scenarios
- Malicious token attacks

Run tests with coverage:
```bash
npx hardhat coverage
```

## Deployment

1. Set up your environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

2. Deploy to network:
```bash
npx hardhat run scripts/deploy.js --network <network-name>
```

## Architecture

### Order Structure
```solidity
struct Order {
    address maker;
    address partner;     // Optional specific counterparty
    address sellToken;
    uint256 sellAmount;
    address buyToken;
    uint256 buyAmount;
    uint256 createdAt;
    bool active;
}
```

### Events
```solidity
event OrderCreated(
    uint256 indexed orderId,
    address indexed maker,
    address indexed partner,
    address sellToken,
    uint256 sellAmount,
    address buyToken,
    uint256 buyAmount,
    uint256 createdAt
);

event OrderFilled(
    uint256 indexed orderId,
    address indexed taker,
    address sellToken,
    uint256 sellAmount,
    address buyToken,
    uint256 buyAmount
);

event OrderCancelled(
    uint256 indexed orderId,
    address indexed maker
);
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Security

This contract has not been audited. Use at your own risk.

If you discover any security issues, please contact us instead of using the issue tracker.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- OpenZeppelin for their secure contract implementations
- Hardhat for the development environment
- The Ethereum community for best practices and standards

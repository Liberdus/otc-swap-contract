# Token Deployment Guide

This guide shows you how to deploy token contracts with pause functionality and initial token distribution on the Amoy testnet.

## Available Contracts with Pause Feature

### 1. MisbehavingToken

- **File**: `contracts/MisbehavingToken.sol`
- **Features**: Pause/unpause functionality, minting
- **Deployment**: `npx hardhat run scripts/deploy.js --network amoy`

### 2. TestTokenPausable (New)

- **File**: `contracts/TestTokenPausable.sol`
- **Features**: Pause/unpause functionality, minting, customizable name/symbol, **initial distribution**
- **Deployment**: `npx hardhat run scripts/deployTestTokenPausable.js --network amoy`

### 3. TestTokenDecimals

- **File**: `contracts/TestTokenDecimals.sol`
- **Features**: Custom decimals (useful for USDC-like tokens), minting, burning, **initial distribution**
- **Deployment**: `npx hardhat run scripts/deployTestTokenDecimals.js --network amoy`

### 4. TestToken (Updated)

- **File**: `contracts/TestToken.sol`
- **Features**: Standard ERC20, **initial distribution**
- **Deployment**: `npx hardhat run scripts/deployTestToken.js --network amoy`

## Initial Token Distribution

All token contracts now support **automatic initial distribution** to a list of addresses during deployment. This is useful for:

- **Testnet faucets**: Distribute tokens to testers
- **Team allocations**: Send tokens to team members
- **Community rewards**: Distribute tokens to community members
- **Testing scenarios**: Set up initial balances for testing

### How it works:

1. **During deployment**, you specify:

   - Array of recipient addresses
   - Array of token amounts (must match recipient array length)

2. **After minting** the initial supply to the deployer, tokens are automatically transferred to the specified addresses

3. **Validation** ensures arrays have the same length and skips zero addresses

## Prerequisites

1. **Environment Variables**: Create a `.env` file with:

   ```
   PRIVATE_KEY=your_private_key_here
   MUMBAI_URL=https://rpc-amoy.polygon.technology/
   ```

2. **Testnet ETH**: Get some testnet ETH from the Amoy faucet

## Deployment Commands

### Deploy MisbehavingToken (with pause)

```bash
npx hardhat run scripts/deploy.js --network amoy
```

### Deploy TestTokenPausable (with pause + distribution)

```bash
npx hardhat run scripts/deployTestTokenPausable.js --network amoy
```

### Deploy TestTokenDecimals (custom decimals + distribution)

```bash
npx hardhat run scripts/deployTestTokenDecimals.js --network amoy
```

### Deploy TestToken (standard + distribution)

```bash
npx hardhat run scripts/deployTestToken.js --network amoy
```

## Customizing Initial Distribution

To customize the initial distribution, edit the deployment scripts and modify these arrays:

```javascript
// List of addresses to receive initial tokens
const initialRecipients = [
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", // Example address 1
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", // Example address 2
  "0x90F79bf6EB2c4f870365E785982E1f101E93b906", // Example address 3
  // Add more addresses as needed
];

// Amounts to send to each recipient
const initialAmounts = [
  hre.ethers.parseEther("10000"), // 10,000 tokens to address 1
  hre.ethers.parseEther("5000"), // 5,000 tokens to address 2
  hre.ethers.parseEther("2500"), // 2,500 tokens to address 3
  // Add more amounts as needed
];
```

**Important**:

- Arrays must have the same length
- Use `parseEther()` for 18-decimal tokens
- Use `parseUnits(amount, decimals)` for custom decimal tokens

## Pause Functionality

Both `MisbehavingToken` and `TestTokenPausable` include:

- **`pause()`**: Pauses all token transfers (owner only)
- **`unpause()`**: Resumes token transfers (owner only)
- **`paused()`**: View function to check if contract is paused

## Usage Examples

After deployment, you can interact with the contract:

```javascript
// Pause transfers
await token.pause();

// Check if paused
const isPaused = await token.paused();

// Unpause transfers
await token.unpause();

// Mint new tokens (owner only)
await token.mint(recipientAddress, amount);

// Check balances of initial recipients
const balance = await token.balanceOf(recipientAddress);
```

## Network Configuration

The Amoy testnet is already configured in `hardhat.config.js`:

- **Chain ID**: 80002
- **RPC URL**: https://rpc-amoy.polygon.technology/
- **Explorer**: https://www.oklink.com/amoy

## Compilation

Before deploying, compile the contracts:

```bash
npx hardhat compile
```

## Example Output

When you deploy a token with initial distribution, you'll see output like:

```
TestTokenPausable deployed to: 0x1234...
Token name: Test Token Pausable
Token symbol: TTP
Total supply: 1000000.0 TTP
Owner: 0x5678...

Initial token distribution:
- 0x7099...: 10000.0 TTP
- 0x3C44...: 5000.0 TTP
- 0x90F7...: 2500.0 TTP
```

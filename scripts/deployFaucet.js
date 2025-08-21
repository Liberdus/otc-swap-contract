const { ethers } = require("hardhat");

async function main() {
  console.log("Deploying Faucet contract...");

  // Get the deployer account
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);

  // Deploy tokens first
  const TestTokenPausable = await ethers.getContractFactory("TestTokenPausable");
  
  // Deploy Fee Token
  const feeToken = await TestTokenPausable.deploy(
    "Fee Token",
    "FEE",
    [], // no initial recipients
    []  // no initial amounts
  );
  await feeToken.deployed();
  console.log("Fee Token deployed to:", feeToken.address);

  // Deploy Trading Token 1
  const tradingToken1 = await TestTokenPausable.deploy(
    "Trading Token Alpha",
    "TTA",
    [], // no initial recipients
    []  // no initial amounts
  );
  await tradingToken1.deployed();
  console.log("Trading Token 1 deployed to:", tradingToken1.address);

  // Deploy Trading Token 2
  const tradingToken2 = await TestTokenPausable.deploy(
    "Trading Token Beta",
    "TTB",
    [], // no initial recipients
    []  // no initial amounts
  );
  await tradingToken2.deployed();
  console.log("Trading Token 2 deployed to:", tradingToken2.address);

  // Deploy Faucet
  const Faucet = await ethers.getContractFactory("Faucet");
  
  // Amounts in wei (18 decimals)
  const feeTokenAmount = ethers.utils.parseEther("100"); // 100 tokens
  const tradingTokenAmount = ethers.utils.parseEther("1000"); // 1000 tokens
  const cooldownPeriod = 3600; // 1 hour in seconds

  const faucet = await Faucet.deploy(
    feeToken.address,
    tradingToken1.address,
    tradingToken2.address,
    feeTokenAmount,
    tradingTokenAmount,
    cooldownPeriod
  );
  await faucet.deployed();
  console.log("Faucet deployed to:", faucet.address);

  // Transfer ownership of tokens to faucet so it can mint
  await feeToken.transferOwnership(faucet.address);
  await tradingToken1.transferOwnership(faucet.address);
  await tradingToken2.transferOwnership(faucet.address);
  
  console.log("Token ownership transferred to faucet");

  // Save deployment info
  const deploymentInfo = {
    network: "amoy",
    deployer: deployer.address,
    contracts: {
      feeToken: {
        address: feeToken.address,
        name: "Fee Token",
        symbol: "FEE"
      },
      tradingToken1: {
        address: tradingToken1.address,
        name: "Trading Token Alpha",
        symbol: "TTA"
      },
      tradingToken2: {
        address: tradingToken2.address,
        name: "Trading Token Beta",
        symbol: "TTB"
      },
      faucet: {
        address: faucet.address,
        feeTokenAmount: ethers.utils.formatEther(feeTokenAmount),
        tradingTokenAmount: ethers.utils.formatEther(tradingTokenAmount),
        cooldownPeriod: cooldownPeriod
      }
    },
    timestamp: new Date().toISOString()
  };

  const fs = require("fs");
  fs.writeFileSync("faucet-deployment.json", JSON.stringify(deploymentInfo, null, 2));
  console.log("Deployment info saved to faucet-deployment.json");

  console.log("\nDeployment Summary:");
  console.log("===================");
  console.log(`Fee Token: ${feeToken.address}`);
  console.log(`Trading Token 1: ${tradingToken1.address}`);
  console.log(`Trading Token 2: ${tradingToken2.address}`);
  console.log(`Faucet: ${faucet.address}`);
  console.log(`Fee Token Amount: ${ethers.utils.formatEther(feeTokenAmount)} tokens`);
  console.log(`Trading Token Amount: ${ethers.utils.formatEther(tradingTokenAmount)} tokens`);
  console.log(`Cooldown Period: ${cooldownPeriod} seconds (${cooldownPeriod / 3600} hours)`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

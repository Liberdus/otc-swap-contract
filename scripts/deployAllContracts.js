const { ethers } = require("hardhat");
const fs = require("fs");

async function main() {
  console.log("🚀 Deploying All Contracts (OTCSwap + Tokens + Faucet)...");
  console.log("=".repeat(70));

  // Get the deployer account
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);

  // Deploy tokens first
  const TestTokenPausable = await ethers.getContractFactory("TestTokenPausable");
  
  console.log("\n📦 Deploying tokens...");
  
  // Deploy Fee Token
  const feeToken = await TestTokenPausable.deploy(
    "Fee Token",
    "FEE",
    [], // no initial recipients
    []  // no initial amounts
  );
  await feeToken.waitForDeployment();
  console.log("✅ Fee Token deployed to:", await feeToken.getAddress());

  // Deploy Trading Token 1
  const tradingToken1 = await TestTokenPausable.deploy(
    "Trading Token Alpha",
    "TTA",
    [], // no initial recipients
    []  // no initial amounts
  );
  await tradingToken1.waitForDeployment();
  console.log("✅ Trading Token 1 deployed to:", await tradingToken1.getAddress());

  // Deploy Trading Token 2
  const tradingToken2 = await TestTokenPausable.deploy(
    "Trading Token Beta",
    "TTB",
    [], // no initial recipients
    []  // no initial amounts
  );
  await tradingToken2.waitForDeployment();
  console.log("✅ Trading Token 2 deployed to:", await tradingToken2.getAddress());

  console.log("\n🔄 Deploying OTCSwap contract...");
  
  // Deploy OTCSwap contract
  const OTCSwap = await ethers.getContractFactory("OTCSwap");
  const feeAmount = ethers.parseEther("0.1"); // 0.1 tokens as fee
  const allowedTokens = [
    await feeToken.getAddress(), 
    await tradingToken1.getAddress(), 
    await tradingToken2.getAddress()
  ];

  const otcSwap = await OTCSwap.deploy(
    await feeToken.getAddress(),
    feeAmount,
    allowedTokens
  );
  await otcSwap.waitForDeployment();
  console.log("✅ OTCSwap deployed to:", await otcSwap.getAddress());

  console.log("\n🚰 Deploying Faucet...");
  
  // Deploy Faucet
  const Faucet = await ethers.getContractFactory("Faucet");
  
  // Amounts in wei (18 decimals)
  const faucetFeeTokenAmount = ethers.parseEther("100"); // 100 tokens
  const faucetTradingTokenAmount = ethers.parseEther("1000"); // 1000 tokens
  const cooldownPeriod = 3600; // 1 hour in seconds

  const faucet = await Faucet.deploy(
    await feeToken.getAddress(),
    await tradingToken1.getAddress(),
    await tradingToken2.getAddress(),
    faucetFeeTokenAmount,
    faucetTradingTokenAmount,
    cooldownPeriod
  );
  await faucet.waitForDeployment();
  console.log("✅ Faucet deployed to:", await faucet.getAddress());

  console.log("\n🔐 Setting up permissions...");
  
  // Keep ownership with deployer for pause control
  console.log("✅ Token ownership kept with deployer for pause control");
  
  // Mint initial tokens to faucet for distribution
  const faucetAddress = await faucet.getAddress();
  const initialFaucetSupply = ethers.parseEther("10000"); // 10,000 tokens for faucet
  
  await feeToken.mint(faucetAddress, initialFaucetSupply);
  await tradingToken1.mint(faucetAddress, initialFaucetSupply);
  await tradingToken2.mint(faucetAddress, initialFaucetSupply);
  
  console.log("✅ Initial tokens minted to faucet for distribution");

  // Save comprehensive deployment info
  const deploymentInfo = {
    network: "amoy",
    deployer: deployer.address,
    contracts: {
      otcSwap: {
        address: await otcSwap.getAddress(),
        feeAmount: ethers.formatEther(feeAmount),
        allowedTokens: allowedTokens
      },
      feeToken: {
        address: await feeToken.getAddress(),
        name: "Fee Token",
        symbol: "FEE"
      },
      tradingToken1: {
        address: await tradingToken1.getAddress(),
        name: "Trading Token Alpha",
        symbol: "TTA"
      },
      tradingToken2: {
        address: await tradingToken2.getAddress(),
        name: "Trading Token Beta",
        symbol: "TTB"
      },
      faucet: {
        address: await faucet.getAddress(),
        feeTokenAmount: ethers.formatEther(faucetFeeTokenAmount),
        tradingTokenAmount: ethers.formatEther(faucetTradingTokenAmount),
        cooldownPeriod: cooldownPeriod
      }
    },
    timestamp: new Date().toISOString()
  };

  // Save to both files for compatibility
  fs.writeFileSync("deployment-info.json", JSON.stringify(deploymentInfo, null, 2));
  fs.writeFileSync("faucet-deployment.json", JSON.stringify(deploymentInfo, null, 2));
  console.log("✅ Deployment info saved to deployment-info.json and faucet-deployment.json");

  console.log("\n📝 Updating faucet.html...");
  
  // Update the HTML file
  let htmlContent = fs.readFileSync('faucet.html', 'utf8');
  
  // Replace the faucet address with the actual deployed address
  htmlContent = htmlContent.replace(
    /value="0x[a-fA-F0-9]{40}"/,
    `value="${await faucet.getAddress()}"`
  );
  
  // Add deployment info comment
  const timestamp = new Date().toISOString();
  const comment = `<!-- Auto-updated on ${timestamp} -->\n`;
  
  // Add comment at the top if not already present
  if (!htmlContent.includes('<!-- Auto-updated on')) {
    htmlContent = comment + htmlContent;
  } else {
    // Replace existing comment
    htmlContent = htmlContent.replace(
      /<!-- Auto-updated on .*? -->\n/,
      comment
    );
  }
  
  // Write back to file
  fs.writeFileSync('faucet.html', htmlContent);
  console.log("✅ faucet.html updated successfully");

  console.log("\n" + "=".repeat(70));
  console.log("🎉 ALL CONTRACTS DEPLOYED SUCCESSFULLY!");
  console.log("=".repeat(70));
  
  console.log("\n📊 Deployment Summary:");
  console.log("=====================");
  console.log(`🔹 OTCSwap: ${await otcSwap.getAddress()}`);
  console.log(`🔹 Fee Token: ${await feeToken.getAddress()}`);
  console.log(`🔹 Trading Token 1: ${await tradingToken1.getAddress()}`);
  console.log(`🔹 Trading Token 2: ${await tradingToken2.getAddress()}`);
  console.log(`🔹 Faucet: ${await faucet.getAddress()}`);
  console.log(`🔹 Fee Amount: ${ethers.formatEther(feeAmount)} tokens`);
  console.log(`🔹 Faucet Fee Token Amount: ${ethers.formatEther(faucetFeeTokenAmount)} tokens`);
  console.log(`🔹 Faucet Trading Token Amount: ${ethers.formatEther(faucetTradingTokenAmount)} tokens`);
  console.log(`🔹 Cooldown Period: ${cooldownPeriod} seconds (${cooldownPeriod / 3600} hours)`);
  
  console.log("\n🚀 Next Steps:");
  console.log("==============");
  console.log("1. Open faucet.html in a browser");
  console.log("2. Connect your wallet");
  console.log("3. The faucet address is already configured");
  console.log("4. Click 'Request Tokens' to get test tokens!");
  console.log("5. Use the tokens with the OTCSwap contract");
  console.log("6. Users can request tokens once per hour");
  
  console.log("\n💡 Features:");
  console.log("============");
  console.log("✅ Complete OTCSwap ecosystem deployed");
  console.log("✅ No private keys needed - fully public faucet");
  console.log("✅ Cooldown protection prevents abuse");
  console.log("✅ Automatic token minting");
  console.log("✅ User-friendly interface");
  console.log("✅ All contracts ready for testing");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

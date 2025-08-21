const { ethers } = require("hardhat");
const fs = require("fs");

async function main() {
  console.log("🚀 Deploying Faucet and updating configuration...");
  console.log("=".repeat(60));

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

  console.log("\n🚰 Deploying Faucet...");
  
  // Deploy Faucet
  const Faucet = await ethers.getContractFactory("Faucet");
  
  // Amounts in wei (18 decimals)
  const feeTokenAmount = ethers.parseEther("100"); // 100 tokens
  const tradingTokenAmount = ethers.parseEther("1000"); // 1000 tokens
  const cooldownPeriod = 3600; // 1 hour in seconds

  const faucet = await Faucet.deploy(
    await feeToken.getAddress(),
    await tradingToken1.getAddress(),
    await tradingToken2.getAddress(),
    feeTokenAmount,
    tradingTokenAmount,
    cooldownPeriod
  );
  await faucet.waitForDeployment();
  console.log("✅ Faucet deployed to:", await faucet.getAddress());

  console.log("\n🔐 Setting up permissions...");
  
  // Transfer ownership of tokens to faucet so it can mint
  await feeToken.transferOwnership(await faucet.getAddress());
  await tradingToken1.transferOwnership(await faucet.getAddress());
  await tradingToken2.transferOwnership(await faucet.getAddress());
  
  console.log("✅ Token ownership transferred to faucet");

  // Save deployment info
  const deploymentInfo = {
    network: "amoy",
    deployer: deployer.address,
    contracts: {
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
        feeTokenAmount: ethers.formatEther(feeTokenAmount),
        tradingTokenAmount: ethers.formatEther(tradingTokenAmount),
        cooldownPeriod: cooldownPeriod
      }
    },
    timestamp: new Date().toISOString()
  };

  fs.writeFileSync("faucet-deployment.json", JSON.stringify(deploymentInfo, null, 2));
  console.log("✅ Deployment info saved to faucet-deployment.json");

  console.log("\n📝 Updating faucet.html...");
  
  // Update the HTML file
  let htmlContent = fs.readFileSync('faucet.html', 'utf8');
  
  // Replace the placeholder value with the actual faucet address
  htmlContent = htmlContent.replace(
    /value=""/,
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

  console.log("\n" + "=".repeat(60));
  console.log("🎉 DEPLOYMENT COMPLETE!");
  console.log("=".repeat(60));
  
  console.log("\n📊 Deployment Summary:");
  console.log("=====================");
  console.log(`🔹 Fee Token: ${await feeToken.getAddress()}`);
  console.log(`🔹 Trading Token 1: ${await tradingToken1.getAddress()}`);
  console.log(`🔹 Trading Token 2: ${await tradingToken2.getAddress()}`);
  console.log(`🔹 Faucet: ${await faucet.getAddress()}`);
  console.log(`🔹 Fee Token Amount: ${ethers.formatEther(feeTokenAmount)} tokens`);
  console.log(`🔹 Trading Token Amount: ${ethers.formatEther(tradingTokenAmount)} tokens`);
  console.log(`🔹 Cooldown Period: ${cooldownPeriod} seconds (${cooldownPeriod / 3600} hours)`);
  
  console.log("\n🚀 Next Steps:");
  console.log("==============");
  console.log("1. Open faucet.html in a browser");
  console.log("2. Connect your wallet");
  console.log("3. The faucet address is already configured");
  console.log("4. Click 'Request Tokens' to get test tokens!");
  console.log("5. Users can request tokens once per hour");
  
  console.log("\n💡 Features:");
  console.log("============");
  console.log("✅ No private keys needed - fully public faucet");
  console.log("✅ Cooldown protection prevents abuse");
  console.log("✅ Automatic token minting");
  console.log("✅ User-friendly interface");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

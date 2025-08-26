const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function verifyContract(address, args, maxRetries = 3) {
  let retryCount = 0;
  
  while (retryCount < maxRetries) {
    try {
      console.log(`Verification attempt ${retryCount + 1}/${maxRetries}...`);
      
      await hre.run("verify:verify", {
        address: address,
        constructorArguments: args,
      });
      
      console.log("✅ Contract verified successfully");
      return true;
      
    } catch (error) {
      if (error.message.includes("Already Verified")) {
        console.log("✅ Contract already verified");
        return true;
      } else if (error.message.includes("does not have bytecode") || 
                 error.message.includes("Bytecode not found") ||
                 error.message.includes("Contract source code not verified")) {
        retryCount++;
        if (retryCount < maxRetries) {
          const waitTime = retryCount * 30; // Exponential backoff: 30s, 60s, 90s
          console.log(`❌ Verification failed (bytecode not ready). Waiting ${waitTime} seconds before retry...`);
          console.log("Error:", error.message);
          await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
        } else {
          console.error("❌ Max retries reached. Verification failed:", error.message);
          console.log("💡 Try running verification manually later with:");
          console.log(`npx hardhat verify --network polygon ${address} "${args[0]}" "${args[1]}" '${JSON.stringify(args[2])}'`);
          return false;
        }
      } else {
        console.error("❌ Verification failed with unexpected error:", error.message);
        return false;
      }
    }
  }
  
  return false;
}

async function main() {
  const DAI_ADDRESS = "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063";
  const LIBERDUS_ADDRESS = "0x693ed886545970F0a3ADf8C59af5cCdb6dDF0a76";
  const FEE_AMOUNT = ethers.parseUnits("1", 18); // 1 DAI with 18 decimals
  
  // Load allowed tokens from JSON file
  const allowedTokensPath = path.join(__dirname, "..", "allowed-tokens.json");
  let ALLOWED_TOKENS;
  
  try {
    const allowedTokensData = fs.readFileSync(allowedTokensPath, "utf8");
    ALLOWED_TOKENS = JSON.parse(allowedTokensData);
    console.log(`Loaded ${ALLOWED_TOKENS.length} allowed tokens from ${allowedTokensPath}`);
  } catch (error) {
    console.error("Error loading allowed tokens file:", error.message);
    console.log("Using fallback token list...");
    // Fallback to default tokens if file loading fails
    ALLOWED_TOKENS = [
      "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", // USDC
      "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", // WETH on Polygon
      "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6", // WBTC on Polygon
      "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", // USDC.e on Polygon
      DAI_ADDRESS,  // DAI on Polygon
      LIBERDUS_ADDRESS  // Liberdus token
    ];
  }

  console.log("Deploying OTCSwap contract...");
  console.log("Network:", network.name);

  const [deployer] = await ethers.getSigners();
  console.log("Deploying from:", deployer.address);

  const OTCSwap = await ethers.getContractFactory("OTCSwap");
  const otcSwap = await OTCSwap.deploy(DAI_ADDRESS, FEE_AMOUNT, ALLOWED_TOKENS, LIBERDUS_ADDRESS);

  await otcSwap.waitForDeployment();
  const address = await otcSwap.getAddress();

  console.log({
    address,
    dai: DAI_ADDRESS,
    liberdus: LIBERDUS_ADDRESS,
    feeAmount: ethers.formatUnits(FEE_AMOUNT, 18) + " DAI",
    allowedTokens: ALLOWED_TOKENS
  });

  if (network.name === "polygon" || network.name === "mumbai" || network.name === "amoy") {
    console.log("\n🔍 Starting contract verification process...");
    console.log("⏳ Waiting for block confirmations (this may take a few minutes)...");
    
    // Wait for more confirmations to ensure the contract is properly indexed
    const confirmations = network.name === "polygon" ? 10 : 5;
    await otcSwap.deploymentTransaction().wait(confirmations);
    console.log(`✅ ${confirmations} confirmations received`);
    
    // Additional wait time for Polygon explorer to index the contract
    console.log("⏳ Waiting additional 60 seconds for explorer to index the contract...");
    await new Promise(resolve => setTimeout(resolve, 60000));
    
    console.log("🚀 Starting verification...");
    const verificationSuccess = await verifyContract(address, [DAI_ADDRESS, FEE_AMOUNT, ALLOWED_TOKENS, LIBERDUS_ADDRESS]);
    
    if (!verificationSuccess) {
      console.log("\n📝 Manual verification command:");
      console.log(`npx hardhat verify --network ${network.name} ${address} "${DAI_ADDRESS}" "${FEE_AMOUNT}" '${JSON.stringify(ALLOWED_TOKENS)}' "${LIBERDUS_ADDRESS}"`);
    }
  } else {
    console.log("ℹ️  Skipping verification (not on a supported network)");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

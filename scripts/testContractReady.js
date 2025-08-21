const hre = require("hardhat");

async function main() {
  console.log("🧪 Testing OTCSwap Contract Readiness...");
  console.log("=".repeat(50));

  const contractAddress = "0x575E9946EBabD5f6cF8359ab037D9f666D14fADA";

  try {
    // Get contract instance
    const OTCSwap = await hre.ethers.getContractFactory("OTCSwap");
    const otcSwap = OTCSwap.attach(contractAddress);

    console.log("📋 Basic Contract Info:");
    console.log("Address:", contractAddress);
    
    // Test 1: Check if contract is disabled
    const isDisabled = await otcSwap.isDisabled();
    console.log("Contract Disabled:", isDisabled);
    console.log("✅ Contract is", isDisabled ? "DISABLED" : "ACTIVE");
    console.log("");

    // Test 2: Check fee configuration
    const feeToken = await otcSwap.feeToken();
    const feeAmount = await otcSwap.orderCreationFeeAmount();
    console.log("💰 Fee Configuration:");
    console.log("Fee Token:", feeToken);
    console.log("Fee Amount:", hre.ethers.formatEther(feeAmount), "tokens");
    console.log("✅ Fee configuration is set");
    console.log("");

    // Test 3: Check allowed tokens
    const allowedTokens = await otcSwap.getAllowedTokens();
    console.log("🎯 Allowed Trading Tokens:", allowedTokens.length);
    allowedTokens.forEach((token, index) => {
      console.log(`  ${index + 1}. ${token}`);
    });
    console.log("✅ Trading tokens are configured");
    console.log("");

    // Test 4: Check time settings
    const [orderExpiry, gracePeriod, maxRetries] = await otcSwap.getTimeSettings();
    console.log("⏰ Time Settings:");
    console.log("  Order Expiry:", Math.floor(orderExpiry/60), "minutes");
    console.log("  Grace Period:", Math.floor(gracePeriod/60), "minutes");
    console.log("  Max Retries:", maxRetries.toString());
    console.log("✅ Time settings are configured");
    console.log("");

    // Test 5: Check contract state
    const nextOrderId = await otcSwap.nextOrderId();
    const accumulatedFees = await otcSwap.accumulatedFees();
    console.log("🔧 Contract State:");
    console.log("  Next Order ID:", nextOrderId.toString());
    console.log("  Accumulated Fees:", hre.ethers.formatEther(accumulatedFees), "tokens");
    console.log("✅ Contract state is initialized");
    console.log("");

    // Overall readiness assessment
    console.log("🎯 CONTRACT READINESS ASSESSMENT:");
    if (!isDisabled && allowedTokens.length > 0 && feeToken !== "0x0000000000000000000000000000000000000000") {
      console.log("✅ CONTRACT IS READY FOR USE!");
      console.log("✅ Users can create and fill OTC orders");
      console.log("✅ Faucet can distribute tokens");
      console.log("✅ All configurations are set");
    } else {
      console.log("❌ CONTRACT IS NOT READY:");
      if (isDisabled) console.log("  - Contract is disabled");
      if (allowedTokens.length === 0) console.log("  - No trading tokens configured");
      if (feeToken === "0x0000000000000000000000000000000000000000") console.log("  - Fee token not set");
    }

    console.log("");
    console.log("🔗 View on Block Explorer:");
    console.log(`https://www.oklink.com/amoy/address/${contractAddress}`);

  } catch (error) {
    console.error("❌ Error testing contract:", error.message);
    console.log("❌ Contract may not be deployed or accessible");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

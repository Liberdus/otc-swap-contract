const hre = require("hardhat");

async function main() {
  console.log("Checking deployed OTCSwap contract on Amoy...");
  console.log("=".repeat(50));

  // Contract address from deployment
  const contractAddress = "0x575E9946EBabD5f6cF8359ab037D9f666D14fADA";

  try {
    // Get contract instance
    const OTCSwap = await hre.ethers.getContractFactory("OTCSwap");
    const otcSwap = OTCSwap.attach(contractAddress);

    console.log("📋 Contract Information:");
    console.log("Address:", contractAddress);
    console.log("Network: Amoy Testnet");
    console.log("");

    // Check time settings
    console.log("⏰ Time Settings:");
    const [orderExpiry, gracePeriod, maxRetries] = await otcSwap.getTimeSettings();
    console.log("  Order Expiry:", orderExpiry.toString(), "seconds (", Math.floor(orderExpiry/60), "minutes)");
    console.log("  Grace Period:", gracePeriod.toString(), "seconds (", Math.floor(gracePeriod/60), "minutes)");
    console.log("  Max Retry Attempts:", maxRetries.toString());
    console.log("");

    // Check fee settings
    console.log("💰 Fee Settings:");
    const feeToken = await otcSwap.feeToken();
    const feeAmount = await otcSwap.orderCreationFeeAmount();
    console.log("  Fee Token:", feeToken);
    console.log("  Fee Amount:", hre.ethers.formatEther(feeAmount), "tokens");
    console.log("");

    // Check allowed tokens
    console.log("🎯 Allowed Trading Tokens:");
    const allowedTokens = await otcSwap.getAllowedTokens();
    allowedTokens.forEach((token, index) => {
      console.log(`  ${index + 1}. ${token}`);
    });
    console.log("");

    // Check contract state
    console.log("🔧 Contract State:");
    const isDisabled = await otcSwap.isDisabled();
    const accumulatedFees = await otcSwap.accumulatedFees();
    const nextOrderId = await otcSwap.nextOrderId();
    console.log("  Disabled:", isDisabled);
    console.log("  Accumulated Fees:", hre.ethers.formatEther(accumulatedFees), "tokens");
    console.log("  Next Order ID:", nextOrderId.toString());
    console.log("");

    console.log("✅ Contract check completed successfully!");
    console.log("");
    console.log("🔗 View on Block Explorer:");
    console.log(`https://www.oklink.com/amoy/address/${contractAddress}`);

  } catch (error) {
    console.error("❌ Error checking contract:", error.message);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

// Deployment script for TestToken with initial distribution
const hre = require("hardhat");

async function main() {
  console.log("Deploying TestToken with initial distribution...");

  // You can modify these parameters as needed
  const tokenName = "Test Token";
  const tokenSymbol = "TEST";

  // List of addresses to receive initial tokens
  const initialRecipients = [
    "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", // Example address 1
    "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", // Example address 2
    "0x90F79bf6EB2c4f870365E785982E1f101E93b906", // Example address 3
    // Add more addresses as needed
  ];

  // Amounts to send to each recipient (in tokens, will be converted to wei)
  const initialAmounts = [
    hre.ethers.parseEther("10000"),  // 10,000 tokens to address 1
    hre.ethers.parseEther("5000"),   // 5,000 tokens to address 2
    hre.ethers.parseEther("2500"),   // 2,500 tokens to address 3
    // Add more amounts as needed
  ];

  // Validate arrays have same length
  if (initialRecipients.length !== initialAmounts.length) {
    throw new Error("Recipients and amounts arrays must have the same length");
  }

  const TestToken = await hre.ethers.getContractFactory("TestToken");
  const testToken = await TestToken.deploy(tokenName, tokenSymbol, initialRecipients, initialAmounts);

  await testToken.waitForDeployment();

  console.log("TestToken deployed to:", testToken.target);
  console.log("Token name:", await testToken.name());
  console.log("Token symbol:", await testToken.symbol());
  console.log("Decimals:", await testToken.decimals());
  console.log("Total supply:", hre.ethers.formatEther(await testToken.totalSupply()));
  
  console.log("\nInitial token distribution:");
  for (let i = 0; i < initialRecipients.length; i++) {
    const balance = await testToken.balanceOf(initialRecipients[i]);
    console.log(`- ${initialRecipients[i]}: ${hre.ethers.formatEther(balance)} ${tokenSymbol}`);
  }
  
  console.log("\nAvailable functions:");
  console.log("- transfer(address to, uint256 amount): Standard ERC20 transfer");
  console.log("- approve(address spender, uint256 amount): Standard ERC20 approve");
  console.log("- transferFrom(address from, address to, uint256 amount): Standard ERC20 transferFrom");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

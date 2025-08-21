// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// You can also run a script with `npx hardhat run <script>`. If you do that, Hardhat
// will compile your contracts, add the Hardhat Runtime Environment's members to the
// global scope, and execute the script.
const hre = require("hardhat");

async function main() {
  console.log("Deploying MisbehavingToken with pause functionality...");

  const MisbehavingToken = await hre.ethers.getContractFactory("MisbehavingToken");
  const misbehavingToken = await MisbehavingToken.deploy();

  await misbehavingToken.waitForDeployment();

  console.log("MisbehavingToken deployed to:", misbehavingToken.target);
  console.log("Token name:", await misbehavingToken.name());
  console.log("Token symbol:", await misbehavingToken.symbol());
  console.log("Total supply:", hre.ethers.formatEther(await misbehavingToken.totalSupply()));
  console.log("Owner:", await misbehavingToken.owner());
  console.log("Paused status:", await misbehavingToken.paused());
  
  console.log("\nPause functions available:");
  console.log("- pause(): Pauses all token transfers (owner only)");
  console.log("- unpause(): Resumes token transfers (owner only)");
  console.log("- mint(address to, uint256 amount): Mints new tokens (anyone can call)");
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

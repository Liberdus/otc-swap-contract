const fs = require('fs');

async function updateFaucetConfig() {
  try {
    // Read deployment info
    const deploymentInfo = JSON.parse(fs.readFileSync('faucet-deployment.json', 'utf8'));
    
    // Read the HTML file
    let htmlContent = fs.readFileSync('faucet.html', 'utf8');
    
    // Update the faucet address in the HTML
    const faucetAddress = deploymentInfo.contracts.faucet.address;
    
    // Replace the placeholder value with the actual faucet address
    htmlContent = htmlContent.replace(
      /value=""/,
      `value="${faucetAddress}"`
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
    
    console.log('✅ Faucet configuration updated successfully!');
    console.log(`📝 Faucet address: ${faucetAddress}`);
    console.log(`📝 Fee token amount: ${deploymentInfo.contracts.faucet.feeTokenAmount} tokens`);
    console.log(`📝 Trading token amount: ${deploymentInfo.contracts.faucet.tradingTokenAmount} tokens`);
    console.log(`📝 Cooldown period: ${deploymentInfo.contracts.faucet.cooldownPeriod} seconds`);
    
  } catch (error) {
    console.error('❌ Error updating faucet configuration:', error.message);
    process.exit(1);
  }
}

updateFaucetConfig();

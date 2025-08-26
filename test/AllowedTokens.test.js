const { expect } = require('chai')
const { ethers } = require('hardhat')

describe('OTCSwap - Allowed Tokens', function () {
  let otcSwap
  let tokenA
  let tokenB
  let tokenC
  let feeToken
  let owner
  let alice

  const ORDER_FEE = ethers.parseUnits('1', 6) // $1 in USDC (6 decimals)

  beforeEach(async function () {
    [owner, alice] = await ethers.getSigners()

    // Deploy test tokens
    const TestToken = await ethers.getContractFactory('TestToken')
    tokenA = await TestToken.deploy('Token A', 'TKA')
    await tokenA.waitForDeployment()
    tokenB = await TestToken.deploy('Token B', 'TKB')
    await tokenB.waitForDeployment()
    tokenC = await TestToken.deploy('Token C', 'TKC')
    await tokenC.waitForDeployment()

    // Deploy fee token (USDC mock with 6 decimals)
    const FeeToken = await ethers.getContractFactory('TestTokenDecimals')
    feeToken = await FeeToken.deploy('USD Coin', 'USDC', 6)
    await feeToken.waitForDeployment()

    // Mint fee tokens to owner
    await feeToken.mint(owner.address, ORDER_FEE * BigInt(100))

    // Deploy OTCSwap with tokenA and tokenB as allowed tokens
    const OTCSwap = await ethers.getContractFactory('OTCSwap')
    otcSwap = await OTCSwap.deploy(feeToken.target, ORDER_FEE, [tokenA.target, tokenB.target, feeToken.target])
    await otcSwap.waitForDeployment()

    // Setup tokens for Alice
    await tokenA.transfer(alice.address, ethers.parseEther('1000'))
    await tokenB.transfer(alice.address, ethers.parseEther('1000'))
    await tokenC.transfer(alice.address, ethers.parseEther('1000'))
    await feeToken.transfer(alice.address, ORDER_FEE * BigInt(10))
  })

  describe('Constructor', function () {
    it('should initialize allowed tokens correctly', async function () {
      expect(await otcSwap.allowedTokens(tokenA.target)).to.be.true
      expect(await otcSwap.allowedTokens(tokenB.target)).to.be.true
      expect(await otcSwap.allowedTokens(feeToken.target)).to.be.true
      expect(await otcSwap.allowedTokens(tokenC.target)).to.be.false
    })

    it('should initialize allowed tokens list correctly', async function () {
      const allowedTokens = await otcSwap.getAllowedTokens()
      const count = await otcSwap.getAllowedTokensCount()
      
      expect(count).to.equal(3)
      expect(allowedTokens.length).to.equal(3)
      expect(allowedTokens).to.include(tokenA.target)
      expect(allowedTokens).to.include(tokenB.target)
      expect(allowedTokens).to.include(feeToken.target)
      expect(allowedTokens).to.not.include(tokenC.target)
    })

    it('should revert if no allowed tokens provided', async function () {
      const OTCSwap = await ethers.getContractFactory('OTCSwap')
      await expect(
        OTCSwap.deploy(feeToken.target, ORDER_FEE, [])
      ).to.be.revertedWith('Must specify allowed tokens')
    })

    it('should revert if invalid token address provided', async function () {
      const OTCSwap = await ethers.getContractFactory('OTCSwap')
      await expect(
        OTCSwap.deploy(feeToken.target, ORDER_FEE, [ethers.ZeroAddress])
      ).to.be.revertedWith('Invalid token address')
    })
  })

  describe('updateAllowedTokens', function () {
    it('should allow owner to update allowed tokens', async function () {
      // Add tokenC to allowed tokens
      const tx = await otcSwap.connect(owner).updateAllowedTokens([tokenC.target], [true])
      const receipt = await tx.wait()
      const block = await ethers.provider.getBlock(receipt.blockNumber)
      
      await expect(tx)
        .to.emit(otcSwap, 'AllowedTokensUpdated')
        .withArgs([tokenC.target], [true], block.timestamp)

      expect(await otcSwap.allowedTokens(tokenC.target)).to.be.true
    })

    it('should update allowed tokens list when adding tokens', async function () {
      const initialCount = await otcSwap.getAllowedTokensCount()
      const initialTokens = await otcSwap.getAllowedTokens()
      
      // Add tokenC to allowed tokens
      await otcSwap.connect(owner).updateAllowedTokens([tokenC.target], [true])
      
      const newCount = await otcSwap.getAllowedTokensCount()
      const newTokens = await otcSwap.getAllowedTokens()
      
      expect(newCount).to.equal(initialCount + BigInt(1))
      expect(newTokens.length).to.equal(initialTokens.length + 1)
      expect(newTokens).to.include(tokenC.target)
    })

    it('should allow owner to remove tokens from allowed list', async function () {
      // Remove tokenA from allowed tokens
      await otcSwap.connect(owner).updateAllowedTokens([tokenA.target], [false])
      expect(await otcSwap.allowedTokens(tokenA.target)).to.be.false
    })

    it('should update allowed tokens list when removing tokens', async function () {
      const initialCount = await otcSwap.getAllowedTokensCount()
      const initialTokens = await otcSwap.getAllowedTokens()
      
      // Remove tokenA from allowed tokens
      await otcSwap.connect(owner).updateAllowedTokens([tokenA.target], [false])
      
      const newCount = await otcSwap.getAllowedTokensCount()
      const newTokens = await otcSwap.getAllowedTokens()
      
      expect(newCount).to.equal(initialCount - BigInt(1))
      expect(newTokens.length).to.equal(initialTokens.length - 1)
      expect(newTokens).to.not.include(tokenA.target)
    })

    it('should allow batch updates', async function () {
      // Add tokenC and remove tokenA in one call
      await otcSwap.connect(owner).updateAllowedTokens(
        [tokenA.target, tokenC.target],
        [false, true]
      )

      expect(await otcSwap.allowedTokens(tokenA.target)).to.be.false
      expect(await otcSwap.allowedTokens(tokenC.target)).to.be.true
    })

    it('should handle batch updates in allowed tokens list', async function () {
      const initialCount = await otcSwap.getAllowedTokensCount()
      
      // Add tokenC and remove tokenA in one call (net change: 0)
      await otcSwap.connect(owner).updateAllowedTokens(
        [tokenA.target, tokenC.target],
        [false, true]
      )
      
      const newCount = await otcSwap.getAllowedTokensCount()
      const newTokens = await otcSwap.getAllowedTokens()
      
      expect(newCount).to.equal(initialCount) // Same count since we added 1 and removed 1
      expect(newTokens).to.not.include(tokenA.target)
      expect(newTokens).to.include(tokenC.target)
    })

    it('should revert if not called by owner', async function () {
      await expect(
        otcSwap.connect(alice).updateAllowedTokens([tokenC.target], [true])
      ).to.be.revertedWithCustomError(otcSwap, 'OwnableUnauthorizedAccount')
    })

    it('should revert if arrays length mismatch', async function () {
      await expect(
        otcSwap.connect(owner).updateAllowedTokens([tokenA.target, tokenB.target], [true])
      ).to.be.revertedWith('Arrays length mismatch')
    })

    it('should revert if empty arrays provided', async function () {
      await expect(
        otcSwap.connect(owner).updateAllowedTokens([], [])
      ).to.be.revertedWith('Empty arrays')
    })

    it('should revert if invalid token address provided', async function () {
      await expect(
        otcSwap.connect(owner).updateAllowedTokens([ethers.ZeroAddress], [true])
      ).to.be.revertedWith('Invalid token address')
    })
  })

  describe('getAllowedTokens and getAllowedTokensCount', function () {
    it('should return correct initial allowed tokens list', async function () {
      const allowedTokens = await otcSwap.getAllowedTokens()
      const count = await otcSwap.getAllowedTokensCount()
      
      expect(count).to.equal(3)
      expect(allowedTokens.length).to.equal(3)
      
      // Check that all initial tokens are present
      expect(allowedTokens).to.include(tokenA.target)
      expect(allowedTokens).to.include(tokenB.target)
      expect(allowedTokens).to.include(feeToken.target)
    })

    it('should return updated list after adding tokens', async function () {
      // Add tokenC
      await otcSwap.connect(owner).updateAllowedTokens([tokenC.target], [true])
      
      const allowedTokens = await otcSwap.getAllowedTokens()
      const count = await otcSwap.getAllowedTokensCount()
      
      expect(count).to.equal(4)
      expect(allowedTokens.length).to.equal(4)
      expect(allowedTokens).to.include(tokenC.target)
    })

    it('should return updated list after removing tokens', async function () {
      // Remove tokenA
      await otcSwap.connect(owner).updateAllowedTokens([tokenA.target], [false])
      
      const allowedTokens = await otcSwap.getAllowedTokens()
      const count = await otcSwap.getAllowedTokensCount()
      
      expect(count).to.equal(2)
      expect(allowedTokens.length).to.equal(2)
      expect(allowedTokens).to.not.include(tokenA.target)
      expect(allowedTokens).to.include(tokenB.target)
      expect(allowedTokens).to.include(feeToken.target)
    })

    it('should handle multiple add/remove operations correctly', async function () {
      // Initial state: tokenA, tokenB, feeToken (3 tokens)
      
      // Add tokenC
      await otcSwap.connect(owner).updateAllowedTokens([tokenC.target], [true])
      let count = await otcSwap.getAllowedTokensCount()
      expect(count).to.equal(4)
      
      // Remove tokenA and tokenB
      await otcSwap.connect(owner).updateAllowedTokens([tokenA.target, tokenB.target], [false, false])
      count = await otcSwap.getAllowedTokensCount()
      expect(count).to.equal(2)
      
      // Final list should contain only feeToken and tokenC
      const finalTokens = await otcSwap.getAllowedTokens()
      expect(finalTokens.length).to.equal(2)
      expect(finalTokens).to.include(feeToken.target)
      expect(finalTokens).to.include(tokenC.target)
      expect(finalTokens).to.not.include(tokenA.target)
      expect(finalTokens).to.not.include(tokenB.target)
    })

    it('should return empty list if all tokens are removed', async function () {
      // Remove all tokens
      await otcSwap.connect(owner).updateAllowedTokens(
        [tokenA.target, tokenB.target, feeToken.target], 
        [false, false, false]
      )
      
      const allowedTokens = await otcSwap.getAllowedTokens()
      const count = await otcSwap.getAllowedTokensCount()
      
      expect(count).to.equal(0)
      expect(allowedTokens.length).to.equal(0)
    })

    it('should maintain consistency between mapping and list', async function () {
      // Add and remove tokens in various combinations
      await otcSwap.connect(owner).updateAllowedTokens([tokenC.target], [true])
      await otcSwap.connect(owner).updateAllowedTokens([tokenA.target], [false])
      
      const allowedTokens = await otcSwap.getAllowedTokens()
      
      // Verify each token in the list is actually allowed in the mapping
      for (const tokenAddress of allowedTokens) {
        const isAllowed = await otcSwap.allowedTokens(tokenAddress)
        expect(isAllowed).to.be.true
      }
      
      // Verify tokenA is not in the list and not allowed
      expect(allowedTokens).to.not.include(tokenA.target)
      expect(await otcSwap.allowedTokens(tokenA.target)).to.be.false
      
      // Verify tokenC is in the list and allowed
      expect(allowedTokens).to.include(tokenC.target)
      expect(await otcSwap.allowedTokens(tokenC.target)).to.be.true
    })
  })

  describe('createOrder with allowed tokens restriction', function () {
    beforeEach(async function () {
      // Setup approvals for Alice
      await tokenA.connect(alice).approve(otcSwap.target, ethers.parseEther('100'))
      await tokenB.connect(alice).approve(otcSwap.target, ethers.parseEther('100'))
      await tokenC.connect(alice).approve(otcSwap.target, ethers.parseEther('100'))
      await feeToken.connect(alice).approve(otcSwap.target, ORDER_FEE * BigInt(10))
    })

    it('should allow creating order with allowed tokens', async function () {
      const sellAmount = ethers.parseEther('100')
      const buyAmount = ethers.parseEther('200')

      await expect(
        otcSwap.connect(alice).createOrder(
          ethers.ZeroAddress,
          tokenA.target,
          sellAmount,
          tokenB.target,
          buyAmount
        )
      ).to.emit(otcSwap, 'OrderCreated')
    })

    it('should reject order with non-allowed sell token', async function () {
      const sellAmount = ethers.parseEther('100')
      const buyAmount = ethers.parseEther('200')

      await expect(
        otcSwap.connect(alice).createOrder(
          ethers.ZeroAddress,
          tokenC.target, // tokenC is not allowed
          sellAmount,
          tokenB.target,
          buyAmount
        )
      ).to.be.revertedWith('Sell token not allowed')
    })

    it('should reject order with non-allowed buy token', async function () {
      const sellAmount = ethers.parseEther('100')
      const buyAmount = ethers.parseEther('200')

      await expect(
        otcSwap.connect(alice).createOrder(
          ethers.ZeroAddress,
          tokenA.target,
          sellAmount,
          tokenC.target, // tokenC is not allowed
          buyAmount
        )
      ).to.be.revertedWith('Buy token not allowed')
    })

    it('should allow order after token is added to allowed list', async function () {
      const sellAmount = ethers.parseEther('100')
      const buyAmount = ethers.parseEther('200')

      // First, try to create order with tokenC (should fail)
      await expect(
        otcSwap.connect(alice).createOrder(
          ethers.ZeroAddress,
          tokenC.target,
          sellAmount,
          tokenB.target,
          buyAmount
        )
      ).to.be.revertedWith('Sell token not allowed')

      // Verify tokenC is not in the allowed list
      let allowedTokens = await otcSwap.getAllowedTokens()
      expect(allowedTokens).to.not.include(tokenC.target)

      // Add tokenC to allowed list
      await otcSwap.connect(owner).updateAllowedTokens([tokenC.target], [true])

      // Verify tokenC is now in the allowed list
      allowedTokens = await otcSwap.getAllowedTokens()
      expect(allowedTokens).to.include(tokenC.target)
      expect(await otcSwap.getAllowedTokensCount()).to.equal(4)

      // Now the order should succeed
      await expect(
        otcSwap.connect(alice).createOrder(
          ethers.ZeroAddress,
          tokenC.target,
          sellAmount,
          tokenB.target,
          buyAmount
        )
      ).to.emit(otcSwap, 'OrderCreated')
    })
  })

  async function getLatestTimestamp() {
    const block = await ethers.provider.getBlock('latest')
    return block.timestamp
  }
})

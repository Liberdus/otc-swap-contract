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
      await expect(
        otcSwap.connect(owner).updateAllowedTokens([tokenC.target], [true])
      ).to.emit(otcSwap, 'AllowedTokensUpdated')
        .withArgs([tokenC.target], [true], await getLatestTimestamp())

      expect(await otcSwap.allowedTokens(tokenC.target)).to.be.true
    })

    it('should allow owner to remove tokens from allowed list', async function () {
      // Remove tokenA from allowed tokens
      await otcSwap.connect(owner).updateAllowedTokens([tokenA.target], [false])
      expect(await otcSwap.allowedTokens(tokenA.target)).to.be.false
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

      // Add tokenC to allowed list
      await otcSwap.connect(owner).updateAllowedTokens([tokenC.target], [true])

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

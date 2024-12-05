const { expect } = require('chai')
const { ethers } = require('hardhat')
const { time } = require('@nomicfoundation/hardhat-toolbox/network-helpers')

describe('OTCSwap', function () {
  let otcSwap
  let tokenA
  let tokenB
  let owner
  let alice
  let bob
  let charlie

  const INITIAL_SUPPLY = ethers.parseEther('1000000')
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
  const ORDER_EXPIRY = 7 * 24 * 60 * 60 // 7 days in seconds
  const GRACE_PERIOD = 7 * 24 * 60 * 60 // 7 days in seconds

  // Fixed test values
  const sellAmount = ethers.parseEther('100')
  const buyAmount = ethers.parseEther('200')
  const FIRST_ORDER_FEE = ethers.parseEther('0.01') // Any value works for first order

  beforeEach(async function () {
    [owner, alice, bob, charlie] = await ethers.getSigners()

    const TestToken = await ethers.getContractFactory('TestToken')
    tokenA = await TestToken.deploy('Token A', 'TKA')
    await tokenA.waitForDeployment()
    tokenB = await TestToken.deploy('Token B', 'TKB')
    await tokenB.waitForDeployment()

    const OTCSwap = await ethers.getContractFactory('OTCSwap')
    otcSwap = await OTCSwap.deploy()
    await otcSwap.waitForDeployment()

    // Distribute tokens
    await tokenA.transfer(alice.address, INITIAL_SUPPLY / BigInt(4))
    await tokenA.transfer(bob.address, INITIAL_SUPPLY / BigInt(4))
    await tokenA.transfer(charlie.address, INITIAL_SUPPLY / BigInt(4))
    await tokenB.transfer(alice.address, INITIAL_SUPPLY / BigInt(4))
    await tokenB.transfer(bob.address, INITIAL_SUPPLY / BigInt(4))
    await tokenB.transfer(charlie.address, INITIAL_SUPPLY / BigInt(4))
  });

  describe('Contract Administration', function () {
    it('should allow owner to disable contract', async function () {
      const latestTime = await time.latest()
      const tx = await otcSwap.connect(owner).disableContract()
      await expect(tx)
        .to.emit(otcSwap, 'ContractDisabled')
        .withArgs(owner.address, latestTime + 1)
      expect(await otcSwap.isDisabled()).to.be.true
    })

    it('should prevent non-owner from disabling contract', async function () {
      await expect(otcSwap.connect(alice).disableContract())
        .to.be.revertedWithCustomError(otcSwap, 'OwnableUnauthorizedAccount')
        .withArgs(alice.address)
    })

    it('should prevent creating orders when contract is disabled', async function () {
      await otcSwap.connect(owner).disableContract()
      await tokenA.connect(alice).approve(otcSwap.target, sellAmount)
      await expect(otcSwap.connect(alice).createOrder(
        ZERO_ADDRESS,
        tokenA.target,
        sellAmount,
        tokenB.target,
        buyAmount,
        { value: FIRST_ORDER_FEE }
      )).to.be.revertedWith('Contract is disabled')
    })
  });

  describe('Order Creation with Fees', function () {
    beforeEach(async function () {
      // Approve enough tokens for multiple orders
      await tokenA.connect(alice).approve(otcSwap.target, sellAmount * BigInt(5))
    })

    it('should accept any fee for first order', async function () {
      await expect(otcSwap.connect(alice).createOrder(
        ZERO_ADDRESS,
        tokenA.target,
        sellAmount,
        tokenB.target,
        buyAmount,
        { value: FIRST_ORDER_FEE }
      )).to.not.be.reverted
    })

    it('should enforce fee limits for subsequent orders', async function () {
      // Create first order to establish fee baseline
      await otcSwap.connect(alice).createOrder(
        ZERO_ADDRESS,
        tokenA.target,
        sellAmount,
        tokenB.target,
        buyAmount,
        { value: FIRST_ORDER_FEE }
      )

      const currentFee = await otcSwap.orderCreationFee()

      // Ensure currentFee is not 0
      expect(currentFee).to.be.gt(0, 'Fee should be greater than 0 after first order')

      const minFee = (currentFee * BigInt(90)) / BigInt(100) // 90%
      const maxFee = (currentFee * BigInt(150)) / BigInt(100) // 150%

      // Test fee too low
      await expect(otcSwap.connect(alice).createOrder(
        ZERO_ADDRESS,
        tokenA.target,
        sellAmount,
        tokenB.target,
        buyAmount,
        { value: minFee - BigInt(1) }
      )).to.be.revertedWith('Fee too low')

      // Test fee too high
      await expect(otcSwap.connect(alice).createOrder(
        ZERO_ADDRESS,
        tokenA.target,
        sellAmount,
        tokenB.target,
        buyAmount,
        { value: maxFee + BigInt(1) }
      )).to.be.revertedWith('Fee too high')

      // Test acceptable fee
      await expect(otcSwap.connect(alice).createOrder(
        ZERO_ADDRESS,
        tokenA.target,
        sellAmount,
        tokenB.target,
        buyAmount,
        { value: currentFee }
      )).to.not.be.reverted
    });

    it('should accumulate fees correctly', async function () {
      const initialAccumulatedFees = await otcSwap.accumulatedFees()

      await otcSwap.connect(alice).createOrder(
        ZERO_ADDRESS,
        tokenA.target,
        sellAmount,
        tokenB.target,
        buyAmount,
        { value: FIRST_ORDER_FEE }
      )

      expect(await otcSwap.accumulatedFees()).to.equal(initialAccumulatedFees + FIRST_ORDER_FEE)
    });
  });

  describe('Order Filling', function () {
    const sellAmount = ethers.parseEther('100')
    const buyAmount = ethers.parseEther('200')
    let orderId

    beforeEach(async function () {
      // Approve tokens for alice (maker)
      await tokenA.connect(alice).approve(otcSwap.target, sellAmount)
      // Transfer and approve tokens for bob (taker)
      await tokenB.connect(bob).approve(otcSwap.target, buyAmount)

      // Create an order as alice
      await otcSwap.connect(alice).createOrder(
        ZERO_ADDRESS, // public order
        tokenA.target,
        sellAmount,
        tokenB.target,
        buyAmount,
        { value: FIRST_ORDER_FEE }
      )
      orderId = 0
    });

    it('should successfully fill a valid order', async function () {
      // Check initial balances
      const aliceInitialTokenB = await tokenB.balanceOf(alice.address)
      const bobInitialTokenA = await tokenA.balanceOf(bob.address)

      // Pre-approve tokens and transfer buyTokens from bob to contract
      // await tokenB.connect(bob).transfer(otcSwap.target, buyAmount)

      // approve tokens for bob
      await tokenB.connect(bob).approve(otcSwap.target, buyAmount)

      // log order amounts
      const order = await otcSwap.orders(orderId)

      // check balance of sell token in contract
      const balanceBefore = await tokenA.balanceOf(otcSwap.target)

      // check the balance of buy token in contract
      const balanceBeforeBuy = await tokenB.balanceOf(otcSwap.target)

      // check the balance of buy token in bob
      const balanceBeforeBob = await tokenB.balanceOf(bob.address)

      // check the allowance of buy token for the contract by bob
      const allowanceBefore = await tokenB.allowance(bob.address, otcSwap.target)

      // Fill order
      await otcSwap.connect(bob).fillOrder(orderId)

      // Check final balances
      expect(await tokenB.balanceOf(alice.address)).to.equal(aliceInitialTokenB + buyAmount)
      expect(await tokenA.balanceOf(bob.address)).to.equal(bobInitialTokenA + sellAmount)
    })

    it('should enforce taker restrictions', async function () {
      // Create order with specific taker
      await tokenA.connect(alice).approve(otcSwap.target, sellAmount)
      await otcSwap.connect(alice).createOrder(
        charlie.address, // specific taker
        tokenA.target,
        sellAmount,
        tokenB.target,
        buyAmount,
        { value: await otcSwap.orderCreationFee() }
      )

      // Setup for bob's attempt
      await tokenB.connect(bob).approve(otcSwap.target, buyAmount)
      await tokenB.connect(bob).transfer(otcSwap.target, buyAmount)

      // Setup for charlie's attempt
      await tokenB.connect(charlie).approve(otcSwap.target, buyAmount)
      await tokenB.connect(charlie).transfer(otcSwap.target, buyAmount)

      // Bob should not be able to fill
      await expect(otcSwap.connect(bob).fillOrder(1))
        .to.be.revertedWith('Not authorized to fill this order')

      // Charlie should be able to fill
      await otcSwap.connect(charlie).fillOrder(1)
    })

    it('should handle insufficient balance issues', async function () {
      // Transfer all tokens away
      const balance = await tokenB.balanceOf(bob.address)
      await tokenB.connect(bob).transfer(charlie.address, balance)

      await expect(otcSwap.connect(bob).fillOrder(orderId))
        .to.be.revertedWith('Insufficient balance for buy token')
    })

    it('should emit correct events on fill', async function () {
      // Pre-transfer buyTokens
      await tokenB.connect(bob).transfer(otcSwap.target, buyAmount)

      const tx = await otcSwap.connect(bob).fillOrder(orderId)
      await expect(tx)
        .to.emit(otcSwap, 'OrderFilled')
        .withArgs(
          orderId,
          alice.address,
          bob.address,
          tokenA.target,
          sellAmount,
          tokenB.target,
          buyAmount,
          await time.latest()
        )
    })

    it('should handle sequential fills correctly', async function () {
      // Create multiple orders
      await tokenA.connect(alice).approve(otcSwap.target, sellAmount * BigInt(3))

      for (let i = 1; i < 3; i++) {
        await otcSwap.connect(alice).createOrder(
          ZERO_ADDRESS,
          tokenA.target,
          sellAmount,
          tokenB.target,
          buyAmount,
          { value: await otcSwap.orderCreationFee() }
        );
      }

      // Pre-transfer all buyTokens needed
      // await tokenB.connect(bob).transfer(otcSwap.target, buyAmount * BigInt(3))

      // approve all buyTokens needed
      await tokenB.connect(bob).approve(otcSwap.target, buyAmount * BigInt(3))

      // Fill orders sequentially
      for (let i = 0; i < 3; i++) {
        await otcSwap.connect(bob).fillOrder(i)
        const order = await otcSwap.orders(i)
        expect(order.status).to.equal(1) // Filled status
      }
    });
  });

  describe('Order Cleanup', function () {
    beforeEach(async function () {
      // Approve enough tokens for multiple orders
      await tokenA.connect(alice).approve(otcSwap.target, sellAmount * BigInt(5))

      // Create first order with any fee
      await otcSwap.connect(alice).createOrder(
        ZERO_ADDRESS,
        tokenA.target,
        sellAmount,
        tokenB.target,
        buyAmount,
        { value: FIRST_ORDER_FEE }
      );

      // Create additional orders with updated fees
      for (let i = 0; i < 2; i++) {
        // Get current fee before each order
        const currentFee = await otcSwap.orderCreationFee()

        await otcSwap.connect(alice).createOrder(
          ZERO_ADDRESS,
          tokenA.target,
          sellAmount,
          tokenB.target,
          buyAmount,
          { value: currentFee }
        )
      }
    });

    it('should cleanup expired orders', async function () {
      await time.increase(ORDER_EXPIRY + GRACE_PERIOD + 1)

      const initialBalance = await ethers.provider.getBalance(charlie.address)
      await otcSwap.connect(charlie).cleanupExpiredOrders()

      const finalBalance = await ethers.provider.getBalance(charlie.address)
      expect(finalBalance).to.be.gt(initialBalance)

      // Verify orders were cleaned up
      const firstOrder = await otcSwap.orders(0)
      expect(firstOrder.maker).to.equal(ZERO_ADDRESS)
    });
  });

  describe('Order Lifecycle', function () {
    let orderId

    beforeEach(async function () {
      await tokenA.connect(alice).approve(otcSwap.target, sellAmount * BigInt(2))

      await otcSwap.connect(alice).createOrder(
        ZERO_ADDRESS,
        tokenA.target,
        sellAmount,
        tokenB.target,
        buyAmount,
        { value: await otcSwap.orderCreationFee() }
      )
      orderId = 0
    });

    it('should track order status correctly through lifecycle', async function () {
      let order = await otcSwap.orders(orderId)
      expect(order.status).to.equal(0) // OrderStatus.Active

      // Setup for fill
      await tokenB.connect(bob).approve(otcSwap.target, buyAmount)
      await tokenB.connect(bob).transfer(otcSwap.target, buyAmount)

      await otcSwap.connect(bob).fillOrder(orderId)

      order = await otcSwap.orders(orderId)
      expect(order.status).to.equal(1) // OrderStatus.Filled
    })
  });

  describe('Order Cancellation - Edge Cases', function () {
    beforeEach(async function () {
      await tokenA.connect(alice).approve(otcSwap.target, sellAmount * BigInt(5))
      // Create multiple orders
      for (let i = 0; i < 3; i++) {
        await otcSwap.connect(alice).createOrder(
          ZERO_ADDRESS,
          tokenA.target,
          sellAmount,
          tokenB.target,
          buyAmount,
          { value: i === 0 ? FIRST_ORDER_FEE : await otcSwap.orderCreationFee() }
        )
      }
    });

    it('should prevent cancellation after grace period', async function () {
      await time.increase(ORDER_EXPIRY + GRACE_PERIOD + 1)
      await expect(otcSwap.connect(alice).cancelOrder(0))
        .to.be.revertedWith('Grace period has expired')
    })

    it('should allow cancellation just before grace period ends', async function () {
      await time.increase(ORDER_EXPIRY + GRACE_PERIOD - 60) // 1 minute before expiry
      await expect(otcSwap.connect(alice).cancelOrder(0))
        .to.not.be.reverted
    })

    it('should prevent cancellation of filled orders', async function () {
      // Setup token approvals and transfers
      await tokenB.connect(bob).approve(otcSwap.target, buyAmount)
      await tokenB.connect(bob).transfer(otcSwap.target, buyAmount)

      // Fill the order
      await otcSwap.connect(bob).fillOrder(0)

      // Try to cancel filled order
      await expect(otcSwap.connect(alice).cancelOrder(0))
        .to.be.revertedWith('Order is not active')
    });

    it('should prevent cancellation by non-maker', async function () {
      await expect(otcSwap.connect(bob).cancelOrder(0))
        .to.be.revertedWith('Only maker can cancel order')
    })

    it('should handle cancellation of multiple orders in same block', async function () {
      for (let i = 0; i < 3; i++) {
        await otcSwap.connect(alice).cancelOrder(i)
        const order = await otcSwap.orders(i)
        expect(order.status).to.equal(2) // Canceled status
      }
    });
  });

  describe('Order Cleanup - Edge Cases', function () {
    let misbehavingToken

    it('should handle failed token transfers during cleanup', async function () {
      // Deploy pausable token
      const PausableToken = await ethers.getContractFactory('MisbehavingToken')
      const pausableToken = await PausableToken.deploy()

      // Give Alice some tokens
      await pausableToken.mint(alice.address, sellAmount)

      // Create order
      const currentFee = await otcSwap.orderCreationFee()
      await pausableToken.connect(alice).approve(otcSwap.target, sellAmount)

      const tx = await otcSwap.connect(alice).createOrder(
        ZERO_ADDRESS,
        pausableToken.target,
        sellAmount,
        tokenB.target,
        buyAmount,
        { value: currentFee || FIRST_ORDER_FEE }
      )
      await tx.wait()

      // Verify initial state
      const orderId = 0
      const originalOrder = await otcSwap.orders(orderId)
      // Pause the token
      await pausableToken.pause()

      // Advance time
      await time.increase(ORDER_EXPIRY + GRACE_PERIOD + 1)

      // check the balance of buy token in contract before cleanup
      const balanceBefore = await pausableToken.balanceOf(otcSwap.target)

      // Try cleanup
      const cleanupTx = await otcSwap.connect(charlie).cleanupExpiredOrders()
      const receipt = await cleanupTx.wait()

      // Print all events
      for (const log of receipt.logs) {
        try {
          const parsedLog = otcSwap.interface.parseLog(log)
          if (parsedLog) {
            // console.log('OTCSwap Event:', parsedLog.name)
            // console.log('Args:', parsedLog.args)
          }
        } catch (e) {
          try {
            const parsedLog = pausableToken.interface.parseLog(log)
            if (parsedLog) {
              // console.log('PausableToken Event:', parsedLog.name)
              // console.log('Args:', parsedLog.args)
            }
          } catch (e2) {
            // Skip unparseable logs
          }
        }
      }

      // Check final states
      const orderAfterCleanup = await otcSwap.orders(orderId)
      const newOrderId = await otcSwap.nextOrderId() - 1n
      const retryOrder = await otcSwap.orders(newOrderId)

      // check the balance of buy token in contract after cleanup
      const balanceAfter = await pausableToken.balanceOf(otcSwap.target)

      // Final state verification
      expect(retryOrder.tries).to.equal(1n)
    });

    it('should handle MAX_RETRY_ATTEMPTS correctly', async function () {
      // Deploy contracts
      const [owner, alice, bob, charlie] = await ethers.getSigners()
      const OTCSwap = await ethers.getContractFactory('OTCSwap')
      const otcSwap = await OTCSwap.deploy()

      const PausableToken = await ethers.getContractFactory('MisbehavingToken')
      const misbehavingToken = await PausableToken.deploy()
      const TokenB = await ethers.getContractFactory('MisbehavingToken')
      const tokenB = await TokenB.deploy()

      // Setup amounts
      const sellAmount = ethers.parseEther('100')
      const buyAmount = ethers.parseEther('50')
      const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

      // Mint tokens to Alice
      await misbehavingToken.mint(alice.address, sellAmount)

      // Create order
      await misbehavingToken.connect(alice).approve(otcSwap.target, sellAmount)
      await otcSwap.connect(alice).createOrder(
        ZERO_ADDRESS,
        misbehavingToken.target,
        sellAmount,
        tokenB.target,
        buyAmount,
        { value: await otcSwap.orderCreationFee() }
      )

      // Advance time and pause token
      await time.increase(ORDER_EXPIRY + GRACE_PERIOD + 1)
      await misbehavingToken.pause()

      const initialOrderId = await otcSwap.firstOrderId()

      // Perform cleanup MAX_RETRY_ATTEMPTS + 1 times
      for (let i = 0; i <= 10; i++) {
        await otcSwap.connect(charlie).cleanupExpiredOrders()
      }

      // The order should be deleted after max retries
      const order = await otcSwap.orders(initialOrderId)
      expect(order.maker).to.equal(ZERO_ADDRESS)
    });

    it('should maintain order status through failed cleanup attempts', async function () {
      // Deploy contracts
      const [owner, alice, bob, charlie] = await ethers.getSigners()
      const OTCSwap = await ethers.getContractFactory('OTCSwap')
      const otcSwap = await OTCSwap.deploy()

      const PausableToken = await ethers.getContractFactory('MisbehavingToken')
      const misbehavingToken = await PausableToken.deploy()
      const TokenB = await ethers.getContractFactory('MisbehavingToken')
      const tokenB = await TokenB.deploy()

      // Setup amounts
      const sellAmount = ethers.parseEther('100')
      const buyAmount = ethers.parseEther('50')
      const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

      // Mint tokens to Alice
      await misbehavingToken.mint(alice.address, sellAmount)

      // Create order
      await misbehavingToken.connect(alice).approve(otcSwap.target, sellAmount)
      const orderId = await otcSwap.connect(alice).createOrder(
        ZERO_ADDRESS,
        misbehavingToken.target,
        sellAmount,
        tokenB.target,
        buyAmount,
        { value: await otcSwap.orderCreationFee() }
      )

      // Advance time and pause token
      await time.increase(ORDER_EXPIRY + GRACE_PERIOD + 1)
      await misbehavingToken.pause()

      await otcSwap.connect(charlie).cleanupExpiredOrders()

      // Check that retry order maintains the same status
      const nextOrderId = await otcSwap.nextOrderId()
      const retryOrder = await otcSwap.orders(nextOrderId - BigInt(1))
      expect(retryOrder.status).to.equal(0) // Active
    });
  });
});

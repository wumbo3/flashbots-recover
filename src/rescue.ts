/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { BigNumber, providers, Wallet, ethers, PopulatedTransaction } from 'ethers'
import { FlashbotsBundleProvider, FlashbotsBundleResolution } from '@flashbots/ethers-provider-bundle'
import * as dotenv from 'dotenv'
import { BaseProvider } from '@ethersproject/providers'

dotenv.config()

const FLASHBOTS_AUTH_KEY = process.env.FLASHBOTS_AUTH_KEY

const GWEI = BigNumber.from(10).pow(9)
const PRIORITY_FEE = GWEI.mul(process.env.PRIORITY_GWEI || 20)
const BLOCKS_IN_THE_FUTURE = 2

// ===== Uncomment this for mainnet =======
const CHAIN_ID = 1
const FLASHBOTS_EP = 'https://relay.flashbots.net/'
// ===== Uncomment this for mainnet =======

// // ===== Uncomment this for Goerli =======
// const CHAIN_ID = 5
// const FLASHBOTS_EP = 'https://relay-goerli.flashbots.net/'
// // ===== Uncomment this for Goerli =======
let provider: BaseProvider
if (process.env.ALCHEMY_API_KEY !== undefined) {
  provider = new providers.AlchemyProvider(CHAIN_ID, process.env.ALCHEMY_API_KEY)
} else if (process.env.INFURA_API_KEY !== undefined) {
  provider = new providers.InfuraProvider(CHAIN_ID, process.env.INFURA_API_KEY)
} else {
  console.warn('Must provide ALCHEMY_API_KEY environment variable or INFURA_API_KEY')
  process.exit(1)
}

async function updateTransaction(transaction: PopulatedTransaction, nonce: number, maxFeePerGas: BigNumber) {
  transaction.nonce = nonce
  transaction.gasLimit = ethers.BigNumber.from(150000)
  transaction.maxFeePerGas = maxFeePerGas
  transaction.maxPriorityFeePerGas = PRIORITY_FEE
  transaction.type = 2
  transaction.chainId = CHAIN_ID
}

async function main() {
  const authSigner = FLASHBOTS_AUTH_KEY ? new Wallet(FLASHBOTS_AUTH_KEY) : Wallet.createRandom()
  const recoveryWallet = new Wallet(process.env.USER_KEY || '', provider)
  const compromisedWallet = new Wallet(process.env.HACKED_KEY || '', provider)

  const fyatABI = (await import('./fyat.json')).default
  let fyatContract = new ethers.Contract(ethers.utils.getAddress(`${process.env.FYAT_CONTRACT}`), fyatABI, compromisedWallet.provider)
  const flashbotsProvider = await FlashbotsBundleProvider.create(provider, authSigner, FLASHBOTS_EP)
  const recoveryWalletNonce = await recoveryWallet.getTransactionCount()
  const compromisedWalletNonce = await compromisedWallet.getTransactionCount()

  provider.on('block', async (blockNumber) => {
    const block = await provider.getBlock(blockNumber)
    const maxBaseFeeInFutureBlock = FlashbotsBundleProvider.getMaxBaseFeeInFutureBlock(<BigNumber>block.baseFeePerGas, BLOCKS_IN_THE_FUTURE)

    // Create transactions for bundling
    const sendEth = {
      to: compromisedWallet.address,
      from: recoveryWallet.address,
      nonce: recoveryWalletNonce,
      type: 2,
      maxFeePerGas: PRIORITY_FEE.add(maxBaseFeeInFutureBlock),
      maxPriorityFeePerGas: PRIORITY_FEE,
      gasLimit: 21000,
      value: ethers.utils.parseEther(`0.02`),
      data: '0x',
      chainId: CHAIN_ID
    }

    fyatContract = fyatContract.connect(compromisedWallet)
    const fyatTransferTx1 = await fyatContract.populateTransaction.transferFrom(compromisedWallet.address, recoveryWallet.address, 5019)
    const fyatTransferTx2 = await fyatContract.populateTransaction.transferFrom(compromisedWallet.address, recoveryWallet.address, 5419)
    const fyatTransferTx3 = await fyatContract.populateTransaction.transferFrom(compromisedWallet.address, recoveryWallet.address, 4832)
    const fyatTransferTx4 = await fyatContract.populateTransaction.transferFrom(compromisedWallet.address, recoveryWallet.address, 4717)
    const fyatTransferTx5 = await fyatContract.populateTransaction.transferFrom(compromisedWallet.address, recoveryWallet.address, 5648)
    updateTransaction(fyatTransferTx1, compromisedWalletNonce, sendEth.maxFeePerGas)
    updateTransaction(fyatTransferTx2, compromisedWalletNonce + 1, sendEth.maxFeePerGas)
    updateTransaction(fyatTransferTx3, compromisedWalletNonce + 2, sendEth.maxFeePerGas)
    updateTransaction(fyatTransferTx4, compromisedWalletNonce + 3, sendEth.maxFeePerGas)
    updateTransaction(fyatTransferTx5, compromisedWalletNonce + 4, sendEth.maxFeePerGas)

    const returnEth = {
      to: recoveryWallet.address,
      from: compromisedWallet.address,
      nonce: compromisedWalletNonce + 5,
      type: 2,
      maxFeePerGas: PRIORITY_FEE.add(maxBaseFeeInFutureBlock),
      maxPriorityFeePerGas: PRIORITY_FEE,
      gasLimit: 21000,
      value: ethers.utils.parseEther(`0.004`), // value: (await compromisedWallet.getBalance()).sub(PRIORITY_FEE.add(maxBaseFeeInFutureBlock).mul(21000)),
      data: '0x',
      chainId: CHAIN_ID
    }

    // Bundle transactions
    const signedBundle = await flashbotsProvider.signBundle([
      {
        signer: recoveryWallet,
        transaction: sendEth
      },
      {
        signer: compromisedWallet,
        transaction: fyatTransferTx1
      },
      {
        signer: compromisedWallet,
        transaction: fyatTransferTx2
      },
      {
        signer: compromisedWallet,
        transaction: fyatTransferTx3
      },
      {
        signer: compromisedWallet,
        transaction: fyatTransferTx4
      },
      {
        signer: compromisedWallet,
        transaction: fyatTransferTx5
      },
      {
        signer: compromisedWallet,
        transaction: returnEth
      }
    ])
    const targetBlockNumber = blockNumber + BLOCKS_IN_THE_FUTURE

    // Simulate TX
    const simulation = await flashbotsProvider.simulate(signedBundle, targetBlockNumber)
    if ('error' in simulation) {
      console.error(`Simulation Error: ${simulation.error.message}`)
      process.exit(1)
    } else {
      console.log(`Simulation Success: ${JSON.stringify(simulation, null, 2)}`)
    }

    // Submit Bundle on Simulation Success
    const bundleSubmission = await flashbotsProvider.sendRawBundle(signedBundle, targetBlockNumber)
    console.log('Bundle Submitted! Waiting...')
    if ('error' in bundleSubmission) {
      throw new Error(bundleSubmission.error.message)
    }
    const response = await bundleSubmission.wait()
    if (response === FlashbotsBundleResolution.BundleIncluded) {
      console.log(`Congrats, included in ${targetBlockNumber}`)
      process.exit(0)
    } else if (response === FlashbotsBundleResolution.BlockPassedWithoutInclusion) {
      console.log(`Not included in ${targetBlockNumber}`)
    } else if (response === FlashbotsBundleResolution.AccountNonceTooHigh) {
      console.log('Nonce too high, bailing')
      process.exit(1)
    }
  })
}

main()

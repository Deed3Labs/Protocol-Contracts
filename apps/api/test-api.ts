/**
 * API Test Script
 * 
 * Tests all server API endpoints to ensure they're working correctly
 * Run with: bun test-api.ts
 */

import dotenv from 'dotenv';

dotenv.config();

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  response?: any;
  cached?: boolean;
}

const testResults: TestResult[] = [];

/**
 * Run a test
 */
async function runTest(name: string, testFn: () => Promise<any>): Promise<void> {
  try {
    console.log(`\n🧪 Testing: ${name}...`);
    const result = await testFn();
    testResults.push({ name, passed: true, response: result, cached: result?.cached });
    console.log(`✅ PASSED: ${name}`);
    if (result?.cached) {
      console.log(`   📦 Response was cached`);
    }
  } catch (error: any) {
    testResults.push({ name, passed: false, error: error.message });
    console.log(`❌ FAILED: ${name}`);
    console.log(`   Error: ${error.message}`);
  }
}

/**
 * Test health endpoint
 */
async function testHealth(): Promise<any> {
  const response = await fetch(`${API_BASE_URL}/health`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  const data = await response.json();
  if (data.status !== 'ok') {
    throw new Error(`Expected status 'ok', got '${data.status}'`);
  }
  return data;
}

/**
 * Test price endpoint
 */
async function testPrice(): Promise<any> {
  // Test WETH price on Ethereum
  const response = await fetch(`${API_BASE_URL}/api/prices/1/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  const data = await response.json();
  if (!data.price || data.price <= 0) {
    throw new Error(`Invalid price: ${data.price}`);
  }
  return data;
}

/**
 * Test batch prices
 */
async function testBatchPrices(): Promise<any> {
  const response = await fetch(`${API_BASE_URL}/api/prices/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prices: [
        { chainId: 1, tokenAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' }, // WETH
        { chainId: 1, tokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' }, // USDC
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  const data = await response.json();
  if (!data.results || data.results.length !== 2) {
    throw new Error(`Expected 2 results, got ${data.results?.length || 0}`);
  }
  return data;
}

/**
 * Test balance endpoint (using a known address)
 */
async function testBalance(): Promise<any> {
  // Use Vitalik's address as test (has balance on mainnet)
  const testAddress = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
  const response = await fetch(`${API_BASE_URL}/api/balances/1/${testAddress}`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  const data = await response.json();
  if (!data.balance) {
    throw new Error('No balance returned');
  }
  return data;
}

/**
 * Test batch balances
 */
async function testBatchBalances(): Promise<any> {
  const testAddress = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
  const response = await fetch(`${API_BASE_URL}/api/balances/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      balances: [
        { chainId: 1, address: testAddress },
        { chainId: 8453, address: testAddress },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  const data = await response.json();
  if (!data.results || data.results.length !== 2) {
    throw new Error(`Expected 2 results, got ${data.results?.length || 0}`);
  }
  return data;
}

/**
 * Test token balance endpoint
 */
async function testTokenBalance(): Promise<any> {
  const testAddress = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
  const usdcAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  const response = await fetch(`${API_BASE_URL}/api/token-balances/1/${testAddress}/${usdcAddress}`);
  if (!response.ok && response.status !== 404) {
    // 404 is OK if balance is zero
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  if (response.status === 404) {
    return { balance: '0', cached: false }; // Zero balance is valid
  }
  const data = await response.json();
  return data;
}

/**
 * Test batch token balances
 */
async function testBatchTokenBalances(): Promise<any> {
  const testAddress = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
  const response = await fetch(`${API_BASE_URL}/api/token-balances/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [
        { chainId: 1, tokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', userAddress: testAddress }, // USDC
        { chainId: 1, tokenAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', userAddress: testAddress }, // WETH
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  const data = await response.json();
  if (!data.results || data.results.length !== 2) {
    throw new Error(`Expected 2 results, got ${data.results?.length || 0}`);
  }
  return data;
}

/**
 * Test transactions endpoint
 */
async function testTransactions(): Promise<any> {
  const testAddress = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
  const response = await fetch(`${API_BASE_URL}/api/transactions/1/${testAddress}?limit=5`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  const data = await response.json();
  if (!Array.isArray(data.transactions)) {
    throw new Error('Expected transactions array');
  }
  return data;
}

/**
 * Test CORS
 */
async function testCORS(): Promise<any> {
  const response = await fetch(`${API_BASE_URL}/health`, {
    method: 'OPTIONS',
    headers: {
      'Origin': 'https://test.vercel.app',
      'Access-Control-Request-Method': 'GET',
    },
  });
  const corsHeader = response.headers.get('Access-Control-Allow-Origin');
  if (!corsHeader) {
    throw new Error('CORS header not present');
  }
  return { corsHeader };
}

/**
 * Run all tests
 */
async function runAllTests() {
  console.log('🚀 Starting API Tests...');
  console.log(`📍 Testing server at: ${API_BASE_URL}\n`);

  await runTest('Health Check', testHealth);
  await runTest('Get Token Price', testPrice);
  await runTest('Batch Token Prices', testBatchPrices);
  await runTest('Get Native Balance', testBalance);
  await runTest('Batch Native Balances', testBatchBalances);
  await runTest('Get Token Balance', testTokenBalance);
  await runTest('Batch Token Balances', testBatchTokenBalances);
  await runTest('Get Transactions', testTransactions);
  await runTest('CORS Headers', testCORS);

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Test Summary');
  console.log('='.repeat(60));

  const passed = testResults.filter(r => r.passed).length;
  const failed = testResults.filter(r => !r.passed).length;
  const cached = testResults.filter(r => r.cached).length;

  testResults.forEach(result => {
    const icon = result.passed ? '✅' : '❌';
    const cacheIcon = result.cached ? ' 📦' : '';
    console.log(`${icon} ${result.name}${cacheIcon}`);
    if (!result.passed && result.error) {
      console.log(`   Error: ${result.error}`);
    }
  });

  console.log('\n' + '='.repeat(60));
  console.log(`Total: ${testResults.length} | Passed: ${passed} | Failed: ${failed}`);
  if (cached > 0) {
    console.log(`Cache Hits: ${cached}`);
  }
  console.log('='.repeat(60));

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('\n🎉 All tests passed!');
  }
}

// Run tests
runAllTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

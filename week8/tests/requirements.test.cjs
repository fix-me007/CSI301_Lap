// ใช้เฉพาะเชนจำลองในหน่วยความจำ ไม่เชื่อม address/RPC จาก config.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const solc = require('solc');
const ganache = require('ganache');
const { ethers } = require('ethers');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'smart-contact/FreelanceEscrow.sol'), 'utf8');
const probeSource = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
import "FreelanceEscrow.sol";

// Test-only receiver: เป็น Admin และฟรีแลนซ์ เพื่อทดสอบ callback ที่มีสิทธิ์จริง
contract PayoutProbe {
    FreelanceEscrow public escrow;
    bool public rejectPayment;
    bool public attempted;
    bool public reentered;
    uint256 private target;
    constructor() { escrow = new FreelanceEscrow(); }
    function setReject(bool value) external { rejectPayment = value; }
    function submit(uint256 id) external { escrow.submitWork(id, "test-proof"); }
    function resolve(uint256 id, bool payout, uint256 otherJob) external {
        target = otherJob;
        escrow.resolveDispute(id, payout);
    }
    receive() external payable {
        require(!rejectPayment, "Test receiver rejected ETH");
        if (target != 0) {
            attempted = true;
            (reentered, ) = address(escrow).call(
                abi.encodeWithSignature("resolveDispute(uint256,bool)", target, true)
            );
        }
    }
}`;

const output = JSON.parse(solc.compile(JSON.stringify({
  language: 'Solidity',
  sources: { 'FreelanceEscrow.sol': { content: source }, 'PayoutProbe.sol': { content: probeSource } },
  settings: { evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } }
})));
assert.deepEqual((output.errors || []).filter((error) => error.severity === 'error'), []);
const artifact = output.contracts['FreelanceEscrow.sol'].FreelanceEscrow;
const probeArtifact = output.contracts['PayoutProbe.sol'].PayoutProbe;
const amount = ethers.parseEther('0.001');
const gas = { gasLimit: 1000000 };
const legacyAbi = new ethers.Interface(['function refundIfNotDelivered(uint256)']);
const mined = async (pending) => (await pending).wait();

async function fixture(t, withProbe = false) {
  const chain = ganache.provider({
    chain: { chainId: 11155111, hardfork: 'shanghai' },
    wallet: { totalAccounts: 4, defaultBalance: 100 }, logging: { quiet: true }
  });
  const rpc = new ethers.BrowserProvider(chain, undefined, { cacheTimeout: -1, pollingInterval: 50 });
  t.after(async () => { rpc.destroy(); await chain.disconnect(); });
  const [admin, client, freelancer, outsider] = await Promise.all([0, 1, 2, 3].map((id) => rpc.getSigner(id)));
  let escrow, probe;
  if (withProbe) {
    probe = await new ethers.ContractFactory(probeArtifact.abi, probeArtifact.evm.bytecode.object, admin).deploy();
    await probe.waitForDeployment();
    escrow = new ethers.Contract(await probe.escrow(), artifact.abi, admin);
  } else {
    escrow = await new ethers.ContractFactory(artifact.abi, artifact.evm.bytecode.object, admin).deploy();
    await escrow.waitForDeployment();
  }
  const recipient = probe ? await probe.getAddress() : await freelancer.getAddress();
  async function create() {
    const block = await rpc.getBlock('latest');
    await mined(escrow.connect(client).createJob('Website project', 'Responsive website', recipient, amount, block.timestamp + 3600));
    return escrow.jobCount();
  }
  async function fund(id) { await mined(escrow.connect(client).depositPayment(id, { value: amount })); }
  async function expired() {
    await chain.request({ method: 'evm_increaseTime', params: [7200] });
    await chain.request({ method: 'evm_mine', params: [] });
  }
  async function snapshot(id) {
    return {
      status: (await escrow.getJob(id)).status,
      records: (await escrow.getPaymentHistory(id)).map((record) => Array.from(record)),
      balance: await escrow.escrowBalance()
    };
  }
  return { chain, rpc, escrow, probe, admin, client, freelancer, outsider, recipient, create, fund, expired, snapshot };
}

async function reverted(send) {
  await assert.rejects(async () => mined(send()), (error) => {
    assert(error.receipt, 'Expected an actual mined transaction, not just a client-side error');
    assert.equal(Number(error.receipt.status), 0);
    return true;
  });
}

test('v2 exposes its version and removes legacy direct-refund function/event', async (t) => {
  const { escrow } = await fixture(t);
  assert.equal(await escrow.CONTRACT_VERSION(), 2n);
  assert.equal(escrow.interface.getFunction('refundIfNotDelivered'), null);
  assert.equal(escrow.interface.getEvent('PaymentRefunded'), null);
});

test('legacy refund selector cannot withdraw before OR after deadline', async (t) => {
  const f = await fixture(t);
  const id = await f.create();
  await f.fund(id);
  const data = legacyAbi.encodeFunctionData('refundIfNotDelivered', [id]);
  for (const expire of [false, true]) {
    if (expire) await f.expired();
    const before = await f.snapshot(id);
    for (const caller of [f.client, f.freelancer, f.admin]) {
      await reverted(() => caller.sendTransaction({ to: f.escrow.target, data, ...gas }));
    }
    assert.deepEqual(await f.snapshot(id), before);
    assert.equal(before.status, 1n);
    assert.equal(before.balance, amount);
  }
});

test('overdue funds stay locked until party disputes AND admin decides refund', async (t) => {
  const f = await fixture(t);
  const id = await f.create();
  await f.fund(id);
  await f.expired();
  await reverted(() => f.escrow.connect(f.freelancer).submitWork(id, 'late proof', gas));
  await reverted(() => f.escrow.connect(f.client).approveAndRelease(id, gas));
  await reverted(() => f.escrow.resolveDispute(id, false, gas));
  assert.equal(await f.escrow.escrowBalance(), amount);
  await mined(f.escrow.connect(f.client).raiseDispute(id, 'Deadline passed without delivery'));
  assert.equal((await f.escrow.getJob(id)).status, 4n);
  assert.equal(await f.escrow.escrowBalance(), amount);
  assert.equal((await f.escrow.getPaymentHistory(id)).length, 1);
  for (const caller of [f.client, f.freelancer, f.outsider]) {
    await reverted(() => f.escrow.connect(caller).resolveDispute(id, false, gas));
  }
  await mined(f.escrow.resolveDispute(id, false));
  assert.equal((await f.escrow.getJob(id)).status, 6n);
  assert.equal(await f.escrow.escrowBalance(), 0n);
  const history = await f.escrow.getPaymentHistory(id);
  assert.equal(history.length, 2);
  assert.equal(history[1].action, 'REFUND');
  assert.equal(history[1].to, await f.client.getAddress());
  const before = await f.snapshot(id);
  await reverted(() => f.escrow.resolveDispute(id, false, gas));
  await reverted(() => f.escrow.resolveDispute(id, true, gas));
  await reverted(() => f.escrow.connect(f.client).approveAndRelease(id, gas));
  assert.deepEqual(await f.snapshot(id), before);
});

test('normal payout requires submitted work and client approval; cannot pay twice', async (t) => {
  const f = await fixture(t);
  const id = await f.create();
  await reverted(() => f.escrow.connect(f.client).approveAndRelease(id, gas));
  await reverted(() => f.escrow.connect(f.outsider).depositPayment(id, { value: amount, ...gas }));
  await reverted(() => f.escrow.connect(f.client).depositPayment(id, { value: amount - 1n, ...gas }));
  await f.fund(id);
  await reverted(() => f.escrow.connect(f.client).approveAndRelease(id, gas));
  await reverted(() => f.escrow.connect(f.outsider).submitWork(id, 'proof', gas));
  await mined(f.escrow.connect(f.freelancer).submitWork(id, 'https://example.com/work'));
  await reverted(() => f.escrow.connect(f.freelancer).approveAndRelease(id, gas));
  await reverted(() => f.escrow.connect(f.outsider).approveAndRelease(id, gas));
  const recipientBefore = await f.rpc.getBalance(f.recipient);
  await mined(f.escrow.connect(f.client).approveAndRelease(id));
  assert.equal((await f.rpc.getBalance(f.recipient)) - recipientBefore, amount);
  assert.equal((await f.escrow.getJob(id)).status, 3n);
  assert.equal((await f.escrow.getPaymentHistory(id))[1].action, 'RELEASE');
  const before = await f.snapshot(id);
  await reverted(() => f.escrow.connect(f.client).approveAndRelease(id, gas));
  await reverted(() => f.escrow.connect(f.client).raiseDispute(id, 'late dispute', gas));
  await reverted(() => f.escrow.resolveDispute(id, false, gas));
  assert.deepEqual(await f.snapshot(id), before);
});

test('dispute payout is admin-only, cannot release during dispute or repeat settlement', async (t) => {
  const f = await fixture(t);
  const id = await f.create();
  await f.fund(id);
  await mined(f.escrow.connect(f.freelancer).submitWork(id, 'hash-proof'));
  await reverted(() => f.escrow.connect(f.outsider).raiseDispute(id, 'not a party', gas));
  await mined(f.escrow.connect(f.freelancer).raiseDispute(id, 'Delivery rejected'));
  await reverted(() => f.escrow.connect(f.client).approveAndRelease(id, gas));
  await reverted(() => f.escrow.connect(f.client).cancelJob(id, gas));
  await reverted(() => f.escrow.connect(f.freelancer).resolveDispute(id, true, gas));
  const balance = await f.rpc.getBalance(f.recipient);
  await mined(f.escrow.resolveDispute(id, true));
  assert.equal((await f.rpc.getBalance(f.recipient)) - balance, amount);
  assert.equal((await f.escrow.getJob(id)).status, 5n);
  assert.equal((await f.escrow.getPaymentHistory(id))[1].action, 'DISPUTE_PAYOUT');
  const before = await f.snapshot(id);
  await reverted(() => f.escrow.resolveDispute(id, true, gas));
  await reverted(() => f.escrow.resolveDispute(id, false, gas));
  await reverted(() => f.escrow.connect(f.client).approveAndRelease(id, gas));
  assert.deepEqual(await f.snapshot(id), before);
});

test('cancellation has no payout, and funded jobs cannot be cancelled', async (t) => {
  const f = await fixture(t);
  const id = await f.create();
  await mined(f.escrow.connect(f.client).cancelJob(id));
  assert.equal((await f.escrow.getJob(id)).status, 7n);
  assert.equal((await f.escrow.getPaymentHistory(id)).length, 0);
  assert.equal(await f.escrow.escrowBalance(), 0n);
  await reverted(() => f.escrow.connect(f.client).depositPayment(id, { value: amount, ...gas }));
  const fundedId = await f.create();
  await f.fund(fundedId);
  await reverted(() => f.escrow.connect(f.client).cancelJob(fundedId, gas));
  assert.equal(await f.escrow.escrowBalance(), amount);
});

test('authorized admin callback cannot reenter a different disputed job', async (t) => {
  const f = await fixture(t, true);
  const ids = [await f.create(), await f.create()];
  for (const id of ids) {
    await f.fund(id);
    await mined(f.escrow.connect(f.client).raiseDispute(id, 'test dispute'));
  }
  await mined(f.probe.resolve(ids[0], true, ids[1]));
  assert.equal(await f.probe.attempted(), true);
  assert.equal(await f.probe.reentered(), false);
  assert.equal((await f.escrow.getJob(ids[0])).status, 5n);
  assert.equal((await f.escrow.getJob(ids[1])).status, 4n);
  assert.equal(await f.escrow.escrowBalance(), amount);
  await mined(f.probe.resolve(ids[1], true, 0));
  assert.equal(await f.escrow.escrowBalance(), 0n);
});

test('failed receiver rolls back state/history and does not leave reentrancy lock stuck', async (t) => {
  const f = await fixture(t, true);
  const id = await f.create();
  await f.fund(id);
  await mined(f.probe.submit(id));
  await mined(f.probe.setReject(true));
  const before = await f.snapshot(id);
  await reverted(() => f.escrow.connect(f.client).approveAndRelease(id, gas));
  assert.deepEqual(await f.snapshot(id), before);
  await mined(f.probe.setReject(false));
  await mined(f.escrow.connect(f.client).approveAndRelease(id));
  assert.equal((await f.escrow.getJob(id)).status, 3n);
  assert.equal((await f.escrow.getPaymentHistory(id)).length, 2);
  assert.equal(await f.escrow.escrowBalance(), 0n);
});

test('frontend ABI matches compiled contract; no overdue direct-refund action at any time', () => {
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8').replace(/\ninit\(\);\s*$/, '');
  const context = vm.createContext({ window: { APP_CONFIG: {} }, document: {}, ethers, URL });
  vm.runInContext(app, context);
  const frontend = new ethers.Interface(vm.runInContext('ABI', context));
  const actual = new ethers.Interface(artifact.abi);
  assert.equal(frontend.fragments.length, actual.fragments.filter((f) => ['function', 'event'].includes(f.type)).length);
  for (const fragment of frontend.fragments) {
    const compiled = fragment.type === 'function' ? actual.getFunction(fragment.selector) : actual.getEvent(fragment.topicHash);
    assert(compiled);
    assert.equal(fragment.format('full'), compiled.format('full'));
  }
  assert.equal(vm.runInContext('REQUIRED_CONTRACT_VERSION', context), 2n);
  const client = '0x0000000000000000000000000000000000000001';
  const freelancer = '0x0000000000000000000000000000000000000002';
  const admin = '0x0000000000000000000000000000000000000003';
  const job = { client, freelancer, status: 1n, deadline: 100n };
  const allowed = vm.runInContext('allowedActions', context);
  for (const timestamp of [99, 100, 101, 1000000]) {
    assert.deepEqual(Array.from(allowed(job, client, admin, timestamp)), ['raiseDispute']);
  }
  assert.deepEqual(Array.from(allowed(job, freelancer, admin, 100)), ['submitWork', 'raiseDispute']);
  assert.deepEqual(Array.from(allowed(job, freelancer, admin, 101)), ['raiseDispute']);
  job.status = 4n;
  assert.deepEqual(Array.from(allowed(job, client, admin, 101)), []);
  assert.deepEqual(Array.from(allowed(job, admin, admin, 101)), ['resolveDispute']);
});

'use strict';

// Human-readable ABI ตรงกับ smart-contact/FreelanceEscrow.sol (ethers.js v6)
const ABI = [
  'function CONTRACT_VERSION() view returns (uint256)',
  'function admin() view returns (address)',
  'function jobCount() view returns (uint256)',
  'function escrowBalance() view returns (uint256)',
  'function createJob(string _title,string _description,address _freelancer,uint256 _amount,uint256 _deadline) returns (uint256 jobId)',
  'function depositPayment(uint256 _jobId) payable',
  'function submitWork(uint256 _jobId,string _workProof)',
  'function approveAndRelease(uint256 _jobId)',
  'function raiseDispute(uint256 _jobId,string _reason)',
  'function resolveDispute(uint256 _jobId,bool _payFreelancer)',
  'function cancelJob(uint256 _jobId)',
  'function getJob(uint256 _jobId) view returns (tuple(uint256 id,address client,address freelancer,string title,string description,uint256 amount,uint256 deadline,string workProof,uint8 status,uint256 createdAt))',
  'function getJobStatus(uint256 _jobId) view returns (uint8)',
  'function getPaymentHistory(uint256 _jobId) view returns (tuple(uint256 jobId,address to,uint256 amount,string action,uint256 timestamp)[])',
  'function getJobsByClient(address _client) view returns (uint256[])',
  'function getJobsByFreelancer(address _freelancer) view returns (uint256[])',
  'event JobCreated(uint256 indexed jobId,address indexed client,address indexed freelancer,uint256 amount,uint256 deadline)',
  'event PaymentDeposited(uint256 indexed jobId,address indexed client,uint256 amount)',
  'event WorkSubmitted(uint256 indexed jobId,address indexed freelancer,string workProof)',
  'event PaymentReleased(uint256 indexed jobId,address indexed freelancer,uint256 amount)',
  'event DisputeRaised(uint256 indexed jobId,address indexed raisedBy,string reason)',
  'event DisputeResolved(uint256 indexed jobId,bool paidToFreelancer,uint256 amount)',
  'event JobCancelled(uint256 indexed jobId)'
];

const STATUS = [
  ['รอฝากเงิน', 'bg-slate-100 text-slate-600'],
  ['กำลังดำเนินงาน', 'bg-blue-50 text-blue-700'],
  ['รอตรวจรับ', 'bg-amber-50 text-amber-800'],
  ['อนุมัติแล้ว', 'bg-emerald-50 text-emerald-700'],
  ['มีข้อพิพาท', 'bg-red-50 text-red-700'],
  ['ตัดสินให้จ่ายแล้ว', 'bg-teal-50 text-teal-700'],
  ['คืนเงินแล้ว', 'bg-orange-50 text-orange-700'],
  ['ยกเลิกแล้ว', 'bg-slate-100 text-slate-500']
];
const ACTIONS = {
  depositPayment: ['ฝากค่าจ้างเข้า Escrow', 'เงินจะถูกล็อกใน contract ตามค่าจ้างที่ตกลงไว้ ต้องส่งเท่ากันพอดี และฝากก่อนกำหนดส่ง'],
  submitWork: ['ส่งมอบผลงาน', 'บันทึก URL หรือ Hash ของผลงานก่อนหมดเวลา เมื่อส่งแล้วผู้ว่าจ้างจะตรวจรับและอนุมัติจ่ายเงิน'],
  approveAndRelease: ['อนุมัติและจ่ายค่าจ้าง', 'โปรดตรวจผลงานให้ครบถ้วน เงินทั้งหมดจะถูกโอนให้ฟรีแลนซ์ทันทีและไม่สามารถขอคืนผ่าน contract ได้'],
  raiseDispute: ['เปิดข้อพิพาท', 'เงินยังถูกล็อกไว้จนกว่า Admin ตัดสิน แม้เลยกำหนดส่งก็ต้องใช้ขั้นตอนนี้เพื่อขอคืนเงิน ระบุเหตุผลที่ไม่มีข้อมูลอ่อนไหวไว้ใน Event สาธารณะ'],
  resolveDispute: ['ตัดสินข้อพิพาท', 'Admin เลือกจ่ายเงินทั้งหมดให้ฟรีแลนซ์ หรือคืนเงินทั้งหมดให้ผู้ว่าจ้าง ไม่มีการแบ่งจ่าย'],
  cancelJob: ['ยกเลิกข้อตกลง', 'ยกเลิกได้เฉพาะงานที่ยังไม่ได้ฝากเงิน ไม่มีค่าจ้างให้คืน แต่ยังมีค่า gas']
};
const PAYMENT_NAMES = { DEPOSIT: 'ฝากเงินเข้า Escrow', RELEASE: 'จ่ายเงินให้ฟรีแลนซ์', REFUND: 'คืนเงินให้ผู้ว่าจ้าง', DISPUTE_PAYOUT: 'จ่ายตามคำตัดสิน' };
const EVENT_NAMES = { JobCreated: 'สร้างข้อตกลง', PaymentDeposited: 'ฝากค่าจ้าง', WorkSubmitted: 'ส่งมอบงาน', PaymentReleased: 'อนุมัติและจ่ายเงิน', DisputeRaised: 'เปิดข้อพิพาท', DisputeResolved: 'ตัดสินข้อพิพาท', JobCancelled: 'ยกเลิกข้อตกลง' };
const $ = (id) => document.getElementById(id);
const config = window.APP_CONFIG || {};
const PAGE_SIZE = 8;
const REQUIRED_CONTRACT_VERSION = 2n;
const state = {
  ready: false, loading: false, busy: false, epoch: 0,
  rpc: null, contract: null, browser: null, address: '', chainId: 0, admin: '',
  total: 0n, balance: 0n, clientIds: [], freelancerIds: [],
  scope: 'all', jobs: [], cursor: 0, selected: null, history: [], action: null
};
const sameAddress = (a, b) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shortAddress = (address) => address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '—';
const eth = (value) => ethers.formatEther(value);
const nowSeconds = () => Math.floor(Date.now() / 1000);
const dateText = (value) => new Date(Number(value) * 1000).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
const badge = (status) => `<span class="badge ${STATUS[Number(status)][1]}">${STATUS[Number(status)][0]}</span>`;

function safeUrl(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; }
  catch { return ''; }
}

function explorerLink(type, value, label = shortAddress(value)) {
  const base = safeUrl(config.EXPLORER_URL || 'https://sepolia.etherscan.io').replace(/\/$/, '');
  return `<a href="${escapeHtml(`${base}/${type}/${value}`)}" target="_blank" rel="noopener noreferrer" class="break-anywhere text-emerald-700 underline underline-offset-4">${escapeHtml(label)} ↗</a>`;
}

function errorText(error) {
  if (error.code === 4001 || error.code === 'ACTION_REJECTED') return 'ยกเลิกคำขอใน Wallet แล้ว ยังไม่มีการทำรายการสำเร็จ';
  if (error.code === 'INSUFFICIENT_FUNDS') return 'Sepolia ETH ไม่พอสำหรับค่าจ้างและค่า gas';
  const message = error.reason || error.revert?.args?.[0] || error.info?.error?.message || error.shortMessage || error.message || String(error);
  const translations = {
    'Only client': 'เฉพาะผู้ว่าจ้างของงานนี้เท่านั้น', 'Only freelancer': 'เฉพาะฟรีแลนซ์ของงานนี้เท่านั้น',
    'Only admin': 'เฉพาะ Admin เท่านั้น', 'Invalid job status': 'สถานะงานเปลี่ยนไปแล้ว กรุณารีเฟรชข้อมูล',
    'Job not found': 'ไม่พบ Job ID นี้', 'Deadline passed': 'เลยกำหนดส่งงานแล้ว',
    'Must send exact amount': 'ต้องฝาก ETH เท่ากับค่าจ้างพอดี',
    'Client cannot be freelancer': 'ผู้ว่าจ้างและฟรีแลนซ์ต้องเป็นคนละ Wallet', 'Not a party': 'คุณไม่ใช่คู่สัญญาของงานนี้',
    'Cannot dispute in this status': 'สถานะนี้ไม่สามารถเปิดข้อพิพาทได้', 'Transfer failed': 'ผู้รับไม่สามารถรับ ETH ได้ ธุรกรรมถูกย้อนกลับ'
  };
  for (const [key, text] of Object.entries(translations)) if (message.includes(key)) return text;
  return String(message).slice(0, 450);
}

function notice(message, type = 'info') {
  $('notice').textContent = message;
  $('notice').className = `mb-6 break-anywhere rounded-xl border p-4 text-sm leading-6 ${type === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`;
}

function canWrite() {
  return state.ready && Boolean(state.address) && state.chainId === Number(config.CHAIN_ID) && !state.busy;
}

// ปุ่มอิงกฎเดียวกับ Solidity; deadline ใช้เวลาอุปกรณ์เพื่อ UX เท่านั้น contract ตัดสินด้วย block.timestamp
function allowedActions(job, address, admin, timestamp = nowSeconds()) {
  const result = [];
  const status = Number(job.status);
  const client = sameAddress(address, job.client);
  const freelancer = sameAddress(address, job.freelancer);
  if (client && status === 0) {
    if (BigInt(timestamp) < job.deadline) result.push('depositPayment');
    result.push('cancelJob');
  }
  if (freelancer && status === 1 && BigInt(timestamp) <= job.deadline) result.push('submitWork');
  if (client && status === 2) result.push('approveAndRelease');
  if ((client || freelancer) && [1, 2].includes(status)) result.push('raiseDispute');
  if (sameAddress(address, admin) && status === 4) result.push('resolveDispute');
  return result;
}

function renderControls() {
  $('connectWallet').disabled = state.busy || state.loading;
  $('walletLabel').textContent = state.address ? shortAddress(state.address) : 'เชื่อมต่อ Wallet';
  $('connectWallet').title = state.address || 'เชื่อมต่อ MetaMask หรือ EIP-1193 Wallet';
  $('switchNetwork').classList.toggle('hidden', !state.address || state.chainId === Number(config.CHAIN_ID));
  $('switchNetwork').disabled = state.busy;
  $('networkLabel').textContent = state.address && state.chainId !== Number(config.CHAIN_ID) ? '● เครือข่ายไม่ถูกต้อง' : '● Sepolia Testnet';
  $('openCreate').disabled = !canWrite() || state.loading;
  $('createSubmit').disabled = !canWrite() || state.loading;
  $('actionSubmit').disabled = !canWrite() || state.loading;
  $('refreshData').disabled = !state.ready || state.loading || state.busy;
  $('lookupButton').disabled = !state.ready || state.loading || state.busy;
  $('loadMore').disabled = state.loading || state.busy;
  $('roleLabel').textContent = !state.address ? 'ผู้เยี่ยมชม' : sameAddress(state.address, state.admin) ? 'Admin / คู่สัญญา' : 'ผู้ว่าจ้าง / ฟรีแลนซ์';
  document.querySelectorAll('[data-scope]').forEach((button) => {
    button.disabled = state.loading || state.busy;
    if (button.dataset.scope === state.scope) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
}

function sourceLength() {
  if (state.scope === 'client') return BigInt(state.clientIds.length);
  if (state.scope === 'freelancer') return BigInt(state.freelancerIds.length);
  return state.total;
}

function renderJobs() {
  const query = $('searchJobs').value.trim().toLowerCase().replace(/^#/, '');
  const filter = $('statusFilter').value;
  const jobs = state.jobs.filter((job) => (state.scope !== 'disputed' || Number(job.status) === 4)
    && (filter === 'all' || Number(job.status) === Number(filter))
    && (!query || job.title.toLowerCase().includes(query) || job.id.toString() === query));
  $('projectsTitle').firstChild.textContent = ({ all: 'ภาพรวมโครงการ ', client: 'งานที่ฉันว่าจ้าง ', freelancer: 'งานที่ฉันรับ ', disputed: 'ข้อพิพาท ' })[state.scope];
  $('loadedCount').textContent = state.ready ? `(${jobs.length})` : '';
  $('scopeNote').textContent = state.ready
    ? `โหลดแล้ว ${state.jobs.length} จาก ${sourceLength()} ข้อตกลง · ค้นหาและกรองเฉพาะรายการที่โหลดแล้ว${state.scope === 'disputed' ? ' · Admin เท่านั้นที่ตัดสินได้' : ''}`
    : 'รายการล่าสุดจาก Smart Contract';
  $('loadMore').classList.toggle('hidden', !state.ready || BigInt(state.cursor) >= sourceLength());
  if (!jobs.length) {
    const needsWallet = ['client', 'freelancer'].includes(state.scope) && !state.address;
    $('jobList').innerHTML = `<div class="col-span-full rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-14 text-center"><svg class="mx-auto mb-4 h-9 w-9 text-[#8fa87c]" fill="none" stroke="currentColor" stroke-width="1.2"><use href="#i-case"/></svg><p>${needsWallet ? 'เชื่อมต่อ Wallet เพื่อดูงานของคุณ' : state.ready ? 'ยังไม่มีข้อตกลงที่ตรงกับรายการนี้' : 'พื้นที่สำหรับข้อตกลงถัดไปของคุณ'}</p><p class="mt-2 text-xs leading-6 text-slate-400">${!state.ready ? 'ตั้งค่า Contract Address เพื่อโหลดข้อมูลจริงจาก Blockchain' : BigInt(state.cursor) < sourceLength() ? 'ลองเปลี่ยนตัวกรอง หรือโหลดโครงการเพิ่มเติมด้านล่าง' : 'เริ่มข้อตกลงใหม่ หรือเปลี่ยนคำค้นหาและตัวกรอง'}</p></div>`;
    return;
  }
  $('jobList').innerHTML = jobs.map((job) => {
    const overdue = BigInt(nowSeconds()) > job.deadline && [0, 1].includes(Number(job.status));
    return `<article class="job-card flex min-w-0 flex-col rounded-2xl border border-slate-200/80 bg-white p-5 sm:p-6">
      <div class="mb-5 flex flex-wrap items-center justify-between gap-2"><span class="font-mono text-[10px] text-slate-400">DW-${job.id.toString().padStart(4, '0')}</span>${badge(job.status)}</div>
      <h3 class="break-anywhere text-base leading-7">${escapeHtml(job.title)}</h3><p class="mt-2 line-clamp-2 break-anywhere text-xs leading-6 text-slate-400">${escapeHtml(job.description || 'ไม่ได้ระบุรายละเอียดงาน')}</p>
      <div class="mb-5 mt-5 grid grid-cols-2 gap-3 text-xs"><div><p class="text-[10px] text-slate-400">ค่าจ้างโครงการ</p><p class="mt-1 break-all text-base">${eth(job.amount)} <span class="text-[10px] text-slate-400">ETH</span></p></div><div><p class="text-[10px] text-slate-400">กำหนดส่ง${overdue ? ' · พ้นกำหนด' : ''}</p><p class="mt-1 text-[11px] leading-5 ${overdue ? 'text-red-600' : ''}">${dateText(job.deadline)}</p></div></div>
      <div class="mt-auto flex items-center justify-between gap-2 border-t border-slate-100 pt-4"><span class="text-[10px] text-slate-400">ฟรีแลนซ์ <span class="font-mono">${shortAddress(job.freelancer)}</span></span><button data-job="${job.id}" class="text-xs text-forest underline underline-offset-4" ${state.busy || state.loading ? 'disabled' : ''}>รายละเอียด ↗</button></div>
    </article>`;
  }).join('');
}

async function fetchPage(epoch) {
  const remaining = sourceLength() - BigInt(state.cursor);
  const count = Number(remaining > BigInt(PAGE_SIZE) ? BigInt(PAGE_SIZE) : remaining);
  const ids = Array.from({ length: count }, (_, index) => {
    if (['client', 'freelancer'].includes(state.scope)) {
      const list = state.scope === 'client' ? state.clientIds : state.freelancerIds;
      return list[list.length - 1 - state.cursor - index];
    }
    return state.total - BigInt(state.cursor + index);
  });
  const jobs = [];
  // จำกัดคำขอพร้อมกันเพื่อไม่ยิง public RPC มากเกินไป
  for (let index = 0; index < ids.length; index += 4) {
    jobs.push(...await Promise.all(ids.slice(index, index + 4).map((id) => state.contract.getJob(id))));
    if (epoch !== state.epoch) return;
  }
  state.jobs.push(...jobs);
  state.cursor += jobs.length;
}

async function refreshData() {
  if (!state.ready) return;
  const epoch = ++state.epoch;
  state.loading = true;
  renderControls();
  try {
    const address = state.address;
    const [total, balance, clientIds, freelancerIds, walletBalance] = await Promise.all([
      state.contract.jobCount(), state.contract.escrowBalance(),
      address ? state.contract.getJobsByClient(address) : [],
      address ? state.contract.getJobsByFreelancer(address) : [],
      address ? state.rpc.getBalance(address) : null
    ]);
    if (epoch !== state.epoch) return;
    Object.assign(state, { total, balance, clientIds, freelancerIds, jobs: [], cursor: 0 });
    $('totalJobs').textContent = total.toString();
    $('escrowBalance').textContent = eth(balance);
    $('clientCount').textContent = address ? clientIds.length : '—';
    $('freelancerCount').textContent = address ? freelancerIds.length : '—';
    $('walletBalance').textContent = address ? `Wallet: ${eth(walletBalance)} ETH (ไม่ใช่ยอด Escrow)` : 'อ่านข้อมูลได้โดยไม่ต้องเชื่อมต่อ';
    await fetchPage(epoch);
    if (epoch !== state.epoch) return;
    if ($('jobDialog').open && state.selected) await readDetail(state.selected.id, epoch);
  } finally {
    if (epoch === state.epoch) { state.loading = false; renderControls(); renderJobs(); }
  }
}

async function connectWallet(request = true) {
  if (!window.ethereum) throw new Error('ไม่พบ Wallet กรุณาติดตั้ง MetaMask หรือเปิดผ่านเบราว์เซอร์ของ Wallet');
  const accounts = await window.ethereum.request({ method: request ? 'eth_requestAccounts' : 'eth_accounts' });
  const chainId = await window.ethereum.request({ method: 'eth_chainId' });
  const previousAddress = state.address;
  state.browser = new ethers.BrowserProvider(window.ethereum, 'any');
  state.address = accounts[0] ? ethers.getAddress(accounts[0]) : '';
  state.chainId = Number(BigInt(chainId));
  if (!sameAddress(previousAddress, state.address)) {
    state.clientIds = [];
    state.freelancerIds = [];
    $('clientCount').textContent = '—';
    $('freelancerCount').textContent = '—';
    $('walletBalance').textContent = state.address ? 'กำลังอ่านยอด Wallet…' : 'อ่านข้อมูลได้โดยไม่ต้องเชื่อมต่อ';
    if (['client', 'freelancer'].includes(state.scope)) {
      state.jobs = [];
      state.cursor = 0;
      renderJobs();
    }
  }
  renderControls();
  if (state.address && state.chainId !== Number(config.CHAIN_ID)) notice('Wallet อยู่คนละเครือข่าย กรุณากด “เปลี่ยนเป็น Sepolia” ก่อนทำธุรกรรม');
  await refreshData();
}

async function readDetail(id, epoch = state.epoch) {
  const [job, history] = await Promise.all([state.contract.getJob(id), state.contract.getPaymentHistory(id)]);
  if (epoch !== state.epoch) return false;
  state.selected = job;
  state.history = history;
  renderDetail();
  return true;
}

async function openDetail(id) {
  if (!state.ready || state.busy || state.loading) return;
  if (!/^[1-9]\d*$/.test(id.toString())) throw new Error('Job ID ต้องเป็นจำนวนเต็มบวก');
  if (await readDetail(BigInt(id))) $('jobDialog').showModal();
}

function renderDetail() {
  const job = state.selected;
  if (!job) return;
  $('detailId').textContent = `ข้อตกลง #${job.id} · สร้าง ${dateText(job.createdAt)}`;
  $('detailTitle').textContent = job.title;
  const proofUrl = safeUrl(job.workProof);
  $('jobDetail').innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-3">${badge(job.status)}<span class="break-all text-xl">${eth(job.amount)} <span class="text-xs text-slate-400">Sepolia ETH</span></span></div>
    <p class="my-5 whitespace-pre-wrap break-anywhere text-sm leading-7 text-slate-500">${escapeHtml(job.description || 'ไม่ได้ระบุรายละเอียด')}</p>
    <dl class="grid gap-4 rounded-2xl bg-canvas p-5 text-xs sm:grid-cols-2"><div><dt class="mb-2 text-slate-400">ผู้ว่าจ้าง</dt><dd>${explorerLink('address', job.client, job.client)}</dd></div><div><dt class="mb-2 text-slate-400">ฟรีแลนซ์</dt><dd>${explorerLink('address', job.freelancer, job.freelancer)}</dd></div><div><dt class="mb-2 text-slate-400">กำหนดส่ง (เวลาอุปกรณ์)</dt><dd>${dateText(job.deadline)}</dd></div><div><dt class="mb-2 text-slate-400">Admin ผู้ตัดสิน</dt><dd>${explorerLink('address', state.admin)}</dd></div></dl>
    <h3 class="mb-2 mt-6 text-sm">หลักฐานการส่งมอบ</h3><div class="break-anywhere rounded-xl border border-slate-200 p-4 text-xs leading-6">${job.workProof ? proofUrl ? `<a href="${escapeHtml(proofUrl)}" target="_blank" rel="noopener noreferrer" class="text-emerald-700 underline">${escapeHtml(job.workProof)} ↗</a><p class="mt-2 text-slate-400">ลิงก์ภายนอกจากฟรีแลนซ์ โปรดตรวจสอบก่อนเปิด</p>` : escapeHtml(job.workProof) : '<span class="text-slate-400">ยังไม่มีการส่งงาน</span>'}</div>
    <div id="detailActions" class="mt-6 flex flex-wrap gap-2"></div>
    <p id="detailActionNote" class="mt-3 text-[11px] leading-6 text-slate-400"></p>
    <p id="escrowRuleNote" class="mt-4 rounded-xl bg-amber-50 p-4 text-xs leading-6 text-amber-900"></p>
    <h3 class="mb-3 mt-7 text-sm">ประวัติการชำระเงิน <span class="text-xs text-slate-400">· อ่านจาก contract โดยตรง</span></h3>
    <div class="divide-y divide-slate-100 rounded-xl border border-slate-200">${state.history.length ? state.history.map((record) => `<div class="p-4"><div class="flex flex-wrap justify-between gap-2 text-xs"><span>${escapeHtml(PAYMENT_NAMES[record.action] || record.action)}</span><span>${eth(record.amount)} ETH</span></div><p class="mt-2 text-[11px] leading-6 text-slate-400">${dateText(record.timestamp)} · ผู้รับ ${explorerLink('address', record.to)}</p></div>`).join('') : '<p class="p-5 text-xs text-slate-400">ยังไม่มีการเคลื่อนไหวของเงินในงานนี้</p>'}</div>
    <div class="mb-3 mt-7 flex flex-wrap items-center justify-between gap-2"><h3 class="text-sm">กิจกรรมและ Transaction Hash</h3><button id="loadEvents" class="secondary" ${state.busy ? 'disabled' : ''}>โหลด Events ↗</button></div><p class="mb-3 text-[11px] leading-6 text-slate-400">ค้นหาย้อนหลังไม่เกิน ${Number(config.MAX_LOG_BLOCKS || 10000).toLocaleString()} บล็อก อาจไม่ครอบคลุมกิจกรรมเก่า ประวัติเงินด้านบนไม่ถูกจำกัดด้วยช่วงนี้</p><div id="eventList" class="space-y-3 text-xs text-slate-400">กดโหลดเพื่อดูเหตุผลข้อพิพาทและลิงก์ธุรกรรมจาก Event จริง</div>`;
  renderDetailActions();
}

function renderDetailActions() {
  if (!state.selected || !$('detailActions')) return;
  const actions = allowedActions(state.selected, state.address, state.admin);
  const markup = actions.map((action) => `<button data-action="${action}" class="${['raiseDispute', 'cancelJob'].includes(action) ? 'secondary' : 'primary'}" ${!canWrite() || state.loading ? 'disabled' : ''}>${ACTIONS[action][0]}</button>`).join('');
  const signature = JSON.stringify([actions, !canWrite() || state.loading]);
  // ไม่แทนที่ DOM หากไม่มีการเปลี่ยนแปลง เพื่อรักษา keyboard focus
  if ($('detailActions').dataset.signature !== signature) {
    $('detailActions').innerHTML = markup;
    $('detailActions').dataset.signature = signature;
  }
  $('detailActionNote').textContent = !state.address ? 'เชื่อมต่อ Wallet เพื่อทำรายการตามบทบาทของคุณ' : !canWrite() ? 'กรุณาใช้เครือข่าย Sepolia และรอให้รายการปัจจุบันเสร็จสิ้น' : !actions.length ? 'ไม่มีรายการที่ Wallet นี้ทำได้ในสถานะปัจจุบัน' : 'ปุ่มแสดงตามสิทธิ์และสถานะ Contract ตรวจสิทธิ์และเวลาในบล็อกอีกครั้งก่อนทำรายการ';
  const overdue = Number(state.selected.status) === 1 && BigInt(nowSeconds()) > state.selected.deadline;
  $('escrowRuleNote').textContent = overdue
    ? 'พ้นกำหนดส่งแล้วและยังไม่ส่งงาน เงินยังถูกล็อกใน Escrow คู่สัญญาต้องเปิดข้อพิพาท แล้วให้ Admin พิจารณาคืนเงินหรือจ่ายค่าจ้าง ไม่มีการคืนเงินโดยตรงเมื่อหมดเวลา'
    : 'เงินออกจาก Escrow ได้เฉพาะเมื่อผู้ว่าจ้างอนุมัติงาน หรือ Admin ตัดสินข้อพิพาทเท่านั้น การเลยกำหนดส่งไม่ได้ทำให้ถอนเงินได้เอง';
}

function openAction(action) {
  if (!canWrite() || state.loading || !state.selected || !allowedActions(state.selected, state.address, state.admin).includes(action)) return;
  state.action = { name: action, job: state.selected, address: state.address };
  $('actionForm').reset();
  $('actionError').textContent = '';
  $('actionTitle').textContent = ACTIONS[action][0];
  $('actionDescription').textContent = `งาน #${state.selected.id} · ${eth(state.selected.amount)} ETH — ${ACTIONS[action][1]}`;
  const needsText = ['submitWork', 'raiseDispute'].includes(action);
  $('actionTextGroup').classList.toggle('hidden', !needsText);
  $('actionText').required = needsText;
  $('actionTextLabel').textContent = action === 'submitWork' ? 'URL หรือ Hash ของผลงาน' : 'เหตุผลการเปิดข้อพิพาท';
  $('resolutionGroup').classList.toggle('hidden', action !== 'resolveDispute');
  $('resolution').required = action === 'resolveDispute';
  $('actionDialog').showModal();
}

async function getWriter(expectedAddress) {
  if (!state.ready || !state.address || !state.browser) throw new Error('กรุณาเชื่อม Wallet และตั้งค่า contract ก่อน');
  const chain = Number(BigInt(await window.ethereum.request({ method: 'eth_chainId' })));
  const accounts = await window.ethereum.request({ method: 'eth_accounts' });
  if (chain !== Number(config.CHAIN_ID)) throw new Error('ต้องใช้เครือข่าย Sepolia เท่านั้น');
  if (!sameAddress(accounts[0], expectedAddress)) throw new Error('Wallet เปลี่ยนระหว่างทำรายการ กรุณาเปิดฟอร์มและตรวจข้อมูลใหม่');
  const signer = await state.browser.getSigner(expectedAddress);
  return new ethers.Contract(config.CONTRACT_ADDRESS, ABI, signer);
}

function transactionStatus(text, hash) {
  $('transactionPanel').classList.remove('hidden');
  $('transactionState').textContent = text;
  $('transactionHash').textContent = hash;
  const base = safeUrl(config.EXPLORER_URL || 'https://sepolia.etherscan.io').replace(/\/$/, '');
  $('transactionLink').href = `${base}/tx/${hash}`;
}

async function sendTransaction(label, expectedAddress, send, errorElement) {
  if (!canWrite()) return;
  state.busy = true;
  renderControls();
  let sent = false;
  let confirmed = false;
  let hash = '';
  errorElement.textContent = '';
  try {
    const writer = await getWriter(expectedAddress);
    const tx = await send(writer);
    sent = true;
    hash = tx.hash;
    transactionStatus(`${label} · รอยืนยันบน Blockchain…`, hash);
    ['createDialog', 'actionDialog', 'jobDialog'].forEach((id) => $(id).close());
    let receipt;
    try { receipt = await tx.wait(); }
    catch (error) {
      if (error.code === 'TRANSACTION_REPLACED' && !error.cancelled && error.receipt) receipt = error.receipt;
      else throw error;
    }
    hash = receipt.hash;
    if (Number(receipt.status) !== 1) throw new Error('ธุรกรรมถูก revert บน Blockchain');
    confirmed = true;
    let result = '';
    for (const log of receipt.logs) {
      if (!sameAddress(log.address, config.CONTRACT_ADDRESS)) continue;
      try { const event = state.contract.interface.parseLog(log); if (event?.name === 'JobCreated') result = ` · Job ID #${event.args.jobId}`; } catch { /* log จาก contract อื่น */ }
    }
    transactionStatus(`${label}สำเร็จ${result} · ยืนยันแล้ว 1 บล็อก`, hash);
    notice(`${label}สำเร็จ${result} ข้อมูลบนเชนอาจต้องรอ RPC อัปเดตสักครู่ก่อนรีเฟรช`);
    if (label === 'สร้างข้อตกลง') $('createForm').reset();
    try { await refreshData(); }
    catch (error) { notice(`ธุรกรรมสำเร็จแล้ว ไม่ต้องส่งซ้ำ แต่โหลดข้อมูลใหม่ไม่ได้: ${errorText(error)} กรุณากดรีเฟรชภายหลัง`, 'error'); }
  } catch (error) {
    const message = errorText(error);
    errorElement.textContent = message;
    if (sent && !confirmed) transactionStatus('ยังยืนยันความสำเร็จไม่ได้ / อาจถูกยกเลิกหรือ revert — ตรวจ Etherscan ก่อนส่งซ้ำ', hash);
    notice(message, 'error');
  } finally {
    state.busy = false;
    renderControls();
    renderJobs();
    if ($('jobDialog').open) renderDetail();
  }
}

function parseAmount(value) {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value)) throw new Error('ค่าจ้างต้องเป็นเลข ETH ปกติ มีทศนิยมไม่เกิน 18 ตำแหน่ง (ไม่ใช้ e หรือเครื่องหมายลบ)');
  const amount = ethers.parseEther(value);
  if (amount <= 0n || amount > ethers.MaxUint256) throw new Error('ค่าจ้างต้องมากกว่า 0 และไม่เกิน uint256');
  return amount;
}

async function createJob(event) {
  event.preventDefault();
  try {
    const title = $('jobTitle').value.trim();
    const description = $('jobDescription').value.trim();
    const freelancer = $('jobFreelancer').value.trim();
    const amount = parseAmount($('jobAmount').value.trim());
    const deadline = Math.floor(new Date($('jobDeadline').value).getTime() / 1000);
    if (!title) throw new Error('กรุณาระบุชื่อโครงการ');
    if (!ethers.isAddress(freelancer) || sameAddress(freelancer, ethers.ZeroAddress)) throw new Error('Wallet ฟรีแลนซ์ไม่ถูกต้องหรือเป็น Zero Address');
    if (sameAddress(freelancer, state.address)) throw new Error('ผู้ว่าจ้างและฟรีแลนซ์ต้องเป็นคนละ Wallet');
    if (!Number.isSafeInteger(deadline) || deadline <= nowSeconds()) throw new Error('กำหนดส่งต้องเป็นเวลาในอนาคต');
    await sendTransaction('สร้างข้อตกลง', state.address,
      (writer) => writer.createJob(title, description, ethers.getAddress(freelancer), amount, deadline), $('createError'));
  } catch (error) { $('createError').textContent = errorText(error); }
}

async function submitAction(event) {
  event.preventDefault();
  const action = state.action;
  if (!action || !canWrite()) return;
  try {
    const text = $('actionText').value.trim();
    const decision = $('resolution').value;
    if (['submitWork', 'raiseDispute'].includes(action.name) && !text) throw new Error('กรุณาระบุหลักฐานหรือเหตุผล');
    if (action.name === 'resolveDispute' && !['true', 'false'].includes(decision)) throw new Error('กรุณาเลือกผลการตัดสิน');
    await sendTransaction(ACTIONS[action.name][0], action.address, async (writer) => {
      const current = await writer.getJob(action.job.id);
      if (!allowedActions(current, action.address, state.admin).includes(action.name)) throw new Error('สถานะหรือเวลาเปลี่ยนไปแล้ว กรุณาปิดฟอร์มและรีเฟรชงาน');
      if (action.name === 'depositPayment') return writer.depositPayment(current.id, { value: current.amount });
      if (['submitWork', 'raiseDispute'].includes(action.name)) return writer[action.name](current.id, text);
      if (action.name === 'resolveDispute') return writer.resolveDispute(current.id, decision === 'true');
      return writer[action.name](current.id);
    }, $('actionError'));
  } catch (error) { $('actionError').textContent = errorText(error); }
}

async function loadEvents() {
  const id = state.selected?.id;
  if (!id) return;
  const container = $('eventList');
  const button = $('loadEvents');
  const epoch = state.epoch;
  button.disabled = true;
  container.textContent = 'กำลังค้นหา Events จาก RPC…';
  try {
    const latest = await state.rpc.getBlockNumber();
    const maxBlocks = Math.max(1, Number(config.MAX_LOG_BLOCKS) || 10000);
    const deploy = Math.max(0, Number(config.DEPLOY_BLOCK) || 0);
    const from = Math.max(deploy, latest - maxBlocks + 1);
    const chunk = Math.max(1, Number(config.LOG_CHUNK_SIZE) || 1000);
    const topics = Object.keys(EVENT_NAMES).map((name) => state.contract.interface.getEvent(name).topicHash);
    const logs = [];
    for (let start = from; start <= latest; start += chunk) {
      logs.push(...await state.rpc.getLogs({ address: config.CONTRACT_ADDRESS, fromBlock: start, toBlock: Math.min(latest, start + chunk - 1), topics: [topics, ethers.zeroPadValue(ethers.toBeHex(id), 32)] }));
      if (epoch !== state.epoch || state.selected?.id !== id || !$('jobDialog').open) return;
    }
    logs.sort((a, b) => b.blockNumber - a.blockNumber || b.index - a.index);
    container.innerHTML = `<p class="text-[11px] leading-6">ช่วงบล็อก ${from.toLocaleString()}–${latest.toLocaleString()}${from > deploy ? ' · ไม่ใช่ประวัติทั้งหมดตั้งแต่ deploy' : ''}</p>` + (logs.length ? logs.map((log) => {
      const event = state.contract.interface.parseLog(log);
      let detail = '';
      if (event.name === 'DisputeRaised') detail = `เหตุผล: ${event.args.reason} · โดย ${event.args.raisedBy}`;
      if (event.name === 'WorkSubmitted') detail = `หลักฐาน: ${event.args.workProof}`;
      if (event.name === 'DisputeResolved') detail = event.args.paidToFreelancer ? 'จ่ายให้ฟรีแลนซ์' : 'คืนเงินผู้ว่าจ้าง';
      return `<div class="rounded-xl border border-slate-200 p-4"><div class="flex flex-wrap justify-between gap-2 text-forest"><span>${EVENT_NAMES[event.name]}</span>${explorerLink('tx', log.transactionHash)}</div>${detail ? `<p class="mt-2 whitespace-pre-wrap break-anywhere leading-6">${escapeHtml(detail)}</p>` : ''}<p class="mt-2 text-[10px]">Block ${log.blockNumber.toLocaleString()}</p></div>`;
    }).join('') : '<p class="py-3">ไม่พบ Event ในช่วงบล็อกนี้ ไม่ได้หมายความว่างานไม่มีประวัติ</p>');
  } catch (error) {
    container.textContent = `โหลด Events ไม่ได้: ${errorText(error)} ลองลด LOG_CHUNK_SIZE หรือเปลี่ยน RPC ใน config.js ประวัติเงินด้านบนยังอ่านได้ตามปกติ`;
  } finally { button.disabled = false; }
}

function bindEvents() {
  const safe = (handler) => (...args) => Promise.resolve().then(() => handler(...args)).catch((error) => notice(errorText(error), 'error'));
  $('connectWallet').addEventListener('click', safe(() => connectWallet()));
  $('switchNetwork').addEventListener('click', safe(async () => {
    try { await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: ethers.toBeHex(Number(config.CHAIN_ID)) }] }); }
    catch (error) {
      if (Number(error.code) !== 4902) throw error;
      await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId: ethers.toBeHex(Number(config.CHAIN_ID)), chainName: 'Ethereum Sepolia', nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: [config.RPC_URL], blockExplorerUrls: [config.EXPLORER_URL] }] });
    }
    await connectWallet(false);
  }));
  $('openCreate').addEventListener('click', () => {
    if (!canWrite()) return;
    $('createError').textContent = '';
    $('createDialog').showModal();
  });
  document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => {
    if (!state.busy) $(button.dataset.close).close();
  }));
  ['createDialog', 'actionDialog'].forEach((id) => $(id).addEventListener('cancel', (event) => { if (state.busy) event.preventDefault(); }));
  $('createForm').addEventListener('submit', createJob);
  $('actionForm').addEventListener('submit', submitAction);
  $('refreshData').addEventListener('click', safe(async () => {
    await refreshData();
    notice('อัปเดตข้อมูลจาก contract แล้ว');
  }));
  $('searchJobs').addEventListener('input', renderJobs);
  $('statusFilter').addEventListener('change', renderJobs);
  document.querySelectorAll('[data-scope]').forEach((button) => button.addEventListener('click', safe(async () => {
    if (state.loading || state.busy) return;
    state.scope = button.dataset.scope;
    $('statusFilter').value = 'all';
    $('searchJobs').value = '';
    renderControls();
    await refreshData();
    renderJobs();
  })));
  $('loadMore').addEventListener('click', safe(async () => {
    if (state.loading || state.busy) return;
    state.loading = true;
    const epoch = state.epoch;
    renderControls();
    try { await fetchPage(epoch); }
    finally { if (epoch === state.epoch) { state.loading = false; renderControls(); renderJobs(); } }
  }));
  $('jobList').addEventListener('click', safe((event) => {
    const button = event.target.closest('[data-job]');
    if (button) return openDetail(button.dataset.job);
  }));
  $('lookupForm').addEventListener('submit', safe((event) => { event.preventDefault(); return openDetail($('lookupId').value.trim()); }));
  $('jobDetail').addEventListener('click', safe((event) => {
    const action = event.target.closest('[data-action]');
    if (action) return openAction(action.dataset.action);
    if (event.target.closest('#loadEvents')) return loadEvents();
  }));
  if (window.ethereum?.on) {
    const changed = safe(async () => {
      ++state.epoch; // ทิ้งผลอ่านเก่าที่เป็นของบัญชี/เครือข่ายก่อนหน้า
      state.loading = false;
      state.selected = null;
      state.action = null;
      ['jobDialog', 'actionDialog', 'createDialog'].forEach((id) => $(id).close());
      await connectWallet(false);
    });
    window.ethereum.on('accountsChanged', changed);
    window.ethereum.on('chainChanged', changed);
  }
  window.setInterval(() => {
    if ($('jobDialog').open && !$('actionDialog').open && !state.busy && !state.loading) {
      // ไม่เรียก RPC ซ้ำ แต่ป้องกันปุ่มหมดอายุค้าง โดยไม่รบกวนการอ่าน Events
      renderDetailActions();
    }
  }, 15000);
}

async function init() {
  bindEvents();
  if (!window.ethers) { notice('โหลด ethers.js ไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตและรีเฟรชหน้าเว็บ', 'error'); return; }
  if (!config.CONTRACT_ADDRESS) { renderControls(); return; }
  try {
    if (Number(config.CHAIN_ID) !== 11155111) throw new Error('ตัวอย่างนี้รองรับเฉพาะ Sepolia (CHAIN_ID 11155111)');
    if (!ethers.isAddress(config.CONTRACT_ADDRESS) || sameAddress(config.CONTRACT_ADDRESS, ethers.ZeroAddress)) throw new Error('CONTRACT_ADDRESS ไม่ถูกต้อง กรุณาตั้งค่าใน config.js');
    if (!safeUrl(config.RPC_URL) || !safeUrl(config.EXPLORER_URL)) throw new Error('RPC_URL และ EXPLORER_URL ต้องเป็น HTTP(S) URL');
    state.rpc = new ethers.JsonRpcProvider(config.RPC_URL);
    if (Number((await state.rpc.getNetwork()).chainId) !== Number(config.CHAIN_ID)) throw new Error('RPC ไม่ใช่ Sepolia กรุณาตรวจ config.js');
    if (await state.rpc.getCode(config.CONTRACT_ADDRESS) === '0x') throw new Error('ไม่พบ bytecode ของ contract ที่ address นี้บน Sepolia');
    state.contract = new ethers.Contract(config.CONTRACT_ADDRESS, ABI, state.rpc);
    let version;
    try { version = await state.contract.CONTRACT_VERSION(); }
    catch { throw new Error('Contract นี้เป็นรุ่นเก่าหรือไม่รองรับ CONTRACT_VERSION กรุณา deploy FreelanceEscrow รุ่น 2 แล้วเปลี่ยน CONTRACT_ADDRESS ใน config.js รุ่นเก่ายังมีเส้นทางคืนเงินโดยตรง'); }
    if (version !== REQUIRED_CONTRACT_VERSION) throw new Error('ต้องใช้ FreelanceEscrow CONTRACT_VERSION = 2 กรุณา deploy โค้ดปัจจุบันแล้วอัปเดต config.js');
    state.admin = await state.contract.admin();
    state.ready = true;
    $('setupNotice').classList.add('hidden');
    $('contractLink').href = `${safeUrl(config.EXPLORER_URL).replace(/\/$/, '')}/address/${config.CONTRACT_ADDRESS}`;
    $('contractLink').textContent = `Contract: ${shortAddress(config.CONTRACT_ADDRESS)} ↗`;
    if (window.ethereum) await connectWallet(false);
    else await refreshData();
  } catch (error) { notice(`เชื่อมต่อหรือโหลดข้อมูลไม่ได้: ${errorText(error)}`, 'error'); }
  finally { renderControls(); }
}

init();

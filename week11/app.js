/* SmartLiving — ethers v6, read-only RPC + MetaMask for signing. */
const ABI = [
  'function arbitrator() view returns (address)',
  'function propertyCount() view returns (uint256)',
  'function agreementCount() view returns (uint256)',
  'function contractBalance() view returns (uint256)',
  'function getProperty(uint256) view returns ((uint256 id,address landlord,string name,uint256 monthlyRent,uint256 depositAmount,bool isActive,bool isRented))',
  'function getAgreement(uint256) view returns ((uint256 id,uint256 propertyId,address landlord,address tenant,uint256 startDate,uint256 endDate,uint256 monthlyRent,uint256 depositAmount,uint256 depositBalance,uint256 totalPeriods,uint256 paidPeriods,string terms,bool landlordConfirmed,bool tenantConfirmed,bool depositPaid,uint256 proposedDeduction,string deductionReason,string disputeResolution,uint8 status))',
  'function getPayments(uint256) view returns ((uint256 period,uint256 amount,address payer,uint256 timestamp)[])',
  'function registerProperty(string,uint256,uint256) returns (uint256)',
  'function createAgreement(uint256,address,uint256,uint256,string) returns (uint256)',
  'function confirmAgreement(uint256)',
  'function cancelAgreement(uint256)',
  'function depositSecurity(uint256) payable',
  'function payRent(uint256) payable',
  'function inspectAndPropose(uint256,uint256,string)',
  'function approveDeduction(uint256)',
  'function raiseDispute(uint256)',
  'function resolveDispute(uint256,uint256,string)'
];

const config = window.APP_CONFIG || {};
const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const statusNames = ['รอยืนยัน', 'กำลังเช่า', 'รอผู้เช่าตอบ', 'ข้อพิพาท', 'ปิดสัญญา', 'ยกเลิก'];
const statusStyles = ['bg-amber-50 text-amber-800','bg-emerald-50 text-emerald-800','bg-orange-50 text-orange-800','bg-rose-50 text-rose-800','bg-slate-100 text-slate-700','bg-slate-100 text-slate-500'];
const short = address => address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '—';
const same = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
// Show the exact value: shortening a deposit/deduction could mislead users before signing.
const eth = wei => ethers.formatEther(wei ?? 0n);
const date = timestamp => new Date(Number(timestamp) * 1000).toLocaleString('th-TH-u-ca-gregory', {dateStyle:'medium', timeStyle:'short'});
const addressLink = address => `<a class="break-all text-[#257456] hover:underline" href="${config.EXPLORER_URL}/address/${encodeURIComponent(address)}" target="_blank" rel="noopener noreferrer">${escapeHtml(address)} ↗</a>`;
let reader, contract, writer, wallet = '', arbitrator = '', properties = [], agreements = [];
let filter = 'all', detailId = null, detailVersion = 0, pending = false, toastTimer;

function notify(message, error = false) {
  const element = $('toast');
  clearTimeout(toastTimer);
  element.textContent = message;
  element.style.background = error ? '#9f273b' : '#163b35';
  element.classList.remove('hidden');
  toastTimer = setTimeout(() => element.classList.add('hidden'), 6000);
}
function notice(message) { $('notice').textContent = message; $('notice').classList.remove('hidden'); }
function errorMessage(error) {
  if (error?.code === 4001 || error?.code === 'ACTION_REJECTED') return 'ยกเลิกธุรกรรมใน Wallet';
  return error?.revert?.args?.[0] || error?.reason || error?.shortMessage || error?.info?.error?.message || error?.message || 'เกิดข้อผิดพลาด';
}
function parsePositive(text, label, allowZero = false) {
  let value;
  try { value = ethers.parseEther(text.trim()); } catch { throw Error(`${label}: จำนวน ETH ไม่ถูกต้อง`); }
  if (allowZero ? value < 0n : value <= 0n) throw Error(`${label}: ${allowZero ? 'ต้องไม่ติดลบ' : 'ต้องมากกว่า 0'}`);
  return value;
}
function activeWallet() {
  if (!writer || !wallet) { notify('เชื่อมต่อ MetaMask และเลือก Sepolia ก่อนทำรายการ', true); return false; }
  return true;
}
function openDialog(id) { if (activeWallet()) $(id).showModal(); }

async function init() {
  if (typeof ethers === 'undefined') { notice('โหลด ethers.js ไม่สำเร็จ ตรวจสอบอินเทอร์เน็ต'); return; }
  if (!ethers.isAddress(config.CONTRACT_ADDRESS || '')) {
    notice('ยังไม่ได้ตั้งค่า CONTRACT_ADDRESS ใน week11/config.js — Deploy SmartPropertyRental.sol บน Sepolia แล้วใส่ address ก่อนใช้งาน');
    $('propertyGrid').textContent = 'รอตั้งค่า Contract Address';
    $('agreementList').textContent = 'รอตั้งค่า Contract Address';
    return;
  }
  try {
    reader = new ethers.JsonRpcProvider(config.RPC_URL, config.CHAIN_ID, {staticNetwork: true});
    contract = new ethers.Contract(config.CONTRACT_ADDRESS, ABI, reader);
    if (await reader.getCode(config.CONTRACT_ADDRESS) === '0x') throw Error('ไม่พบ Contract ที่ address นี้บน Sepolia');
    arbitrator = await contract.arbitrator();
    await refresh();
    await syncWallet();
  } catch (error) {
    console.error(error);
    notice('อ่านข้อมูลบน Sepolia ไม่สำเร็จ: ' + errorMessage(error) + ' · ตรวจสอบ RPC และ Contract Address');
    $('propertyGrid').textContent = 'โหลดทรัพย์สินไม่สำเร็จ';
    $('agreementList').textContent = 'โหลดสัญญาไม่สำเร็จ';
  }
}
async function syncWallet() {
  writer = null; wallet = '';
  if (!window.ethereum || !contract) { $('connectBtn').textContent = 'เชื่อมต่อ Wallet'; render(); return; }
  try {
    const [accounts, chain] = await Promise.all([
      window.ethereum.request({method:'eth_accounts'}),
      window.ethereum.request({method:'eth_chainId'})
    ]);
    if (accounts.length && BigInt(chain) === BigInt(config.CHAIN_ID)) {
      wallet = ethers.getAddress(accounts[0]);
      const provider = new ethers.BrowserProvider(window.ethereum);
      writer = new ethers.Contract(config.CONTRACT_ADDRESS, ABI, await provider.getSigner());
    }
    $('connectBtn').textContent = wallet ? `● ${short(wallet)}` : accounts.length ? 'สลับเป็น Sepolia' : 'เชื่อมต่อ Wallet';
    render();
    if (detailId !== null && $('detailDialog').open) showDetail(detailId);
  } catch (error) { console.error(error); notify(errorMessage(error), true); }
}
async function connect() {
  if (!window.ethereum) return notify('ไม่พบ MetaMask กรุณาติดตั้งส่วนขยาย Wallet', true);
  if (!contract) return notify('ตั้งค่า Contract Address ก่อนเชื่อมต่อ', true);
  $('connectBtn').disabled = true;
  try {
    await window.ethereum.request({method:'eth_requestAccounts'});
    const chain = await window.ethereum.request({method:'eth_chainId'});
    if (BigInt(chain) !== BigInt(config.CHAIN_ID)) {
      try { await window.ethereum.request({method:'wallet_switchEthereumChain', params:[{chainId:'0xaa36a7'}]}); }
      catch (error) {
        if (error.code !== 4902) throw error;
        await window.ethereum.request({method:'wallet_addEthereumChain',params:[{chainId:'0xaa36a7',chainName:'Sepolia',nativeCurrency:{name:'Sepolia Ether',symbol:'ETH',decimals:18},rpcUrls:[config.RPC_URL],blockExplorerUrls:[config.EXPLORER_URL]}]});
      }
    }
    await syncWallet();
  } catch (error) { notify(errorMessage(error), true); }
  finally { $('connectBtn').disabled = false; }
}
async function fetchAll(count, getter) {
  const items = [];
  for (let start = 1; start <= count; start += 6) {
    const ids = Array.from({length: Math.min(6, count - start + 1)}, (_, index) => start + index);
    items.push(...await Promise.all(ids.map(getter)));
  }
  return items.reverse();
}
async function refresh() {
  if (!contract) return;
  $('refreshBtn').disabled = true;
  try {
    const [propertyCount, agreementCount, contractBalance] = await Promise.all([contract.propertyCount(), contract.agreementCount(), contract.contractBalance()]);
    [properties, agreements] = await Promise.all([
      fetchAll(Number(propertyCount), id => contract.getProperty(id)),
      fetchAll(Number(agreementCount), id => contract.getAgreement(id))
    ]);
    $('propertyTotal').textContent = String(propertyCount);
    $('agreementTotal').textContent = String(agreementCount);
    $('escrowTotal').textContent = eth(agreements.reduce((sum, a) => sum + a.depositBalance, 0n)) + ' ETH';
    $('contractTotal').textContent = eth(contractBalance) + ' ETH';
    $('notice').classList.add('hidden');
    render();
    if (detailId !== null && $('detailDialog').open) await showDetail(detailId);
  } catch (error) { console.error(error); notice('รีเฟรชข้อมูลไม่สำเร็จ: ' + errorMessage(error)); }
  finally { $('refreshBtn').disabled = false; }
}
function render() {
  if (!contract) return;
  $('propertyGrid').innerHTML = properties.length ? properties.map(p => `
    <article class="panel flex flex-col overflow-hidden">
      <div class="grid h-32 place-items-center bg-gradient-to-br from-[#ddebe0] to-[#eff4e8] text-5xl text-[#428663]" aria-hidden="true">⌂</div>
      <div class="flex flex-1 flex-col p-5"><div class="flex items-start justify-between gap-2"><span class="text-xs font-semibold tracking-widest text-[#438969]">PROPERTY #${p.id}</span><span class="badge ${p.isRented ? 'bg-slate-100 text-slate-600' : p.isActive ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}">${p.isRented ? 'มีผู้เช่า' : p.isActive ? 'เปิดให้เช่า' : 'ไม่เปิดให้เช่า'}</span></div>
      <h3 class="mt-3 break-words text-xl font-semibold">${escapeHtml(p.name)}</h3><p class="mt-1 text-xs text-slate-500">เจ้าของ ${short(p.landlord)}</p>
      <div class="mt-5 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 text-sm"><div><p class="text-xs text-slate-500">ค่าเช่าต่องวด</p><strong>${eth(p.monthlyRent)} ETH</strong></div><div><p class="text-xs text-slate-500">เงินประกัน</p><strong>${eth(p.depositAmount)} ETH</strong></div></div>
      ${same(wallet, p.landlord) && p.isActive && !p.isRented ? `<button class="btn btn-light mt-5 w-full" data-create="${p.id}" type="button">+ สร้างสัญญาเช่า</button>` : ''}</div>
    </article>`).join('') : '<div class="panel p-10 text-center text-sm text-slate-500 md:col-span-2 lg:col-span-3">ยังไม่มีทรัพย์สิน · เชื่อมต่อ Wallet เพื่อลงทะเบียนรายการแรก</div>';

  const visible = agreements.filter(a => filter === 'all' || filter === 'mine' && (same(wallet,a.landlord) || same(wallet,a.tenant)) || filter === 'disputed' && Number(a.status) === 3);
  $('agreementList').innerHTML = visible.length ? visible.map(a => {
    const property = properties.find(p => p.id === a.propertyId);
    const status = Number(a.status);
    const pct = Number(a.totalPeriods) ? Math.min(100, Number(a.paidPeriods * 100n / a.totalPeriods)) : 0;
    return `<article class="panel flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6"><div class="min-w-0 flex-1"><div class="flex flex-wrap items-center gap-2"><span class="text-xs font-semibold text-[#438969]">CONTRACT #${a.id}</span><span class="badge ${statusStyles[status] || ''}">${statusNames[status] || 'ไม่ทราบสถานะ'}</span></div><h3 class="mt-2 break-words text-lg font-semibold">${escapeHtml(property?.name || `ทรัพย์สิน #${a.propertyId}`)}</h3><p class="mt-1 text-xs text-slate-500">${date(a.startDate)} – ${date(a.endDate)}</p><div class="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm"><span>ค่าเช่า <strong>${eth(a.monthlyRent)} ETH</strong></span><span>เงินประกันคงเหลือ <strong>${eth(a.depositBalance)} ETH</strong></span><span>จ่ายแล้ว <strong>${a.paidPeriods}/${a.totalPeriods} งวด</strong></span></div><div class="mt-3 h-1.5 max-w-sm overflow-hidden rounded-full bg-slate-100"><div class="h-full rounded-full bg-[#54a678]" style="width:${pct}%"></div></div></div><button type="button" class="btn btn-outline shrink-0" data-detail="${a.id}">จัดการสัญญา →</button></article>`;
  }).join('') : `<div class="panel p-9 text-center text-sm text-slate-500">${filter === 'mine' ? 'ไม่พบสัญญาที่เกี่ยวข้องกับ Wallet นี้' : filter === 'disputed' ? 'ยังไม่มีข้อพิพาท' : 'ยังไม่มีสัญญาเช่า'}</div>`;
  document.querySelectorAll('[data-filter]').forEach(button => { button.className = 'btn ' + (button.dataset.filter === filter ? 'btn-dark' : 'btn-outline'); });
}

function setupAgreement(propertyId) {
  if (!activeWallet()) return;
  const mine = properties.filter(p => same(wallet,p.landlord) && p.isActive && !p.isRented);
  if (!mine.length) return notify('ต้องมีทรัพย์สินที่เปิดให้เช่าของ Wallet นี้ก่อน', true);
  $('agreementProperty').innerHTML = mine.map(p => `<option value="${p.id}">#${p.id} ${escapeHtml(p.name)} · ${eth(p.monthlyRent)} ETH / งวด</option>`).join('');
  if (propertyId) $('agreementProperty').value = String(propertyId);
  const toLocal = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0,16);
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  $('startDate').value = toLocal(start);
  $('endDate').value = toLocal(new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000));
  $('agreementDialog').showModal();
}

function actionButton(action, id, label, style = 'btn-light') {
  return `<button type="button" data-action="${action}" data-id="${id}" class="btn ${style}">${label}</button>`;
}
function detailHtml(a, payments) {
  const landlord = same(wallet, a.landlord), tenant = same(wallet, a.tenant), judge = same(wallet, arbitrator);
  const status = Number(a.status), ended = Date.now() / 1000 >= Number(a.endDate);
  const property = properties.find(p => p.id === a.propertyId);
  const actions = [];
  if (status === 0) {
    if (landlord && !a.landlordConfirmed || tenant && !a.tenantConfirmed) actions.push(actionButton('confirm',a.id,'✓ ยืนยันข้อตกลง'));
    if (landlord || tenant) actions.push(actionButton('cancel',a.id,'ยกเลิกสัญญา','btn-outline'));
    if (tenant && a.landlordConfirmed && a.tenantConfirmed && !a.depositPaid) actions.push(actionButton('deposit',a.id,`ฝากเงินประกัน ${eth(a.depositAmount)} ETH`,'btn-dark'));
  }
  if (status === 1) {
    if (tenant && a.paidPeriods < a.totalPeriods) actions.push(actionButton('rent',a.id,`จ่ายค่าเช่างวด ${a.paidPeriods + 1n} · ${eth(a.monthlyRent)} ETH`,'btn-dark'));
    if (landlord && ended) actions.push(`<form data-form="inspect" data-id="${a.id}" class="mt-4 space-y-3 rounded-xl bg-[#f4f8f2] p-4"><h4 class="font-semibold">ตรวจห้องและคืนเงินประกัน</h4><p class="text-xs text-slate-500">ใส่ 0 เพื่อคืนเต็มจำนวนทันที; หากหักเงินต้องระบุเหตุผลและรอผู้เช่าตอบ</p><div><label class="label" for="deduction-${a.id}">ยอดหัก (ETH) · สูงสุด ${eth(a.depositBalance)} ETH</label><input id="deduction-${a.id}" class="field" name="amount" inputmode="decimal" required value="0"></div><div><label class="label" for="reason-${a.id}">เหตุผลเมื่อหักเงิน</label><textarea id="reason-${a.id}" class="field" name="reason" rows="2" placeholder="เช่น ค่าซ่อมแซมอุปกรณ์"></textarea></div><button class="btn btn-dark" type="submit">บันทึกผลตรวจห้อง</button></form>`);
  }
  if (status === 2 && tenant) {
    actions.push(actionButton('approve',a.id,`ยอมรับยอดหัก ${eth(a.proposedDeduction)} ETH`,'btn-dark'));
    actions.push(actionButton('dispute',a.id,'ไม่เห็นด้วย · ยื่นข้อพิพาท','btn-outline'));
  }
  if (status === 3 && judge) actions.push(`<form data-form="resolve" data-id="${a.id}" class="mt-4 space-y-3 rounded-xl bg-[#f4f8f2] p-4"><h4 class="font-semibold">ตัดสินข้อพิพาท</h4><p class="text-xs text-slate-500">ผู้ตัดสินสามารถกำหนดยอดหักใหม่ได้ ไม่จำเป็นต้องเท่ากับยอดที่เสนอ</p><div><label class="label" for="approved-${a.id}">ยอดหักที่อนุมัติ (ETH) · สูงสุด ${eth(a.depositBalance)} ETH</label><input id="approved-${a.id}" class="field" name="amount" inputmode="decimal" required value="0"></div><div><label class="label" for="resolution-${a.id}">เหตุผลการตัดสิน</label><textarea id="resolution-${a.id}" class="field" name="resolution" required rows="2"></textarea></div><button class="btn btn-dark" type="submit">บันทึกผลและจ่ายเงิน</button></form>`);

  return `<div class="space-y-6">
    <div class="flex flex-wrap items-center gap-2"><span class="badge ${statusStyles[status] || ''}">${statusNames[status] || 'ไม่ทราบสถานะ'}</span><span class="text-sm text-slate-500">ทรัพย์สิน #${a.propertyId} · ${escapeHtml(property?.name || 'ไม่พบชื่อทรัพย์สิน')}</span></div>
    <div class="grid gap-3 sm:grid-cols-3"><div class="rounded-xl bg-[#f4f8f2] p-4"><p class="text-xs text-slate-500">ค่าเช่าต่องวด (30 วัน)</p><strong class="mt-1 block text-lg">${eth(a.monthlyRent)} ETH</strong><p class="text-xs text-slate-500">จ่ายแล้ว ${a.paidPeriods}/${a.totalPeriods} งวด</p></div><div class="rounded-xl bg-[#f4f8f2] p-4"><p class="text-xs text-slate-500">เงินประกันที่ตกลง</p><strong class="mt-1 block text-lg">${eth(a.depositAmount)} ETH</strong><p class="text-xs text-slate-500">${a.depositPaid ? 'ฝากแล้ว' : 'ยังไม่ฝาก'}</p></div><div class="rounded-xl bg-[#f4f8f2] p-4"><p class="text-xs text-slate-500">เงินประกันคงเหลือ</p><strong class="mt-1 block text-lg">${eth(a.depositBalance)} ETH</strong><p class="text-xs text-slate-500">ตามบัญชีสัญญา</p></div></div>
    <section class="grid gap-4 border-t border-slate-100 pt-5 text-sm sm:grid-cols-2"><div><p class="text-xs text-slate-500">เจ้าของห้อง ${a.landlordConfirmed ? '✓ ยืนยันแล้ว' : '· รอยืนยัน'}</p>${addressLink(a.landlord)}</div><div><p class="text-xs text-slate-500">ผู้เช่า ${a.tenantConfirmed ? '✓ ยืนยันแล้ว' : '· รอยืนยัน'}</p>${addressLink(a.tenant)}</div><div><p class="text-xs text-slate-500">เริ่มสัญญา</p><strong>${date(a.startDate)}</strong></div><div><p class="text-xs text-slate-500">สิ้นสุดสัญญา</p><strong>${date(a.endDate)}</strong></div></section>
    <section class="border-t border-slate-100 pt-5"><h3 class="font-semibold">เงื่อนไขสัญญา</h3><p class="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-slate-600">${escapeHtml(a.terms)}</p></section>
    ${status === 2 || status === 3 || status === 4 && a.deductionReason ? `<section class="rounded-xl border border-orange-100 bg-orange-50 p-4 text-sm"><h3 class="font-semibold">ข้อเสนอการหักเงินประกัน</h3><p class="mt-1">ยอดที่เสนอ: ${status === 4 ? 'ชำระแล้ว (ยอดเสนอถูกล้างเมื่อปิดสัญญา)' : eth(a.proposedDeduction) + ' ETH'}</p><p class="mt-1 whitespace-pre-wrap break-words">เหตุผล: ${escapeHtml(a.deductionReason)}</p>${a.disputeResolution ? `<p class="mt-2 whitespace-pre-wrap break-words">ผลตัดสิน: ${escapeHtml(a.disputeResolution)}</p>` : ''}</section>` : ''}
    <section class="border-t border-slate-100 pt-5"><h3 class="font-semibold">รายการที่ทำได้</h3><div class="mt-3 flex flex-wrap gap-2">${actions.length ? actions.join('') : '<p class="text-sm text-slate-500">ไม่มีรายการที่ทำได้สำหรับ Wallet หรือสถานะปัจจุบัน</p>'}</div>${status === 1 && !ended ? '<p class="mt-2 text-xs text-slate-500">เจ้าของห้องตรวจสภาพและคืนเงินประกันได้เมื่อถึงวันสิ้นสุดสัญญาเท่านั้น</p>' : ''}</section>
    <section class="border-t border-slate-100 pt-5"><h3 class="font-semibold">ประวัติชำระค่าเช่า (${payments.length} รายการ)</h3><div class="mt-3 space-y-2">${payments.length ? payments.map(p => `<div class="flex flex-wrap justify-between gap-2 rounded-xl border border-slate-100 p-3 text-sm"><div><strong>งวดที่ ${p.period}</strong><p class="text-xs text-slate-500">${date(p.timestamp)} · ${short(p.payer)}</p></div><strong class="text-[#257456]">${eth(p.amount)} ETH</strong></div>`).join('') : '<p class="text-sm text-slate-500">ยังไม่มีการจ่ายค่าเช่า</p>'}</div></section>
  </div>`;
}
async function showDetail(id) {
  const a = agreements.find(item => Number(item.id) === id);
  if (!a) return;
  detailId = id;
  const version = ++detailVersion;
  $('detailTitle').textContent = `สัญญาเช่า #${id}`;
  $('detailContent').textContent = 'กำลังอ่านรายละเอียดและประวัติการชำระ...';
  if (!$('detailDialog').open) $('detailDialog').showModal();
  try {
    const payments = await contract.getPayments(id);
    if (version === detailVersion && detailId === id) $('detailContent').innerHTML = detailHtml(a, payments);
  } catch (error) {
    if (version === detailVersion) $('detailContent').textContent = 'อ่านรายละเอียดไม่สำเร็จ: ' + errorMessage(error);
  }
}

async function transact(call, success) {
  if (!activeWallet() || pending) return false;
  pending = true;
  try {
    notify('กำลังเปิด MetaMask เพื่อยืนยันธุรกรรม…');
    const tx = await call();
    notify('ส่งธุรกรรมแล้ว กำลังรอการยืนยันบน Sepolia…');
    const receipt = await tx.wait();
    if (receipt.status !== 1) throw Error('ธุรกรรมไม่สำเร็จ');
    notify(`${success} · Block #${receipt.blockNumber} · ${tx.hash.slice(0,10)}…`);
    await refresh();
    return true;
  } catch (error) { console.error(error); notify(errorMessage(error), true); return false; }
  finally { pending = false; }
}

async function handleAction(action, id) {
  const a = agreements.find(item => Number(item.id) === id);
  if (!a || !activeWallet()) return;
  if (action === 'cancel' && !confirm('ยกเลิกสัญญานี้ก่อนฝากเงินประกัน?')) return;
  if (action === 'approve' && !confirm(`ยอมรับยอดหัก ${eth(a.proposedDeduction)} ETH และคืนเงินส่วนที่เหลือ?`)) return;
  if (action === 'deposit' && !confirm(`ฝากเงินประกัน ${eth(a.depositAmount)} ETH เข้าสัญญา?`)) return;
  if (action === 'rent' && !confirm(`จ่ายค่าเช่างวดถัดไป ${eth(a.monthlyRent)} ETH ให้เจ้าของห้อง?`)) return;
  const calls = {
    confirm: () => writer.confirmAgreement(id), cancel: () => writer.cancelAgreement(id),
    deposit: () => writer.depositSecurity(id, {value:a.depositAmount}),
    rent: () => writer.payRent(id, {value:a.monthlyRent}),
    approve: () => writer.approveDeduction(id), dispute: () => writer.raiseDispute(id)
  };
  if (calls[action]) await transact(calls[action], 'ทำรายการสำเร็จ');
}

document.addEventListener('DOMContentLoaded', () => {
  $('connectBtn').addEventListener('click', connect);
  $('refreshBtn').addEventListener('click', refresh);
  for (const id of ['openPropertyBtn','propertyAddBtn']) $(id).addEventListener('click', () => openDialog('propertyDialog'));
  $('propertyForm').addEventListener('submit', async event => {
    event.preventDefault();
    try {
      const name = $('propertyName').value.trim();
      if (!name) throw Error('กรุณาระบุชื่อทรัพย์สิน');
      const rent = parsePositive($('propertyRent').value, 'ค่าเช่า');
      const deposit = parsePositive($('propertyDeposit').value, 'เงินประกัน');
      if (await transact(() => writer.registerProperty(name,rent,deposit), 'ลงทะเบียนทรัพย์สินสำเร็จ')) { $('propertyDialog').close(); $('propertyForm').reset(); }
    } catch (error) { notify(errorMessage(error), true); }
  });
  $('agreementForm').addEventListener('submit', async event => {
    event.preventDefault();
    try {
      const propertyId = Number($('agreementProperty').value), tenant = $('tenantAddress').value.trim();
      const start = Math.floor(new Date($('startDate').value).getTime() / 1000);
      const end = Math.floor(new Date($('endDate').value).getTime() / 1000);
      const terms = $('agreementTerms').value.trim();
      if (!ethers.isAddress(tenant) || same(tenant,wallet)) throw Error('Wallet ผู้เช่าไม่ถูกต้องหรือซ้ำกับเจ้าของห้อง');
      if (!Number.isSafeInteger(start) || start <= Math.floor(Date.now()/1000) || !Number.isSafeInteger(end) || end <= start) throw Error('วันเริ่มต้องอยู่ในอนาคตและวันสิ้นสุดต้องมาทีหลัง');
      if (!terms) throw Error('กรุณาระบุเงื่อนไขสัญญา');
      if (await transact(() => writer.createAgreement(propertyId,tenant,start,end,terms), 'สร้างสัญญาสำเร็จ')) { $('agreementDialog').close(); $('agreementForm').reset(); }
    } catch (error) { notify(errorMessage(error), true); }
  });
  document.addEventListener('click', event => {
    const close = event.target.closest('[data-close]');
    if (close) $(close.dataset.close).close();
    const create = event.target.closest('[data-create]');
    if (create) setupAgreement(Number(create.dataset.create));
    const detail = event.target.closest('[data-detail]');
    if (detail) showDetail(Number(detail.dataset.detail));
    const action = event.target.closest('[data-action]');
    if (action) handleAction(action.dataset.action, Number(action.dataset.id));
    const tab = event.target.closest('[data-filter]');
    if (tab) { filter = tab.dataset.filter; render(); }
  });
  $('detailDialog').addEventListener('close', () => { detailId = null; detailVersion++; });
  $('detailDialog').addEventListener('submit', async event => {
    const form = event.target.closest('[data-form]');
    if (!form) return;
    event.preventDefault();
    try {
      const id = Number(form.dataset.id);
      const a = agreements.find(item => Number(item.id) === id);
      if (!a) return;
      const amount = parsePositive(form.elements.amount.value, 'ยอดหัก', true);
      if (amount > a.depositBalance) throw Error('ยอดหักต้องไม่เกินเงินประกันคงเหลือ');
      if (form.dataset.form === 'inspect') {
        const reason = form.elements.reason.value.trim();
        if (amount > 0n && !reason) throw Error('ต้องระบุเหตุผลเมื่อหักเงินประกัน');
        if (amount === 0n && !confirm('คืนเงินประกันเต็มจำนวนและปิดสัญญาทันที?')) return;
        await transact(() => writer.inspectAndPropose(id,amount,reason), amount === 0n ? 'คืนเงินประกันเต็มจำนวนสำเร็จ' : 'เสนอหักเงินประกันสำเร็จ');
      } else {
        const resolution = form.elements.resolution.value.trim();
        if (!resolution) throw Error('กรุณาระบุผลการตัดสิน');
        if (!confirm(`ตัดสินให้หัก ${eth(amount)} ETH และจ่ายเงินคืนส่วนที่เหลือทันที?`)) return;
        await transact(() => writer.resolveDispute(id,amount,resolution), 'ตัดสินข้อพิพาทและจ่ายเงินสำเร็จ');
      }
    } catch (error) { notify(errorMessage(error), true); }
  });
  window.ethereum?.on?.('accountsChanged', syncWallet);
  window.ethereum?.on?.('chainChanged', syncWallet);
  init();
});

/* SkillTrust Academy — ethers v6. Private certificate data stays in this browser. */
'use strict';

const COURSE = '(string courseId,string name,string description,uint256 durationHours,uint256 createdAt,bool active,bool exists)';
const CERTIFICATE = '(string certId,string courseId,address recipient,bytes32 certHash,uint256 issuedAt,address issuer,bool revoked,uint256 revokedAt,string revokeReason,bool exists)';
const ABI = [
  'function admin() view returns (address)',
  'function isIssuer(address) view returns (bool)',
  'function totalCertificates() view returns (uint256)',
  'function addIssuer(address)', 'function removeIssuer(address)', 'function transferAdmin(address)',
  'function createCourse(string,string,string,uint256)', 'function setCourseActive(string,bool)',
  `function getCourse(string) view returns (${COURSE})`,
  'function getAllCourseIds() view returns (string[])',
  'function issueCertificate(string,string,address,bytes32)',
  `function getCertificate(string) view returns (${CERTIFICATE})`,
  'function verifyCertificate(string,bytes32) view returns (bool found,bool hashMatch,bool revoked,bool valid)',
  'function getCertificateStatus(string) view returns (string)',
  'function revokeCertificate(string,string)',
  'function getCertificateIdsByHolder(address) view returns (string[])',
  `function getMyCertificates() view returns (${CERTIFICATE}[])`,
  `function getCertificatesByHolder(address) view returns (${CERTIFICATE}[])`,
  'function computeHash(string,string,string,string) pure returns (bytes32)'
];
const config = window.APP_CONFIG || {};
const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const same = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const short = value => value ? `${value.slice(0, 6)}…${value.slice(-4)}` : '—';
const date = value => Number(value) ? new Date(Number(value) * 1000).toLocaleString('th-TH-u-ca-gregory', {dateStyle: 'medium', timeStyle: 'short'}) : '—';
const titles = {verify:'ตรวจสอบใบรับรองดิจิทัล', dashboard:'ใบรับรองของฉัน', courses:'หลักสูตรอบรม', issue:'ออกและเพิกถอนใบรับรอง', admin:'จัดการสิทธิ์ผู้ใช้งาน'};
let reader, contract, writer, wallet = '', admin = '', issuer = false;
let courses = [], holderCertificates = [], holder = '', filter = 'all';
let pending = false, initializing = false, toastTimer, hashTarget = '', hashResult = '';
let walletVersion = 0, refreshVersion = 0, holderVersion = 0, verifyVersion = 0, detailVersion = 0, detailId = null;
let hashVersion = 0;

function notify(message, error = false) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').style.background = error ? '#a92b46' : '#192b5b';
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 6500);
}
function notice(message) { $('notice').textContent = message; $('notice').hidden = false; }
function errorMessage(error) {
  if (error?.code === 4001 || error?.code === 'ACTION_REJECTED') return 'ยกเลิกการยืนยันใน Wallet';
  return error?.revert?.args?.[0] || error?.reason || error?.shortMessage || error?.info?.error?.message || error?.message || 'เกิดข้อผิดพลาด กรุณาลองใหม่';
}
function requireContract() {
  if (!contract) throw Error('ตั้งค่า CONTRACT_ADDRESS ใน week10/config.js และเชื่อมต่อ RPC ให้สำเร็จก่อน');
  return contract;
}
function address(value) {
  if (typeof ethers === 'undefined') throw Error('โหลด ethers.js ไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วโหลดหน้าใหม่');
  if (!ethers.isAddress(value) || same(value, ethers.ZeroAddress)) throw Error('กรุณาระบุ Wallet address ที่ถูกต้องและไม่ใช่ Zero address');
  return ethers.getAddress(value);
}
function documentHash(value) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw Error('Hash ต้องเป็น bytes32: 0x ตามด้วยตัวอักษร hex 64 ตัว');
  return value;
}
function requiredText(id, label) {
  const value = $(id).value.trim();
  if (!value) throw Error(`กรุณาระบุ${label}`);
  return value;
}
function addressLink(value) {
  return `<a href="${config.EXPLORER_URL}/address/${encodeURIComponent(value)}" target="_blank" rel="noopener noreferrer" class="break-all font-mono text-xs text-indigo-600 hover:underline">${escapeHtml(value)} ↗</a>`;
}
function badge(revoked) {
  return `<span class="badge ${revoked ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}">${revoked ? '× เพิกถอนแล้ว' : '● มีผลตามสถานะบนเชน'}</span>`;
}
function navigate() {
  const view = Object.hasOwn(titles, location.hash.slice(1)) ? location.hash.slice(1) : 'verify';
  document.querySelectorAll('[data-view]').forEach(el => {
    if (el.dataset.view === view) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
  Object.keys(titles).forEach(key => { $(`view-${key}`).hidden = key !== view; });
  $('pageTitle').textContent = titles[view];
  document.title = `${titles[view]} — SkillTrust Academy`;
}
function renderPermissions() {
  const isAdmin = same(wallet, admin);
  $('walletRole').textContent = wallet ? isAdmin ? (issuer ? 'Admin / Issuer' : 'Admin') : issuer ? 'Issuer' : 'ผู้รับ / ผู้ตรวจสอบ' : 'ผู้เยี่ยมชม';
  document.querySelectorAll('[data-permission]').forEach(button => {
    button.disabled = pending || !writer || (button.dataset.permission === 'admin' ? !isAdmin : !issuer);
    button.title = button.disabled ? 'ต้องเชื่อม Wallet ที่มีสิทธิ์และอยู่บน Sepolia' : '';
  });
  $('connectBtn').disabled = pending;
  $('myCertsBtn').disabled = !writer;
  document.querySelectorAll('[data-course-toggle]').forEach(button => { button.disabled = pending || !writer || !isAdmin; });
}

async function initialize() {
  if (initializing) return;
  initializing = true;
  try {
    if (typeof ethers === 'undefined') throw Error('โหลด ethers.js ไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วโหลดหน้าใหม่');
    if (!ethers.isAddress(config.CONTRACT_ADDRESS || '') || same(config.CONTRACT_ADDRESS, ethers.ZeroAddress)) {
      throw Error('ยังไม่ได้ตั้งค่า CONTRACT_ADDRESS ใน week10/config.js — Deploy DigitalCertificate.sol บน Sepolia แล้วใส่ address ของ contract (ไม่ใช่ Wallet)');
    }
    if (config.CHAIN_ID !== 11155111) throw Error('หน้าเว็บนี้ตั้งค่าสำหรับ Sepolia เท่านั้น กรุณาใช้ CHAIN_ID: 11155111');
    reader = new ethers.JsonRpcProvider(config.RPC_URL, config.CHAIN_ID, {staticNetwork: true});
    const chain = await reader.send('eth_chainId', []);
    if (BigInt(chain) !== BigInt(config.CHAIN_ID)) throw Error('RPC ไม่ใช่เครือข่าย Sepolia');
    if (await reader.getCode(config.CONTRACT_ADDRESS) === '0x') throw Error('ไม่พบ Smart Contract ที่ address นี้บน Sepolia');
    contract = new ethers.Contract(config.CONTRACT_ADDRESS, ABI, reader);
    await refresh();
    await syncWallet();
    if ($('verifyId').value.trim()) await verify();
  } catch (error) {
    contract = null;
    reader?.destroy();
    notice(errorMessage(error));
    $('courseList').innerHTML = '<div class="panel p-8 text-sm text-slate-400 md:col-span-2">ยังอ่านหลักสูตรไม่ได้ · ตั้งค่า Contract แล้วโหลดหน้าเว็บใหม่</div>';
  } finally { initializing = false; renderPermissions(); }
}
async function readCourses(ids) {
  const list = [];
  // Bound RPC concurrency for a classroom-size deployment.
  for (let i = 0; i < ids.length; i += 6) list.push(...await Promise.all(ids.slice(i, i + 6).map(id => contract.getCourse(id))));
  return list;
}
async function refresh() {
  if (!contract) return initialize();
  const version = ++refreshVersion;
  $('refreshBtn').disabled = true;
  try {
    const [currentAdmin, total, ids] = await Promise.all([contract.admin(), contract.totalCertificates(), contract.getAllCourseIds()]);
    const list = await readCourses(ids);
    if (version !== refreshVersion) return;
    admin = currentAdmin;
    courses = list;
    $('courseTotal').textContent = String(ids.length);
    $('certTotal').textContent = String(total);
    $('adminAddress').innerHTML = addressLink(admin);
    $('notice').hidden = true;
    renderCourses();
    await updateRole();
    await Promise.all([
      holder ? loadHolder(holder) : Promise.resolve(),
      detailId && $('detailDialog').open ? showDetail(detailId) : Promise.resolve()
    ]);
  } catch (error) {
    notice('รีเฟรชข้อมูลไม่สำเร็จ ข้อมูลเดิมอาจไม่ใช่สถานะล่าสุด: ' + errorMessage(error));
    throw error;
  } finally { if (version === refreshVersion) $('refreshBtn').disabled = false; }
}
async function updateRole() {
  const currentWallet = wallet, version = walletVersion;
  issuer = false;
  renderPermissions();
  if (!wallet || !contract) return;
  try {
    const allowed = await contract.isIssuer(currentWallet);
    if (version === walletVersion && same(wallet, currentWallet)) issuer = allowed;
  } catch (error) { notify('อ่านสิทธิ์ Issuer ไม่สำเร็จ: ' + errorMessage(error), true); }
  renderPermissions();
}
async function syncWallet() {
  const version = ++walletVersion;
  writer = null; wallet = ''; issuer = false;
  holderVersion++;
  holder = ''; holderCertificates = [];
  $('holderAddress').value = '';
  $('holderSummary').textContent = 'ยังไม่ได้เลือก Wallet';
  renderHolder(); renderPermissions();
  $('connectBtn').textContent = 'เชื่อมต่อ Wallet ↗';
  if (!window.ethereum || !contract) return;
  try {
    const [accounts, chain] = await Promise.all([
      window.ethereum.request({method: 'eth_accounts'}), window.ethereum.request({method: 'eth_chainId'})
    ]);
    if (version !== walletVersion) return;
    if (!accounts.length) return;
    if (BigInt(chain) !== BigInt(config.CHAIN_ID)) { $('connectBtn').textContent = 'สลับเป็น Sepolia'; return; }
    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner(accounts[0]);
    if (version !== walletVersion) return;
    wallet = ethers.getAddress(accounts[0]);
    writer = new ethers.Contract(config.CONTRACT_ADDRESS, ABI, signer);
    $('connectBtn').textContent = `● ${short(wallet)}`;
    $('connectBtn').title = wallet;
    await updateRole();
    if (version === walletVersion) await loadHolder(wallet);
  } catch (error) { notify(errorMessage(error), true); }
  finally { renderPermissions(); }
}
async function connect() {
  try {
    requireContract();
    if (!window.ethereum) throw Error('ไม่พบ MetaMask กรุณาติดตั้งส่วนขยาย Wallet เพื่อทำธุรกรรม');
    $('connectBtn').disabled = true;
    await window.ethereum.request({method: 'eth_requestAccounts'});
    const chain = await window.ethereum.request({method: 'eth_chainId'});
    if (BigInt(chain) !== BigInt(config.CHAIN_ID)) {
      try { await window.ethereum.request({method: 'wallet_switchEthereumChain', params: [{chainId: '0xaa36a7'}]}); }
      catch (error) {
        if (error.code !== 4902) throw error;
        await window.ethereum.request({method: 'wallet_addEthereumChain', params: [{chainId: '0xaa36a7', chainName: 'Sepolia', nativeCurrency: {name: 'Sepolia Ether', symbol: 'ETH', decimals: 18}, rpcUrls: [config.RPC_URL], blockExplorerUrls: [config.EXPLORER_URL]}]});
      }
    }
    await syncWallet();
  } catch (error) { notify(errorMessage(error), true); }
  finally { renderPermissions(); }
}

function renderCourses() {
  $('courseList').innerHTML = courses.length ? courses.map(c => `<article class="panel flex flex-col p-6"><div class="flex items-center justify-between gap-3"><span class="badge bg-indigo-50 text-indigo-600">${escapeHtml(c.courseId)}</span><span class="badge ${c.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}">${c.active ? '● เปิดใช้งาน' : 'ปิดใช้งาน'}</span></div><h3 class="mt-5 break-words text-lg font-semibold">${escapeHtml(c.name)}</h3><p class="mt-2 flex-1 whitespace-pre-wrap break-words text-sm leading-7 text-slate-500">${escapeHtml(c.description || 'ไม่มีรายละเอียดเพิ่มเติม')}</p><div class="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4"><span class="text-sm text-slate-500">◷ ${c.durationHours} ชั่วโมง</span><button type="button" class="btn outline text-xs" data-course-toggle="${escapeHtml(c.courseId)}" ${!same(wallet, admin) || !writer || pending ? 'disabled' : ''}>${c.active ? 'ปิดหลักสูตร' : 'เปิดหลักสูตร'}</button></div></article>`).join('') : '<div class="panel p-10 text-center text-sm text-slate-400 md:col-span-2">ยังไม่มีหลักสูตร · Admin สามารถเพิ่มหลักสูตรแรกได้</div>';
  const selected = $('issueCourse').value;
  $('issueCourse').innerHTML = '<option value="">เลือกหลักสูตรที่เปิดใช้งาน</option>' + courses.filter(c => c.active).map(c => `<option value="${escapeHtml(c.courseId)}">${escapeHtml(c.courseId)} — ${escapeHtml(c.name)}</option>`).join('');
  if (courses.some(c => c.courseId === selected && c.active)) $('issueCourse').value = selected;
}
function renderHolder() {
  document.querySelectorAll('[data-filter]').forEach(button => { button.className = 'btn ' + (button.dataset.filter === filter ? 'secondary' : 'outline'); });
  const visible = holderCertificates.filter(c => filter === 'all' || (filter === 'revoked' ? c.revoked : !c.revoked));
  $('holderList').innerHTML = visible.length ? visible.map(c => {
    const course = courses.find(item => item.courseId === c.courseId);
    return `<article class="panel overflow-hidden"><div class="flex items-center justify-between gap-3 border-b border-indigo-100/50 bg-[#f8f9ff] px-6 py-4"><span class="text-2xl text-indigo-400" aria-hidden="true">✧</span>${badge(c.revoked)}</div><div class="p-6"><p class="break-all text-xs text-indigo-500">${escapeHtml(c.certId)}</p><h3 class="mt-3 break-words text-lg font-semibold">${escapeHtml(course?.name || c.courseId)}</h3><p class="mt-2 text-xs text-slate-400">ออกเมื่อ ${date(c.issuedAt)}</p><button type="button" class="btn secondary mt-5 w-full" data-detail="${escapeHtml(c.certId)}">ดูรายละเอียดและ QR Code ↗</button></div></article>`;
  }).join('') : `<div class="panel p-10 text-center text-sm text-slate-400 md:col-span-2">${holder ? 'ไม่พบใบรับรองตามตัวกรองนี้' : 'เชื่อมต่อ Wallet หรือระบุ address เพื่อดูใบรับรอง'}</div>`;
}
async function loadHolder(value) {
  const current = address(value), version = ++holderVersion;
  requireContract();
  holder = current;
  $('holderAddress').value = current;
  $('holderSummary').textContent = 'กำลังอ่านใบรับรอง…';
  $('holderList').textContent = 'กำลังโหลด…';
  try {
    // getMyCertificates must use a signer so msg.sender is the connected holder.
    const list = writer && same(current, wallet) ? await writer.getMyCertificates() : await contract.getCertificatesByHolder(current);
    if (version !== holderVersion) return;
    holderCertificates = Array.from(list).reverse();
    $('holderSummary').textContent = `${short(current)} · ${list.length} ใบรับรอง · เพิกถอน ${list.filter(c => c.revoked).length} ใบ`;
    renderHolder();
  } catch (error) {
    if (version !== holderVersion) return;
    holderCertificates = [];
    $('holderSummary').textContent = 'อ่านใบรับรองไม่สำเร็จ';
    $('holderList').textContent = errorMessage(error);
  }
}

function invalidateVerification() {
  verifyVersion++;
  $('verifyResult').replaceChildren();
  $('verifyBtn').disabled = false;
}
async function verify() {
  const version = ++verifyVersion;
  $('verifyBtn').disabled = true;
  $('verifyResult').textContent = 'กำลังตรวจสอบกับบล็อกเชน…';
  try {
    requireContract();
    const id = requiredText('verifyId', 'รหัสใบรับรอง'), hash = $('verifyHash').value.trim();
    if (hash) documentHash(hash);
    const result = hash ? await contract.verifyCertificate(id, hash) : null;
    const status = result ? !result.found ? 'NOT_FOUND' : result.revoked ? 'REVOKED' : 'VALID' : await contract.getCertificateStatus(id);
    if (version !== verifyVersion) return;
    const good = !!result?.valid;
    const bad = status === 'NOT_FOUND' || status === 'REVOKED' || !!result && !result.hashMatch;
    let title, message;
    if (status === 'NOT_FOUND') { title = 'ไม่พบใบรับรอง'; message = 'ตรวจสอบรหัส ตัวพิมพ์เล็ก/ใหญ่ และ Contract Address อีกครั้ง'; }
    else if (status === 'REVOKED') { title = 'ใบรับรองถูกเพิกถอน'; message = result ? (result.hashMatch ? 'Hash ตรง แต่ใบรับรองนี้ไม่สามารถใช้งานได้' : 'Hash ไม่ตรง และใบรับรองนี้ถูกเพิกถอนแล้ว') : 'ใบรับรองนี้ไม่สามารถใช้งานได้ ดูเหตุผลและวันที่ในรายละเอียด'; }
    else if (result && !result.hashMatch) { title = 'Hash ไม่ตรงกับข้อมูลบนเชน'; message = 'ไฟล์หรือข้อมูลอาจถูกแก้ไข หรือใช้วิธี Hash รหัส ชื่อ หรือ salt ไม่ตรงกับตอนออกใบรับรอง'; }
    else if (good) { title = 'ตรวจสอบผ่าน · ใบรับรองถูกต้อง'; message = 'พบใบรับรอง Hash ตรงกับที่บันทึกไว้ และยังไม่ถูกเพิกถอน'; }
    else { title = 'พบใบรับรอง · ยังมีผลตามสถานะ'; message = 'ยังไม่ได้เปรียบเทียบ Hash จึงยังยืนยันความตรงกันของข้อมูลเอกสารไม่ได้'; }
    $('verifyResult').innerHTML = `<div class="rounded-xl border p-5 ${good ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : bad ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-amber-200 bg-amber-50 text-amber-900'}"><h3 class="font-semibold">${title}</h3><p class="mt-2 text-sm leading-6">${message}</p>${status !== 'NOT_FOUND' ? `<button type="button" data-detail="${escapeHtml(id)}" class="mt-4 text-sm underline underline-offset-4">ดูรายละเอียดใบรับรอง →</button>` : ''}<p class="mt-3 text-[10px] opacity-70">สถานะ ณ เวลาที่อ่านข้อมูล · ไม่ใช่การยืนยันตัวตนของผู้ถือ Wallet</p></div>`;
  } catch (error) {
    if (version === verifyVersion) $('verifyResult').textContent = 'ตรวจสอบไม่สำเร็จ: ' + errorMessage(error);
  } finally { if (version === verifyVersion) $('verifyBtn').disabled = false; }
}
function shareUrl(id) {
  const url = new URL(location.href);
  url.search = ''; url.hash = 'verify';
  url.searchParams.set('certId', id);
  return url.href;
}
async function showDetail(id) {
  detailId = id;
  const version = ++detailVersion;
  $('detailTitle').textContent = id;
  $('detailContent').textContent = 'กำลังอ่านใบรับรอง…';
  if (!$('detailDialog').open) $('detailDialog').showModal();
  try {
    const c = await requireContract().getCertificate(id);
    if (version !== detailVersion || !$('detailDialog').open) return;
    const course = courses.find(item => item.courseId === c.courseId);
    const url = shareUrl(id);
    $('detailContent').innerHTML = `<div class="space-y-5">${badge(c.revoked)}<div class="rounded-xl bg-indigo-50 p-5"><p class="text-xs text-indigo-500">${escapeHtml(c.courseId)}</p><h3 class="mt-2 break-words text-xl font-semibold">${escapeHtml(course?.name || c.courseId)}</h3><p class="mt-2 text-xs text-slate-500">วันที่ออก ${date(c.issuedAt)}</p></div><dl class="space-y-4 text-sm"><div><dt class="mb-1 text-xs text-slate-400">Wallet ผู้รับ</dt><dd>${addressLink(c.recipient)}</dd></div><div><dt class="mb-1 text-xs text-slate-400">Wallet ผู้ออก</dt><dd>${addressLink(c.issuer)}</dd></div><div><dt class="mb-1 text-xs text-slate-400">Hash ที่บันทึกบนเชน</dt><dd class="break-all font-mono text-xs leading-6">${escapeHtml(c.certHash)}</dd></div></dl><p class="text-xs leading-6 text-slate-400">Hash ที่แสดงเป็นค่าอ้างอิงบนเชน ไม่ใช่หลักฐานว่าเอกสารที่คุณถืออยู่ตรงกัน ต้องคำนวณจากข้อมูลต้นฉบับแล้วเปรียบเทียบอีกครั้ง</p>${c.revoked ? `<section class="rounded-xl bg-rose-50 p-4 text-sm text-rose-800"><h3 class="font-semibold">เพิกถอนเมื่อ ${date(c.revokedAt)}</h3><p class="mt-2 whitespace-pre-wrap break-words leading-6">${escapeHtml(c.revokeReason)}</p></section>` : ''}<section class="border-t border-slate-100 pt-5"><h3 class="font-semibold">แชร์เพื่อดูสถานะใบรับรอง</h3><p class="mt-2 text-xs leading-6 text-slate-400">ลิงก์มีเฉพาะ certId ไม่มีชื่อ salt หรือ Hash · ผู้รับต้องเข้าถึงเว็บนี้ได้และใช้ config ของ contract เดียวกัน</p><div class="mt-4 flex flex-col items-center gap-5 sm:flex-row"><div id="qrCode" class="shrink-0 rounded-xl border border-slate-100 bg-white p-3" role="img" aria-label="QR Code ลิงก์ตรวจสอบใบรับรอง"></div><div class="min-w-0 flex-1"><p class="break-all text-xs leading-6 text-slate-500">${escapeHtml(url)}</p><button class="btn secondary mt-3" type="button" data-copy="${escapeHtml(url)}">คัดลอกลิงก์</button></div></div></section></div>`;
    if (typeof QRCode !== 'undefined') {
      try { new QRCode($('qrCode'), {text: url, width: 144, height: 144, colorDark: '#19243f', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M}); }
      catch { $('qrCode').textContent = 'ลิงก์ยาวเกินไป ใช้คัดลอกลิงก์แทน'; }
    } else $('qrCode').textContent = 'โหลด QR ไม่สำเร็จ ใช้ลิงก์แทนได้';
  } catch (error) { if (version === detailVersion) $('detailContent').textContent = 'อ่านใบรับรองไม่ได้: ' + errorMessage(error); }
}

function invalidateHash() {
  hashVersion++;
  hashResult = '';
  $('hashOutput').hidden = true;
  $('hashValue').textContent = '';
  $('computeHashBtn').disabled = false;
}
function updateHashMode() {
  const pdf = $('hashMode').value === 'pdf';
  $('pdfHashFields').hidden = !pdf;
  $('pdfHashFields').disabled = !pdf;
  $('metadataHashFields').hidden = pdf;
  $('metadataHashFields').disabled = pdf;
  // Do not retain unused personal inputs when switching algorithms.
  $('hashPdfFile').value = '';
  $('hashHolderName').value = '';
  invalidateHash();
}
async function computePdfHash(file, certId, courseId, salt) {
  if (!file || !file.size) throw Error('กรุณาเลือกไฟล์ PDF ที่ไม่ว่าง');
  if (file.size > 20 * 1024 * 1024) throw Error('ไฟล์ PDF ต้องมีขนาดไม่เกิน 20 MiB');
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Check the PDF header, not the user-controlled extension or MIME type.
  if (bytes.length < 5 || ![37, 80, 68, 70, 45].every((byte, i) => bytes[i] === byte)) throw Error('ไม่พบส่วนหัว %PDF- กรุณาเลือกไฟล์ PDF จริง');
  // Domain-separated commitment to the exact final PDF, IDs and private salt.
  // DigitalCertificate accepts any nonzero bytes32; no contract upgrade is needed.
  return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
    ['string', 'string', 'string', 'bytes32', 'string'],
    ['SKILLTRUST_PDF_V1', certId, courseId, ethers.keccak256(bytes), salt]
  ));
}
function randomSalt() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  $('hashSalt').value = '0x' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  invalidateHash();
}
function openHash(target) {
  if (typeof ethers === 'undefined') return notify('โหลด ethers.js ไม่สำเร็จ', true);
  hashTarget = target;
  $('hashForm').reset(); updateHashMode();
  $('hashCertId').value = target === 'issueHash' ? $('issueId').value.trim() : $('verifyId').value.trim();
  $('hashCourseId').value = target === 'issueHash' ? $('issueCourse').value : '';
  if (target === 'issueHash') randomSalt();
  // Do not generate a new salt for verification: it must match the original.
  $('hashDialog').showModal();
}
async function copy(value) {
  try { await navigator.clipboard.writeText(value); notify('คัดลอกแล้ว'); }
  catch { notify('คัดลอกอัตโนมัติไม่ได้ กรุณาเลือกข้อความแล้วคัดลอกด้วยตัวเอง', true); }
}

async function transact(method, args, success, permission) {
  if (pending) return false;
  if (!writer || !wallet) { notify('เชื่อมต่อ Wallet และเลือก Sepolia ก่อนทำรายการ', true); return false; }
  if (permission === 'admin' ? !same(wallet, admin) : !issuer) { notify('Wallet นี้ไม่มีสิทธิ์ทำรายการ', true); return false; }
  const signingContract = writer, signingWallet = wallet;
  pending = true; renderPermissions();
  $('txStatus').hidden = false;
  $('txStatus').textContent = 'กำลังเปิด Wallet เพื่อยืนยันธุรกรรม…';
  try {
    const [accounts, chain] = await Promise.all([window.ethereum.request({method: 'eth_accounts'}), window.ethereum.request({method: 'eth_chainId'})]);
    if (!same(accounts[0], signingWallet) || BigInt(chain) !== BigInt(config.CHAIN_ID)) throw Error('Wallet หรือเครือข่ายเปลี่ยนแล้ว กรุณาตรวจสอบและทำรายการใหม่');
    const tx = await signingContract[method](...args);
    $('txStatus').innerHTML = `<p>ส่งธุรกรรมแล้ว รอยืนยันบน Sepolia…</p><a class="mt-2 block break-all text-xs text-indigo-600 underline" href="${config.EXPLORER_URL}/tx/${encodeURIComponent(tx.hash)}" target="_blank" rel="noopener noreferrer">${escapeHtml(tx.hash)} ↗</a>`;
    let receipt;
    try { receipt = await tx.wait(); }
    catch (error) {
      if (error.code === 'TRANSACTION_REPLACED' && !error.cancelled) receipt = error.receipt;
      else throw error;
    }
    if (!receipt || receipt.status !== 1) throw Error('ธุรกรรมไม่สำเร็จ');
    $('txStatus').innerHTML = `<p class="text-emerald-700">✓ ${escapeHtml(success)} · Block #${receipt.blockNumber}</p><a class="mt-2 block text-xs text-indigo-600 underline" href="${config.EXPLORER_URL}/tx/${encodeURIComponent(receipt.hash)}" target="_blank" rel="noopener noreferrer">ดูธุรกรรมบน Etherscan ↗</a>`;
    // A failed refresh is not a failed transaction. Never encourage resubmission.
    try {
      await refresh();
      if ($('verifyId').value.trim()) await verify();
    } catch { notify('ธุรกรรมยืนยันสำเร็จแล้ว แต่อ่านข้อมูลล่าสุดไม่ได้ กรุณากดรีเฟรช ไม่ต้องส่งซ้ำ', true); }
    return true;
  } catch (error) {
    $('txStatus').textContent = 'ทำรายการไม่สำเร็จ: ' + errorMessage(error);
    notify(errorMessage(error), true);
    return false;
  } finally { pending = false; renderPermissions(); }
}

// Route all asynchronous event errors to a visible message.
function on(id, event, handler) {
  $(id).addEventListener(event, e => { Promise.resolve().then(() => handler(e)).catch(error => notify(errorMessage(error), true)); });
}
document.addEventListener('DOMContentLoaded', () => {
  navigate();
  window.addEventListener('hashchange', navigate);
  const certId = new URLSearchParams(location.search).get('certId');
  if (certId) { $('verifyId').value = certId; location.hash = 'verify'; }
  on('connectBtn', 'click', connect);
  on('refreshBtn', 'click', refresh);
  on('verifyForm', 'submit', e => { e.preventDefault(); return verify(); });
  for (const id of ['verifyId', 'verifyHash']) on(id, 'input', invalidateVerification);
  on('holderForm', 'submit', e => { e.preventDefault(); return loadHolder($('holderAddress').value.trim()); });
  on('myCertsBtn', 'click', () => { if (wallet) return loadHolder(wallet); });
  on('createCourseBtn', 'click', () => $('courseDialog').showModal());
  on('courseForm', 'submit', async e => {
    e.preventDefault();
    const id = requiredText('courseId', 'รหัสหลักสูตร'), name = requiredText('courseName', 'ชื่อหลักสูตร');
    const hours = $('courseHours').value;
    if (!/^\d+$/.test(hours)) throw Error('จำนวนชั่วโมงต้องเป็นจำนวนเต็มที่ไม่ติดลบ');
    if (BigInt(hours) > ethers.MaxUint256) throw Error('จำนวนชั่วโมงเกินขอบเขต uint256');
    if (await transact('createCourse', [id, name, $('courseDescription').value.trim(), BigInt(hours)], 'ลงทะเบียนหลักสูตรสำเร็จ', 'admin')) {
      $('courseDialog').close(); $('courseForm').reset();
    }
  });
  on('issueForm', 'submit', async e => {
    e.preventDefault();
    const id = requiredText('issueId', 'รหัสใบรับรอง'), courseId = requiredText('issueCourse', 'หลักสูตร');
    const recipient = address($('issueRecipient').value.trim()), hash = documentHash($('issueHash').value.trim());
    if (hash.toLowerCase() === ethers.ZeroHash) throw Error('ไม่สามารถใช้ Hash ที่เป็นศูนย์ทั้งหมด');
    if (!courses.some(c => c.courseId === courseId && c.active)) throw Error('กรุณาเลือกหลักสูตรที่เปิดใช้งาน');
    if (!confirm(`ออกใบรับรอง ${id}\nหลักสูตร ${courseId}\nผู้รับ ${recipient}\n\nข้อมูลแก้ไขไม่ได้ และ Wallet ต้องจ่ายค่า gas ยืนยันหรือไม่?`)) return;
    if (await transact('issueCertificate', [id, courseId, recipient, hash], 'ออกใบรับรองสำเร็จ', 'issuer')) {
      $('issueForm').reset();
      $('verifyId').value = id; $('verifyHash').value = ''; invalidateVerification();
      await showDetail(id);
    }
  });
  on('revokeForm', 'submit', async e => {
    e.preventDefault();
    const id = requiredText('revokeId', 'รหัสใบรับรอง'), reason = requiredText('revokeReason', 'เหตุผลการเพิกถอน');
    if (!confirm(`เพิกถอน ${id} อย่างถาวร?\nเหตุผลจะเป็นข้อมูลสาธารณะบนบล็อกเชน`)) return;
    if (await transact('revokeCertificate', [id, reason], 'เพิกถอนใบรับรองสำเร็จ', 'issuer')) $('revokeForm').reset();
  });
  on('checkIssuerBtn', 'click', async () => {
    const value = address($('issuerAddress').value.trim());
    $('issuerCheckResult').textContent = 'กำลังตรวจสอบ…';
    const allowed = await requireContract().isIssuer(value);
    if (same($('issuerAddress').value.trim(), value)) $('issuerCheckResult').textContent = `${short(value)} ${allowed ? 'มีสิทธิ์ Issuer' : 'ไม่มีสิทธิ์ Issuer'}`;
  });
  on('issuerAddress', 'input', () => { $('issuerCheckResult').textContent = ''; });
  on('issuerForm', 'submit', async e => {
    e.preventDefault();
    const value = address($('issuerAddress').value.trim()), remove = e.submitter?.value === 'remove';
    if (remove && same(value, admin)) throw Error('ไม่สามารถถอนสิทธิ์ Issuer ของ Admin ปัจจุบันได้');
    if (!confirm(`${remove ? 'ถอน' : 'เพิ่ม'}สิทธิ์ Issuer ของ\n${value}?`)) return;
    if (await transact(remove ? 'removeIssuer' : 'addIssuer', [value], remove ? 'ถอนสิทธิ์ Issuer สำเร็จ' : 'เพิ่ม Issuer สำเร็จ', 'admin')) $('issuerCheckResult').textContent = '';
  });
  on('transferForm', 'submit', async e => {
    e.preventDefault();
    const value = address($('newAdmin').value.trim());
    if (same(value, admin)) throw Error('Wallet นี้เป็น Admin อยู่แล้ว');
    if (!confirm(`โอน Admin ให้\n${value}\n\nคุณจะเสียสิทธิ์จัดการหลักสูตรและผู้ใช้ทันที ยืนยันหรือไม่?`)) return;
    if (await transact('transferAdmin', [value], 'โอนสิทธิ์ Admin สำเร็จ', 'admin')) $('transferForm').reset();
  });
  on('hashForm', 'input', invalidateHash);
  on('hashForm', 'change', invalidateHash);
  on('hashMode', 'change', updateHashMode);
  on('hashForm', 'submit', async e => {
    e.preventDefault();
    invalidateHash();
    const version = hashVersion, mode = $('hashMode').value;
    const [certId, courseId, salt] = ['hashCertId', 'hashCourseId', 'hashSalt'].map(id => $(id).value);
    if ([certId, courseId, salt].some(v => !v.trim())) throw Error('กรุณากรอกรหัสใบรับรอง รหัสหลักสูตร และ salt ให้ครบ');
    $('computeHashBtn').disabled = true;
    try {
      let result;
      if (mode === 'pdf') result = await computePdfHash($('hashPdfFile').files[0], certId, courseId, salt);
      else {
        const name = $('hashHolderName').value;
        if (!name.trim()) throw Error('กรุณากรอกชื่อผู้รับ');
        // Legacy helper: exact Unicode, spaces and casing; never solidityPacked.
        result = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['string', 'string', 'string', 'string'], [certId, courseId, name, salt]));
      }
      // Ignore file reads completed after editing, closing or reopening the studio.
      if (version !== hashVersion || !$('hashDialog').open) return;
      hashResult = result;
      $('hashScheme').textContent = mode === 'pdf' ? 'PDF V1 · ทุกไบต์ของไฟล์ · bytes32' : 'ข้อมูล 4 ช่องเท่านั้น · ไม่ใช่ PDF Hash · bytes32';
      $('hashValue').textContent = result;
      $('hashOutput').hidden = false;
    } finally { if (version === hashVersion) $('computeHashBtn').disabled = false; }
  });
  on('generateSaltBtn', 'click', randomSalt);
  on('copyHashBtn', 'click', () => copy(hashResult));
  on('useHashBtn', 'click', () => {
    if (!hashResult) throw Error('กรุณาคำนวณ Hash ใหม่');
    const expectedId = (hashTarget === 'issueHash' ? $('issueId') : $('verifyId')).value.trim();
    if ($('hashCertId').value !== expectedId) throw Error('รหัสใน Hash ไม่ตรงกับรหัสใบรับรองในฟอร์มหลัก');
    if (hashTarget === 'issueHash' && $('hashCourseId').value !== $('issueCourse').value) throw Error('รหัสหลักสูตรใน Hash ไม่ตรงกับหลักสูตรที่เลือก');
    if (!confirm('บันทึก PDF/ข้อมูลต้นฉบับ วิธี Hash รหัส และ salt ไว้อย่างปลอดภัยแล้วหรือไม่?\nเมื่อปิดหน้าต่าง ไฟล์ที่เลือก ข้อมูลชื่อ และ salt จะถูกล้าง')) return;
    $(hashTarget).value = hashResult;
    if (hashTarget === 'verifyHash') invalidateVerification();
    $('hashDialog').close();
  });
  on('hashDialog', 'close', () => { $('hashForm').reset(); updateHashMode(); hashTarget = ''; });
  for (const id of ['issueId', 'issueCourse']) on(id, id === 'issueId' ? 'input' : 'change', () => { $('issueHash').value = ''; });
  on('detailDialog', 'close', () => { detailId = null; detailVersion++; $('detailContent').replaceChildren(); });
  document.addEventListener('click', e => {
    const run = async () => {
      const close = e.target.closest('[data-close]');
      if (close) $(close.dataset.close).close();
      const hash = e.target.closest('[data-hash-target]');
      if (hash) openHash(hash.dataset.hashTarget);
      const detail = e.target.closest('[data-detail]');
      if (detail) await showDetail(detail.dataset.detail);
      const copyButton = e.target.closest('[data-copy]');
      if (copyButton) await copy(copyButton.dataset.copy);
      const tab = e.target.closest('[data-filter]');
      if (tab) { filter = tab.dataset.filter; renderHolder(); }
      const toggle = e.target.closest('[data-course-toggle]');
      if (toggle && !toggle.disabled) {
        const course = courses.find(c => c.courseId === toggle.dataset.courseToggle);
        if (course && confirm(`${course.active ? 'ปิด' : 'เปิด'}หลักสูตร ${course.courseId}?`)) await transact('setCourseActive', [course.courseId, !course.active], 'เปลี่ยนสถานะหลักสูตรสำเร็จ', 'admin');
      }
    };
    run().catch(error => notify(errorMessage(error), true));
  });
  window.ethereum?.on?.('accountsChanged', syncWallet);
  window.ethereum?.on?.('chainChanged', syncWallet);
  window.ethereum?.on?.('disconnect', syncWallet);
  initialize();
});

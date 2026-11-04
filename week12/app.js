/* InnovateFund — plain browser JS + ethers v6. Never put private keys in frontend code. */
const ABI = [
  'function campaignCount() view returns (uint256)',
  'function getCampaign(uint256 id) view returns (address owner,string title,uint256 goal,uint256 deadline,uint256 totalRaised,uint256 totalPaid,uint256 contractBalanceForCampaign,uint256 nextMilestone,uint256 milestoneCount)',
  'function getMilestone(uint256 id,uint256 index) view returns (string description,uint256 percentage,uint8 status,string evidence,uint256 votingDeadline,uint256 approveWeight,uint256 rejectWeight,uint256 paidAmount)',
  'function getHistoryLength(uint256 id) view returns (uint256)',
  'function getHistory(uint256 id,uint256 index) view returns (uint8 txType,address account,uint256 amount,uint256 timestamp,uint256 milestoneIndex)',
  'function getContribution(uint256 id,address backer) view returns (uint256)',
  'function createCampaign(string title,uint256 goal,uint256 durationDays,string[] descriptions,uint256[] percentages) returns (uint256)',
  'function contribute(uint256 id) payable',
  'function requestRelease(uint256 id,string evidence)',
  'function vote(uint256 id,bool approve)',
  'function finalizeVoting(uint256 id)',
  'function refund(uint256 id)',
];
const config = window.APP_CONFIG || {};
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const statusNames = ['รอเริ่ม', 'รอโหวต', 'อนุมัติแล้ว', 'ไม่ผ่าน'];
const statusClasses = ['bg-slate-100 text-slate-700','bg-amber-100 text-amber-800','bg-emerald-100 text-emerald-800','bg-rose-100 text-rose-800'];
let readProvider, readContract, signer, writeContract, wallet = '', campaigns = [], filtered = 'all', detailId = null, toastTimer;
const fmtEth = (wei, max=5) => {
  const v = ethers.formatEther(wei ?? 0n);
  const [a,b=''] = v.split('.');
  return a + (b ? '.' + b.slice(0,max).replace(/0+$/,'') : '');
};
const short = (a) => a ? a.slice(0,6) + '…' + a.slice(-4) : '—';
const dateStr = (t) => new Date(Number(t)*1000).toLocaleString('th-TH', {dateStyle:'medium', timeStyle:'short'});
const nowSec = () => Math.floor(Date.now()/1000);
const goalPct = (c) => c.goal > 0n ? Math.min(100, Number(c.totalRaised*10000n/c.goal)/100) : 0;
const isOwner = c => !!wallet && wallet.toLowerCase() === c.owner.toLowerCase();
const explorerTx = (hash) => `${config.EXPLORER_URL}/tx/${encodeURIComponent(hash)}`;
const explorerAddress = (address) => `${config.EXPLORER_URL}/address/${encodeURIComponent(address)}`;
function notice(message) { $('notice').textContent = message; $('notice').classList.remove('hidden'); }
function clearNotice() { $('notice').classList.add('hidden'); }
function toast(message, error=false) {
  const el = $('toast'); clearTimeout(toastTimer);
  el.textContent = message; el.style.background = error ? '#991b1b' : '#0f172a'; el.classList.remove('hidden');
  toastTimer = setTimeout(()=>el.classList.add('hidden'),6500);
}
function errorText(err) {
  if (err?.code === 4001 || err?.code === 'ACTION_REJECTED') return 'ยกเลิกการทำรายการใน MetaMask';
  return err?.revert?.args?.[0] || err?.reason || err?.shortMessage || err?.info?.error?.message || err?.message || 'เกิดข้อผิดพลาด';
}
function validateConfig() {
  if (!ethers.isAddress(config.CONTRACT_ADDRESS || '')) { notice('ตั้งค่า CONTRACT_ADDRESS ใน config.js เป็นที่อยู่ Contract ที่ Deploy บน Sepolia ก่อนเริ่มใช้งาน'); return false; }
  return true;
}
async function init() {
  if (typeof ethers === 'undefined') { notice('ไม่สามารถโหลด ethers.js จาก CDN ได้ โปรดตรวจสอบอินเทอร์เน็ต'); return; }
  if (!validateConfig()) { $('campaignGrid').innerHTML = `<div class="card p-8 text-slate-600">รอการตั้งค่า Contract Address ใน <code>config.js</code></div>`; return; }
  readProvider = new ethers.JsonRpcProvider(config.RPC_URL, config.CHAIN_ID, {staticNetwork:true});
  readContract = new ethers.Contract(config.CONTRACT_ADDRESS, ABI, readProvider);
  await loadCampaigns();
  if (window.ethereum?.selectedAddress) await syncWallet();
}
async function syncWallet() {
  if (!window.ethereum) return;
  try {
    const addresses = await window.ethereum.request({method:'eth_accounts'});
    const chain = await window.ethereum.request({method:'eth_chainId'});
    if (!addresses.length || Number(BigInt(chain)) !== config.CHAIN_ID) {
      wallet=''; signer=null; writeContract=null; $('connectBtn').textContent = addresses.length ? 'เปลี่ยนเป็น Sepolia' : 'เชื่อมต่อ MetaMask';
      updateFilter(); render(); return;
    }
    wallet = ethers.getAddress(addresses[0]);
    const browserProvider = new ethers.BrowserProvider(window.ethereum);
    signer = await browserProvider.getSigner();
    writeContract = new ethers.Contract(config.CONTRACT_ADDRESS, ABI, signer);
    $('connectBtn').textContent = '● ' + short(wallet);
    updateFilter(); render();
  } catch(e) { console.error(e); toast(errorText(e), true); }
}
async function connect() {
  if (!window.ethereum) { toast('ไม่พบ MetaMask กรุณาติดตั้ง MetaMask ในเบราว์เซอร์', true); return; }
  if (!validateConfig()) return;
  const btn = $('connectBtn'); btn.disabled=true;
  try {
    // Request accounts on the first click, then switch chain and create signer immediately.
    await window.ethereum.request({method:'eth_requestAccounts'});
    const chain = await window.ethereum.request({method:'eth_chainId'});
    if (Number(BigInt(chain)) !== config.CHAIN_ID) {
      try {
        await window.ethereum.request({method:'wallet_switchEthereumChain', params:[{chainId:'0xaa36a7'}]});
      } catch (e) {
        if (e.code !== 4902) throw e;
        await window.ethereum.request({method:'wallet_addEthereumChain',params:[{chainId:'0xaa36a7',chainName:'Sepolia test network',nativeCurrency:{name:'Sepolia Ether',symbol:'ETH',decimals:18},rpcUrls:[config.RPC_URL],blockExplorerUrls:[config.EXPLORER_URL]}]});
      }
    }
    await syncWallet();
  } catch(e) { toast(errorText(e),true); }
  finally { btn.disabled=false; }
}
async function loadCampaigns() {
  if (!readContract) return;
  $('refreshBtn').disabled=true;
  try {
    clearNotice();
    const count = Number(await readContract.campaignCount());
    // Batch requests so RPC endpoints are not hammered for large deployments.
    const items=[];
    for(let i=0;i<count;i+=8) {
      const ids=Array.from({length:Math.min(8,count-i)},(_,j)=>i+j);
      const batch=await Promise.all(ids.map(async id => {
        const r=await readContract.getCampaign(id);
        return {id,owner:r[0],title:r[1],goal:r[2],deadline:r[3],totalRaised:r[4],totalPaid:r[5],balance:r[6],nextMilestone:r[7],milestoneCount:r[8]};
      }));
      items.push(...batch);
    }
    campaigns=items.reverse();
    $('statProjects').textContent = String(count);
    $('statRaised').textContent = fmtEth(campaigns.reduce((s,c)=>s+c.totalRaised,0n)) + ' ETH';
    $('statPaid').textContent = fmtEth(campaigns.reduce((s,c)=>s+c.totalPaid,0n)) + ' ETH';
    render();
  } catch(e) { console.error(e); notice('อ่านข้อมูลจาก Sepolia ไม่สำเร็จ: '+errorText(e)+' · ตรวจสอบ RPC_URL, Chain และ Contract Address'); $('campaignGrid').innerHTML = `<div class="card p-8 muted">โหลดข้อมูลไม่สำเร็จ</div>`; }
  finally { $('refreshBtn').disabled=false; }
}
function render() {
  const items = filtered==='mine' ? campaigns.filter(isOwner) : campaigns;
  if (!items.length) {
    $('campaignGrid').innerHTML = `<div class="card p-10 text-center sm:col-span-2 lg:col-span-3"><div class="text-3xl mb-3">📁</div><h3 class="font-bold">ยังไม่มีโครงการ${filtered==='mine'?'ของคุณ':''}</h3><p class="text-sm muted mt-2">${filtered==='mine'?'เชื่อมต่อ Wallet ที่เป็นเจ้าของโครงการ หรือสร้างโครงการใหม่':'กดสร้างโครงการเพื่อเริ่มต้น'}</p></div>`;
    return;
  }
  $('campaignGrid').innerHTML=items.map(c=> {
    const pct=goalPct(c), ended=nowSec()>=Number(c.deadline);
    const state=ended ? (c.totalRaised>=c.goal?'สิ้นสุดระดมทุน · ถึงเป้า':'สิ้นสุด · ไม่ถึงเป้า'):'กำลังระดมทุน';
    return `<article class="card p-5 flex flex-col min-h-64">
      <div class="flex justify-between gap-2 items-start"><span class="pill">#${c.id}</span><span class="pill ${ended?(c.totalRaised>=c.goal?'bg-emerald-100 text-emerald-800':'bg-rose-100 text-rose-800'):'bg-blue-100 text-blue-800'}">${state}</span></div>
      <h3 class="font-bold text-xl mt-4 line-clamp-2 break-words">${esc(c.title)}</h3>
      <a class="text-xs muted mt-2 hover:text-blue-600" target="_blank" rel="noopener noreferrer" href="${explorerAddress(c.owner)}">โดย ${short(c.owner)} ↗</a>
      <div class="mt-6"><div class="flex justify-between text-sm mb-2"><strong>${fmtEth(c.totalRaised)} ETH</strong><span class="muted">${pct.toFixed(1)}%</span></div><div class="bg-slate-100 h-2.5 rounded-full overflow-hidden"><div class="h-full bg-blue-600 rounded-full" style="width:${pct}%"></div></div><p class="muted text-xs mt-2">เป้าหมาย ${fmtEth(c.goal)} ETH · ${c.milestoneCount} Milestone</p></div>
      <div class="mt-auto pt-5 flex items-center justify-between gap-2"><span class="text-xs muted">หมดเขต ${dateStr(c.deadline)}</span><button class="btn btn-soft" data-open-id="${c.id}" type="button">ดูรายละเอียด →</button></div>
    </article>`;
  }).join('');
}
function updateFilter() {
  $('filterAll').className = 'btn '+(filtered==='all'?'btn-primary':'btn-border');
  $('filterMine').className = 'btn '+(filtered==='mine'?'btn-primary':'btn-border');
}
function requireWallet() {
  if(!writeContract || !wallet) { toast('โปรดเชื่อมต่อ MetaMask และเลือก Sepolia ก่อนทำธุรกรรม', true); return false; }
  return true;
}
async function transact(action, success) {
  if (!requireWallet()) return;
  try {
    toast('กำลังเปิด MetaMask เพื่อยืนยันธุรกรรม…');
    const tx = await action();
    toast('ส่งธุรกรรมแล้ว กำลังรอการยืนยันบน Sepolia…');
    const receipt=await tx.wait();
    toast(`${success} · Block #${receipt.blockNumber}`);
    await loadCampaigns();
    if(detailId!==null && $('detailDialog').open) await openDetails(detailId);
    return true;
  } catch(e) { console.error(e); toast(errorText(e),true); }
}
function addMilestoneField(description='',percent='') {
  const container=$('milestoneFields');
  if(container.children.length>=10) return toast('เพิ่มได้สูงสุด 10 Milestones',true);
  const div=document.createElement('div'); div.className='grid grid-cols-[1fr_100px_34px] gap-2 milestone-row';
  div.innerHTML=`<input class="field milestone-description min-w-0" maxlength="250" required placeholder="รายละเอียด Milestone" value="${esc(description)}" aria-label="รายละเอียด Milestone"/><input class="field milestone-percentage min-w-0" type="number" min="1" max="100" step="1" required placeholder="%" value="${esc(percent)}" aria-label="เปอร์เซ็นต์"/><button type="button" class="text-rose-600 font-bold text-lg" aria-label="ลบ Milestone">×</button>`;
  div.querySelector('button').addEventListener('click',()=>{div.remove(); sumPercent();});
  div.querySelector('.milestone-percentage').addEventListener('input',sumPercent);
  container.appendChild(div); sumPercent();
}
function sumPercent() {
  const total=Array.from(document.querySelectorAll('.milestone-percentage')).reduce((sum,input)=>sum+(Number(input.value)||0),0);
  $('percentageTotal').textContent=`รวม: ${total}% ${total===100?'✓':'(ต้องเท่ากับ 100%)'}`;
  $('percentageTotal').className='text-sm mt-2 '+(total===100?'text-emerald-700':'text-amber-700');
}
async function createCampaign(event) {
  event.preventDefault();
  if(!requireWallet()) return;
  const title=$('titleInput').value.trim(), days=Number($('durationInput').value);
  const descriptions=Array.from(document.querySelectorAll('.milestone-description')).map(el=>el.value.trim());
  const percents=Array.from(document.querySelectorAll('.milestone-percentage')).map(el=>Number(el.value));
  let goal;
  try { goal=ethers.parseEther($('goalInput').value.trim()); } catch { return toast('จำนวน ETH ไม่ถูกต้อง',true); }
  if(!title || goal<=0n || !Number.isSafeInteger(days) || days<=0 || !descriptions.length || descriptions.some(d=>!d) || percents.some(p=>!Number.isSafeInteger(p)||p<=0) || percents.reduce((a,b)=>a+b,0)!==100) return toast('กรอกข้อมูลให้ครบ และเปอร์เซ็นต์รวมต้องเป็น 100%',true);
  const completed = await transact(()=>writeContract.createCampaign(title,goal,BigInt(days),descriptions,percents.map(BigInt)),'สร้างโครงการสำเร็จ');
  if (completed) { $('createDialog').close(); $('createForm').reset(); $('milestoneFields').replaceChildren(); addMilestoneField('',60); addMilestoneField('',40); }
}
async function openDetails(id) {
  detailId=id;
  const c=campaigns.find(x=>x.id===id); if(!c)return;
  $('detailTitle').textContent=c.title;
  $('detailContent').innerHTML='<div class="skeleton rounded-xl h-32"></div>';
  if(!$('detailDialog').open) $('detailDialog').showModal();
  try {
    const [milestones, historyLength, contribution]=await Promise.all([
      Promise.all(Array.from({length:Number(c.milestoneCount)},(_,idx)=>readContract.getMilestone(id,idx))),
      readContract.getHistoryLength(id),
      wallet?readContract.getContribution(id,wallet):Promise.resolve(0n)
    ]);
    if(detailId!==id)return;
    const ended=nowSec()>=Number(c.deadline), reached=c.totalRaised>=c.goal, owner=isOwner(c), refundable=ended&&!reached&&contribution>0n;
    const current=Number(c.nextMilestone);
    $('detailContent').innerHTML=`
      <div class="grid md:grid-cols-3 gap-3"><div class="bg-slate-50 rounded-xl p-4"><p class="muted text-xs">ระดมทุนแล้ว</p><strong class="text-xl">${fmtEth(c.totalRaised)} ETH</strong><p class="text-xs muted mt-1">เป้าหมาย ${fmtEth(c.goal)} ETH</p></div><div class="bg-slate-50 rounded-xl p-4"><p class="muted text-xs">ยอดจ่ายแล้ว</p><strong class="text-xl">${fmtEth(c.totalPaid)} ETH</strong><p class="text-xs muted mt-1">คงเหลือตามบัญชี ${fmtEth(c.balance)} ETH</p></div><div class="bg-slate-50 rounded-xl p-4"><p class="muted text-xs">สิ้นสุดระดมทุน</p><strong class="text-base">${dateStr(c.deadline)}</strong><p class="text-xs muted mt-1">${ended?'ปิดรับเงินแล้ว':'ยังเปิดรับการสนับสนุน'}</p></div></div>
      <div><p class="text-sm muted mb-2">เจ้าของโครงการ</p><a class="text-blue-700 break-all text-sm" target="_blank" rel="noopener noreferrer" href="${explorerAddress(c.owner)}">${esc(c.owner)} ↗</a></div>
      <section class="border-t border-slate-200 pt-5"><h3 class="font-bold text-lg mb-3">สนับสนุนโครงการ</h3><p class="text-sm muted mb-3">คุณสนับสนุนแล้ว ${fmtEth(contribution)} ETH · ส่ง Sepolia ETH เท่านั้น</p>
        ${!ended&&!owner?`<form id="contributeForm" class="flex gap-2"><input id="contributeInput" class="field" inputmode="decimal" placeholder="จำนวน ETH เช่น 0.01" required/><button type="submit" class="btn btn-primary whitespace-nowrap">สนับสนุน</button></form>` : `<p class="text-sm muted">${owner?'เจ้าของโครงการไม่สามารถสนับสนุนโครงการของตนเอง':ended?'สิ้นสุดระยะระดมทุนแล้ว':'โปรดเชื่อมต่อ Wallet'}</p>`}
        ${refundable?`<button id="refundBtn" class="btn btn-border mt-3">ขอคืนเงิน ${fmtEth(contribution)} ETH</button>`:''}
        ${ended&&!reached?'<p class="text-xs text-rose-700 mt-2">ไม่ถึงเป้าหมาย — ผู้สนับสนุนสามารถขอคืนเงินของตัวเองได้</p>':''}
      </section>
      <section class="border-t border-slate-200 pt-5"><h3 class="font-bold text-lg mb-4">Milestones (${milestones.length})</h3><div class="space-y-3">${milestones.map((m,idx)=>{
        const status=Number(m[2]), active=idx===current, deadline=Number(m[4]), votingOpen=active&&status===1&&nowSec()<=deadline;
        return `<div class="rounded-xl border border-slate-200 p-4"><div class="flex flex-wrap justify-between gap-2"><div><span class="text-xs muted">Milestone ${idx+1} · ${m[1]}%</span><h4 class="font-semibold mt-1 break-words">${esc(m[0])}</h4></div><span class="pill ${statusClasses[status]||''}">${statusNames[status]||'ไม่ทราบ'}</span></div>
          ${m[3]?`<p class="text-sm mt-3 break-all">หลักฐาน: ${esc(m[3])} ${/^https:\/\//i.test(m[3])?`<a class="text-blue-600" href="${esc(m[3])}" target="_blank" rel="noopener noreferrer">เปิดลิงก์ ↗</a>`:''}</p>`:''}
          ${status===1?`<p class="text-xs muted mt-3">สิ้นสุดโหวต ${dateStr(m[4])}</p><div class="grid grid-cols-2 gap-3 mt-2 text-xs"><div class="bg-emerald-50 text-emerald-800 rounded-lg p-2">เห็นด้วย: ${fmtEth(m[5])} ETH</div><div class="bg-rose-50 text-rose-800 rounded-lg p-2">ไม่เห็นด้วย: ${fmtEth(m[6])} ETH</div></div>`:''}
          ${status===2?`<p class="text-xs text-emerald-700 mt-2">จ่ายแล้ว ${fmtEth(m[7])} ETH</p>`:''}
          ${active&&owner&&ended&&reached&&(status===0||status===3)?`<form class="release-form flex flex-col sm:flex-row gap-2 mt-4" data-id="${id}"><input class="field evidence-field" required placeholder="ลิงก์หลักฐาน (เช่น https://... หรือ IPFS CID)"/><button type="submit" class="btn btn-primary whitespace-nowrap">ส่งขออนุมัติ</button></form>`:''}
          ${votingOpen&&contribution>0n?`<div class="flex flex-wrap gap-2 mt-4"><button data-vote="1" data-id="${id}" class="btn bg-emerald-600 hover:bg-emerald-700 text-white">✓ เห็นด้วย</button><button data-vote="0" data-id="${id}" class="btn bg-rose-600 hover:bg-rose-700 text-white">✕ ไม่เห็นด้วย</button></div><p class="text-xs muted mt-2">น้ำหนักคะแนนของคุณ ${fmtEth(contribution)} ETH · โหวตได้หนึ่งครั้งต่อรอบ หากโหวตแล้วธุรกรรมจะถูกปฏิเสธ</p>`:''}
          ${active&&status===1&&nowSec()>deadline?`<button data-finalize="${id}" class="btn btn-border mt-4">ปิดการโหวตที่หมดเวลา</button>`:''}
          </div>`;
      }).join('')}</div></section>
      <section class="border-t border-slate-200 pt-5"><div class="flex justify-between items-center gap-3"><div><h3 class="font-bold text-lg">ประวัติธุรกรรม</h3><p class="text-xs muted">ทั้งหมด ${historyLength} รายการ จาก Smart Contract</p></div><button class="btn btn-border" id="loadHistoryBtn" type="button">ดูรายการล่าสุด</button></div><div id="historyItems" class="space-y-2 mt-4"></div><button id="moreHistoryBtn" type="button" class="btn btn-soft mt-3 hidden">โหลดรายการเก่ากว่า</button></section>`;
    $('contributeForm')?.addEventListener('submit',e=>{e.preventDefault();try {const amount=ethers.parseEther($('contributeInput').value.trim()); if(amount<=0n)throw Error('จำนวนต้องมากกว่า 0');transact(()=>writeContract.contribute(id,{value:amount}),'สนับสนุนสำเร็จ');}catch(err){toast(errorText(err),true)}});
    $('refundBtn')?.addEventListener('click',()=>transact(()=>writeContract.refund(id),'คืนเงินสำเร็จ'));
    document.querySelectorAll('.release-form').forEach(f=>f.addEventListener('submit',e=>{e.preventDefault();transact(()=>writeContract.requestRelease(id,f.querySelector('input').value.trim()),'ส่งหลักฐานสำเร็จ');}));
    document.querySelectorAll('[data-vote]').forEach(b=>b.addEventListener('click',()=>transact(()=>writeContract.vote(id,b.dataset.vote==='1'),'ลงคะแนนสำเร็จ')));
    document.querySelectorAll('[data-finalize]').forEach(b=>b.addEventListener('click',()=>transact(()=>writeContract.finalizeVoting(id),'ปิดการโหวตสำเร็จ')));
    let nextHistory=Number(historyLength)-1;
    const loadHistory=async()=>{
      const target=$('historyItems'),button=$('moreHistoryBtn');
      if(!target)return;
      button.disabled=true;
      try{
        const indexes=Array.from({length:Math.min(10,nextHistory+1)},(_,i)=>nextHistory-i);
        const records=await Promise.all(indexes.map(i=>readContract.getHistory(id,i)));
        records.forEach((r,j)=>{
          const type=Number(r[0]), types=['สนับสนุน','คืนเงิน','จ่าย Milestone'];
          const row=document.createElement('div');
          row.className='flex flex-wrap items-center justify-between gap-2 border border-slate-100 rounded-lg p-3 text-sm';
          row.innerHTML=`<div><strong>${types[type]||'ธุรกรรม'} ${type===2?`#${Number(r[4])+1}`:''}</strong><p class="text-xs muted mt-1">${dateStr(r[3])} · <a class="text-blue-700" target="_blank" rel="noopener noreferrer" href="${explorerAddress(r[1])}">${short(r[1])} ↗</a></p></div><strong class="${type===1?'text-rose-600':type===2?'text-emerald-700':'text-blue-700'}">${fmtEth(r[2])} ETH</strong>`;
          target.appendChild(row);
        });
        nextHistory-=indexes.length;
        button.classList.toggle('hidden',nextHistory<0);
        if(!records.length&&!target.children.length)target.innerHTML='<p class="muted text-sm">ยังไม่มีธุรกรรม</p>';
      }catch(e){toast(errorText(e),true);}finally{button.disabled=false;}
    };
    $('loadHistoryBtn').addEventListener('click',()=>{ $('loadHistoryBtn').classList.add('hidden');loadHistory(); });
    $('moreHistoryBtn').addEventListener('click',loadHistory);
  } catch(e) { console.error(e);$('detailContent').textContent='อ่านรายละเอียดไม่สำเร็จ: '+errorText(e); }
}
document.addEventListener('DOMContentLoaded',()=>{
  $('connectBtn').addEventListener('click',connect);
  $('refreshBtn').addEventListener('click',loadCampaigns);
  $('openCreateBtn').addEventListener('click',()=>{if(!requireWallet())return;$('createDialog').showModal();});
  $('addMilestone').addEventListener('click',()=>addMilestoneField());
  $('createForm').addEventListener('submit',createCampaign);
  $('filterAll').addEventListener('click',()=>{filtered='all';updateFilter();render();});
  $('filterMine').addEventListener('click',()=>{filtered='mine';updateFilter();render();});
  document.addEventListener('click',event=>{
    const close=event.target.closest('[data-close]');
    if(close)$(close.dataset.close).close();
    const open=event.target.closest('[data-open-id]');
    if(open)openDetails(Number(open.dataset.openId));
  });
  $('detailDialog').addEventListener('close',()=>{detailId=null;});
  addMilestoneField('',60); addMilestoneField('',40);
  window.ethereum?.on?.('accountsChanged',syncWallet);
  window.ethereum?.on?.('chainChanged',syncWallet);
  init();
});

# InnovateFund — Crowdfunding Milestone Frontend

Frontend สำหรับ Smart Contract `CrowdfundingMilestone.sol` ที่ผู้ใช้แนบมา ใช้ **HTML + Tailwind CSS (CDN) + Vanilla JavaScript + ethers.js v6** ไม่ต้องติดตั้ง React หรือมีระบบ Build และใช้ไฟล์ **LINE Seed Sans TH** ในเครื่อง (local font)

> **เครือข่าย:** Ethereum Sepolia Testnet เท่านั้น ตัวอย่างนี้เป็นโปรเจกต์เพื่อการศึกษา ไม่ได้ตรวจสอบความปลอดภัย Smart Contract สำหรับใช้งานจริง

## ไฟล์ในโปรเจกต์

```text
innovatefund-frontend/
├── index.html                    # UI, Tailwind CDN, @font-face
├── app.js                        # ethers.js, MetaMask, ฟังก์ชัน Blockchain
├── config.js                     # Contract Address และ Sepolia RPC
├── CrowdfundingMilestone.sol     # Smart Contract ต้นฉบับ
├── assets/
│   └── fonts/
│       └── LINESeedSansTH_W_Rg.woff2
└── README.md
```

## 1. Deploy Smart Contract

1. เปิด [Remix IDE](https://remix.ethereum.org/) และนำไฟล์ `CrowdfundingMilestone.sol` ไป Compile ด้วย Solidity `0.8.26` หรือรุ่นที่รองรับ `^0.8.26`
2. เปิด MetaMask เลือก **Sepolia Testnet** และตรวจสอบว่ามี Sepolia ETH สำหรับค่า Gas
3. ใน Remix เลือก `Deploy & Run Transactions` > `Injected Provider - MetaMask` แล้ว Deploy
4. คัดลอก **Deployed Contract Address** (รูปแบบ `0x...`) หลัง Deploy สำเร็จ

**หมายเหตุ:** Deploy ตัว Contract ที่แนบมาโดยตรงได้เลย ไม่ต้องใส่ Constructor Arguments

## 2. ตั้งค่า Frontend

เปิด `config.js` และใส่ที่อยู่ Contract จริง:

```js
window.APP_CONFIG = {
  CONTRACT_ADDRESS: "0xYOUR_DEPLOYED_CONTRACT_ADDRESS",
  CHAIN_ID: 11155111,
  CHAIN_NAME: "Sepolia",
  RPC_URL: "https://ethereum-sepolia-rpc.publicnode.com",
  EXPLORER_URL: "https://sepolia.etherscan.io",
};
```

- `CONTRACT_ADDRESS` คือ **ที่อยู่ Smart Contract** ไม่ใช่ Wallet Address
- `RPC_URL` สำหรับอ่านข้อมูลสาธารณะโดยยังไม่เชื่อม Wallet ใช้ Sepolia RPC ที่กำหนดไว้หรือเปลี่ยนเป็น Endpoint ที่คุณมีสิทธิ์ใช้
- หากใช้ Infura แทน Public RPC ให้ใส่ Sepolia endpoint เช่น `https://sepolia.infura.io/v3/YOUR_PROJECT_ID` ใน `RPC_URL` (Project ID ใน frontend จะมองเห็นได้ จึงควรกำหนดการจำกัดการใช้งานในผู้ให้บริการ และไม่ใส่ secret)
- **ห้ามใส่ Private Key, Secret Key, Seed Phrase ใน `config.js`, `app.js` หรือ frontend**; การเซ็นธุรกรรมทำผ่าน MetaMask เท่านั้น

## 3. รันบนเครื่อง

ใช้ Local HTTP server เพื่อโหลด JS และ local font ตามปกติ เช่น:

```bash
# เข้าไปในโฟลเดอร์โปรเจกต์
cd innovatefund-frontend

# ใช้ Python (ถ้ามี)
python -m http.server 5500
```

จากนั้นเปิด `http://localhost:5500` ใน Browser ที่ติดตั้ง MetaMask

หรือใช้ VS Code extension **Live Server** เปิด `index.html` ก็ได้

**ต้องเชื่อมต่ออินเทอร์เน็ต** เพื่อโหลด Tailwind CDN, ethers.js CDN และ RPC ของ Sepolia ส่วนฟอนต์โหลดจากโฟลเดอร์ `assets/fonts/` โดยตรง

## 4. ความสามารถ

| ความสามารถ | Smart Contract |
| --- | --- |
| แสดงรายชื่อและยอดโครงการ | `campaignCount`, `getCampaign` |
| สร้างโครงการใหม่ / แบ่ง Milestone รวม 100% | `createCampaign` |
| สนับสนุนโครงการด้วย Sepolia ETH | `contribute` |
| แสดงรายการ Milestone / หลักฐาน / คะแนนโหวต | `getMilestone` |
| เจ้าของโครงการส่งหลักฐานเพื่อขออนุมัติ | `requestRelease` |
| ผู้สนับสนุนลงคะแนนเห็นด้วย/ไม่เห็นด้วย | `vote` |
| ปิดการโหวตที่หมดเวลา | `finalizeVoting` |
| คืนเงินถ้าไม่ถึงเป้าเมื่อหมดเขต | `refund` |
| แสดงยอดเงินสนับสนุนของ Wallet | `getContribution` |
| ดูประวัติการสนับสนุน คืนเงิน จ่าย Milestone ย้อนหลัง (โหลดครั้งละ 10) | `getHistoryLength`, `getHistory` |

## 5. ลำดับการใช้งานตัวอย่าง

1. กด **เชื่อมต่อ MetaMask** แล้วยืนยันการเชื่อมต่อและสลับเป็น Sepolia (หากจำเป็น)
2. กด **สร้างโครงการ** ระบุเป้าหมาย ETH, ระยะเวลาระดมทุน และ Milestones (รวมกัน 100%)
3. ใช้ Wallet อีกบัญชีสนับสนุนโครงการก่อนหมดเขต; เจ้าของโครงการสนับสนุนของตัวเองไม่ได้
4. เมื่อหมดเขตและถึงเป้าหมาย เจ้าของโครงการส่งหลักฐาน Milestone ปัจจุบัน
5. ผู้สนับสนุนโหวตโดยมีน้ำหนักตาม ETH ที่สนับสนุน: คะแนนอนุมัติต้อง **มากกว่า 50% ของยอดระดมทุนทั้งหมด** ระบบจ่ายเงินให้เจ้าของโครงการโดยอัตโนมัติเมื่อผ่านเกณฑ์
6. หากเสียงไม่เห็นด้วย **ตั้งแต่ 50% ขึ้นไป** จะไม่ผ่านทันที หรือใครก็ได้กดปิดโหวตหลังครบ 7 วันเพื่อให้ไม่ผ่านเมื่อยังไม่อนุมัติ เจ้าของสามารถส่งหลักฐานใหม่เพื่อขอโหวตรอบใหม่ได้
7. ถ้าหมดระยะระดมทุนแต่ **ไม่ถึงเป้าหมาย** ผู้สนับสนุนแต่ละคนกดคืนเงินของตัวเองได้

## 6. ข้อจำกัดที่ควรทราบ

- `getCampaign()` คืนค่า `contractBalanceForCampaign = totalRaised - totalPaid` ซึ่งเป็น **ยอดตามบัญชีใน Contract** และไม่หักเงินที่ Refund ไปแล้ว ดังนั้นในแคมเปญที่ไม่ถึงเป้า ยอดนี้อาจไม่ตรงกับยอดคงเหลือ ETH จริงหลัง Refund; Frontend จึงใช้คำว่า “คงเหลือตามบัญชี”
- `getContribution()` ไม่ได้บอกว่า Wallet นั้นเคยโหวตในรอบปัจจุบันแล้วหรือไม่; หากกดโหวตซ้ำ Smart Contract จะ Revert ด้วย `Already voted`
- Contract ไม่มี Getter สำหรับ `round`, `votedInRound` และไม่มีชื่อ/รายละเอียดนอกเหนือจาก `title` ของโครงการ
- History ที่อยู่ใน `getHistory` มี **Contribution, Refund, MilestonePayout** แต่ไม่มีรายการโหวตแต่ละครั้ง; คะแนนโหวตสรุปอยู่ใน `getMilestone()`
- รายชื่อโครงการทั้งหมดโหลดแบบ batch; ถ้าเริ่มมีโครงการจำนวนมากควรใช้ indexing service หรือ pagination ฝั่งข้อมูล
- Tailwind Play CDN เหมาะกับ demo/การเรียนรู้ ไม่แนะนำ production; สำหรับ production ให้ build Tailwind CSS เป็นไฟล์ static
- Backend ไม่จำเป็นสำหรับ demo นี้; การเขียนใช้ MetaMask และการอ่านข้อมูลใช้ Public RPC
- ข้อมูลที่กรอกและธุรกรรมบนบล็อกเชนแก้ไขย้อนหลังไม่ได้ ตรวจสอบให้แน่ใจก่อนยืนยันใน MetaMask

## 7. Troubleshooting

**กด Connect แล้วไม่สำเร็จ:** ใช้เบราว์เซอร์ที่ติดตั้ง MetaMask เปิด HTTP localhost แทน `file://`; ตรวจสอบ permission ของเว็บไซต์/บัญชีที่เลือก และเครือข่าย Sepolia

**หน้าไม่แสดงโครงการ:** เช็ก `CONTRACT_ADDRESS`, เครือข่ายที่ Deploy, `RPC_URL` และเปิด DevTools Console เพื่อดูรายละเอียด

**Transaction Reverted:** ตรวจสอบเงื่อนไขใน `CrowdfundingMilestone.sol` เช่น หมดเวลาระดมทุนแล้วหรือไม่, ยอดถึงเป้าหมายหรือยัง, เป็นเจ้าของโครงการหรือผู้สนับสนุนตามที่กำหนดหรือไม่

**ฟอนต์ไม่ขึ้น:** ตรวจสอบว่าไฟล์ `assets/fonts/LINESeedSansTH_W_Rg.woff2` อยู่ครบและเข้าเว็บผ่าน Local Server

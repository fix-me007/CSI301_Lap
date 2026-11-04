# SmartLiving — Week 11 Property Rental dApp

Frontend สำหรับ `smart-contact/SmartPropertyRental.sol` (LAP 11 โจทย์ที่ 4) ทำด้วย **HTML + Tailwind CSS Play CDN + JavaScript + ethers.js v6** ใช้ฟอนต์ **LINE Seed Sans TH** จากไฟล์ในโฟลเดอร์ `week11` ไม่ต้องติดตั้ง package หรือ build project

> ใช้ **Ethereum Sepolia Testnet** สำหรับการศึกษาเท่านั้น ไม่ใช้เงินจริง และไม่ควรนำ smart contract นี้ไปใช้กับทรัพย์สิน/เงินประกันจริงโดยไม่มีการตรวจสอบความปลอดภัย

## โครงสร้างไฟล์

```text
week11/
├── index.html                         หน้าเว็บและ Tailwind CSS
├── app.js                             เชื่อม MetaMask, อ่านและเขียน contract
├── config.js                          ที่อยู่ contract และ Sepolia RPC
├── LINESeedSansTH_W_Rg.woff2          ฟอนต์ local
├── smart-contact/
│   └── SmartPropertyRental.sol        Solidity smart contract
└── README.md
```

## เริ่มใช้งาน

1. เปิด [Remix IDE](https://remix.ethereum.org/) แล้วนำ `smart-contact/SmartPropertyRental.sol` ไป compile ด้วย Solidity รุ่นที่รองรับ `^0.8.20` เช่น 0.8.20 หรือใหม่กว่าในสาย 0.8.x
2. ใน Remix เลือก **Deploy & Run Transactions → Injected Provider - MetaMask** เลือกเครือข่าย **Sepolia** และ deploy (constructor ไม่ต้องรับ argument) บัญชีที่ deploy จะกลายเป็น **arbitrator / ผู้ตัดสินข้อพิพาท** โดยอัตโนมัติ
3. นำ **address ของ contract ที่ deploy** (ไม่ใช่ address ของ Wallet) ไปใส่ `CONTRACT_ADDRESS` ใน `week11/config.js`:

   ```js
   window.APP_CONFIG = {
     CONTRACT_ADDRESS: '0xYOUR_DEPLOYED_CONTRACT_ADDRESS',
     CHAIN_ID: 11155111,
     RPC_URL: 'https://ethereum-sepolia-rpc.publicnode.com',
     EXPLORER_URL: 'https://sepolia.etherscan.io'
   };
   ```

4. ในโฟลเดอร์ `week11` เริ่ม local HTTP server เช่น:

   ```bash
   cd week11
   python -m http.server 5500
   ```

5. เปิด `http://localhost:5500` ในเบราว์เซอร์ที่มี MetaMask (หรือใช้ VS Code Live Server) ต้องมีอินเทอร์เน็ตสำหรับ Tailwind CDN, ethers.js CDN และ Sepolia RPC; **ฟอนต์โหลดจากไฟล์ local**
6. Wallet ที่ทำธุรกรรมต้องมี Sepolia ETH สำหรับค่า gas รวมถึงค่าเช่า/เงินประกันที่จ่าย ทดสอบโดยแยกบัญชีเจ้าของห้อง ผู้เช่า และบัญชี deploy ที่เป็น arbitrator

**ห้ามใส่ private key หรือ seed phrase ใน `config.js`, HTML หรือ JavaScript** การเซ็นธุรกรรมใช้ MetaMask เท่านั้น ผู้ชมทั่วไปยังสามารถอ่านข้อมูลสัญญาจาก Public RPC โดยไม่เชื่อม Wallet ได้

## ฟังก์ชันที่รองรับ

| บทบาท | การทำงานบนหน้าเว็บ | ฟังก์ชันของ contract |
| --- | --- | --- |
| ทุกคน | ดูทรัพย์สิน สัญญา สถานะ เงื่อนไข ยอด ETH ใน contract และประวัติชำระค่าเช่า | `propertyCount`, `getProperty`, `agreementCount`, `getAgreement`, `contractBalance`, `getPayments` |
| เจ้าของห้อง | ลงทะเบียนทรัพย์สิน กำหนดค่าเช่า/เงินประกัน | `registerProperty` |
| เจ้าของห้อง | สร้างสัญญาเช่า ระบุผู้เช่า วันเริ่ม/สิ้นสุด และเงื่อนไข | `createAgreement` |
| เจ้าของห้องและผู้เช่า | ยืนยัน หรือยกเลิกสัญญาก่อนฝากเงินประกัน | `confirmAgreement`, `cancelAgreement` |
| ผู้เช่า | ฝากเงินประกันตามยอดที่ตกลงเมื่อทั้งสองฝ่ายยืนยันแล้ว | `depositSecurity` |
| ผู้เช่า | จ่ายค่าเช่างวดถัดไปตามยอดที่ contract กำหนด | `payRent` |
| เจ้าของห้อง | เมื่อสิ้นสุดสัญญา ตรวจห้องและคืนเงินเต็มจำนวน หรือเสนอหักเงินพร้อมเหตุผล | `inspectAndPropose` |
| ผู้เช่า | ยอมรับยอดหัก หรือยื่นข้อพิพาท | `approveDeduction`, `raiseDispute` |
| ผู้ตัดสิน (บัญชี deploy) | กำหนดยอดหักที่อนุมัติและระบุผลตัดสิน | `resolveDispute` |

ปุ่มทำรายการจะแสดงตาม **สถานะสัญญา** และ **Wallet ที่เชื่อมต่อ** ข้อมูล ETH แสดงตามค่าที่เก็บจริงใน wei โดยไม่ปัดเศษก่อนให้ผู้ใช้ตรวจสอบ การส่งธุรกรรมจะแจ้งให้ยืนยันใน MetaMask แล้วรีเฟรชข้อมูลหลัง transaction ถูกยืนยัน

## ลำดับทดสอบตัวอย่าง

1. บัญชี **เจ้าของห้อง** เชื่อม Wallet แล้วลงทะเบียนทรัพย์สิน (ค่าเช่าและเงินประกันต้องมากกว่า 0 ETH)
2. เจ้าของห้องกด **สร้างสัญญาเช่า** ใส่ address ผู้เช่าที่ไม่ใช่ตัวเอง วันเริ่มต้องไม่อยู่ในอดีต วันสิ้นสุดต้องหลังวันเริ่ม และกรอกเงื่อนไข
3. เจ้าของห้องและ **ผู้เช่า** สลับ Wallet มายืนยันสัญญาคนละครั้ง (ทั้งสองฝ่ายยกเลิกได้เฉพาะก่อนฝากเงินประกัน)
4. ผู้เช่ากด **ฝากเงินประกัน** ด้วยยอดที่ contract กำหนดแบบพอดี สถานะจะเปลี่ยนเป็น `Active` / กำลังเช่า
5. ผู้เช่ากด **จ่ายค่าเช่า** ตามจำนวนงวดที่ต้องจ่าย เงินค่าเช่าส่งถึงเจ้าของห้องทันทีและ **ไม่หักจากเงินประกัน**
6. หลังเวลาสิ้นสุดสัญญา เจ้าของห้องเลือก:
   - หัก `0` ETH → คืนเงินประกันให้ผู้เช่าทั้งหมดทันที และปิดสัญญา
   - หักมากกว่า `0` ETH → ระบุเหตุผล รอผู้เช่า **ยอมรับ** (แบ่งยอดหักให้เจ้าของห้องและคืนส่วนที่เหลือ) หรือ **ยื่นข้อพิพาท**
7. หากมีข้อพิพาท บัญชีที่ deploy contract (arbitrator) ระบุผลตัดสินและยอดหักที่อนุมัติ ระบบจ่ายเงินแล้วปิดสัญญา

## ข้อควรทราบจาก Smart Contract

- ค่าเช่า 1 งวดเท่ากับ 30 วัน จำนวนงวดคำนวณจากระยะสัญญาและ **ปัดขึ้น** แต่ `payRent` ไม่ตรวจวันครบกำหนด สามารถจ่ายล่วงหน้าได้ และการปิดสัญญา **ไม่ได้บังคับให้จ่ายครบทุกงวด**
- `createAgreement` ยังไม่ได้จองทรัพย์สินในสถานะ `Created`; เจ้าของห้องจึงอาจสร้างสัญญารอหลายรายการสำหรับทรัพย์สินเดียวกัน และ `depositSecurity` ไม่ตรวจ `isRented` ซ้ำ ควรหลีกเลี่ยงการทำสัญญาทับซ้อนด้วยตัวเอง
- Contract นี้ไม่มีฟังก์ชันแก้ชื่อ/ราคา/สถานะ `isActive` ของทรัพย์สินหลังลงทะเบียน และไม่มีวิธีแก้ข้อตกลงหรือขยายเวลาสัญญา
- ยอดหักต้องไม่เกิน `depositBalance` และต้องระบุเหตุผลเมื่อเสนอหัก ส่วนผู้ตัดสินกำหนดยอดหักใหม่ได้ไม่เกินยอดคงเหลือ เมื่อปิดสัญญา `proposedDeduction` จะถูกล้างเป็น 0 แต่ `deductionReason` และ `disputeResolution` ยังอ่านย้อนหลังได้
- หน้าเว็บอ่านประวัติ **ค่าเช่า** จาก `getPayments` เท่านั้น ไม่มี getter สำหรับประวัติการคืนเงินประกันโดยตรง หากต้องการตรวจยอดที่จ่ายจริงให้ดู Event `DepositRefunded` ใน block explorer
- รายการทรัพย์สินและสัญญาอ่านจาก getter ทีละชุดผ่าน RPC เหมาะกับงาน lab; contract ที่มีรายการจำนวนมากควรใช้ pagination หรือ indexer
- Tailwind Play CDN ใช้สำหรับ demo ไม่ใช่ชุด build สำหรับ production; สถานะ transaction จริงให้ตรวจสอบใน MetaMask / Sepolia Etherscan

## แก้ปัญหาเบื้องต้น

- **ขึ้นข้อความให้ตั้งค่า address:** ตรวจ `CONTRACT_ADDRESS` ใน `config.js` ว่าเป็น contract ที่ deploy บน Sepolia จริง
- **อ่านข้อมูลไม่ได้:** ตรวจ `RPC_URL`, อินเทอร์เน็ต, Sepolia network, และดู DevTools Console; public RPC อาจ rate-limit ให้เปลี่ยนไปใช้ endpoint ที่มีสิทธิ์ใช้
- **ทำรายการไม่ได้:** ตรวจ Wallet/เครือข่าย/บทบาท/สถานะ, จำนวน Sepolia ETH และ gas; หาก MetaMask ปฏิเสธ transaction ให้ตรวจเงื่อนไขใน Solidity
- **ฟอนต์ไม่แสดง:** ตรวจไฟล์ `LINESeedSansTH_W_Rg.woff2` ในโฟลเดอร์ `week11` และเปิดผ่าน local server

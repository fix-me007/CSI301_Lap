# Bank dApp (Sepolia)

เว็บไซต์สำหรับฝาก/ถอน SepoliaETH ตรวจสอบยอดเงิน และดูประวัติธุรกรรมของ Bank Smart Contract บน Ethereum Sepolia Testnet โดยใช้ **Infura RPC และ ethers.js v6** ในการเชื่อมต่อ Blockchain

โปรเจกต์นี้ใช้ Private Key ของบัญชี Demo ในการเซ็นและส่งธุรกรรมโดยตรงผ่าน Infura โดยไม่จำเป็นต้องเชื่อมต่อ MetaMask หรือใช้ Backend Server

> **หมายเหตุ:** โปรเจกต์นี้จัดทำขึ้นเพื่อการศึกษาและทดสอบการทำงานของ Smart Contract บน Sepolia Testnet เท่านั้น ไม่เหมาะสำหรับนำไปใช้งานจริง (Production)

## Tech Stack

- **Frontend:** HTML5, Tailwind CSS, JavaScript
- **Blockchain Library:** ethers.js v6
- **Blockchain Network:** Ethereum Sepolia Testnet
- **RPC Provider:** Infura
- **Smart Contract:** Solidity
- **Font:** LINE Seed Sans TH

## Project Structure

```text
bank-dapp/
├── index.html                  # หน้าเว็บและ JavaScript ทั้งหมด
├── LINESeedSansTH_W_Rg.woff2   # ฟอนต์ LINE Seed Sans TH
└── README.md                   # เอกสารโปรเจกต์
```

## Getting Started

### 1. Requirements

ก่อนเริ่มใช้งาน ต้องมี:

- Infura API Key สำหรับ Ethereum Sepolia
- Private Key ของบัญชี Demo
- SepoliaETH ใน Wallet สำหรับทดสอบธุรกรรมและชำระ Gas Fee
- Smart Contract ที่ Deploy บน Sepolia แล้ว

### 2. Configure Infura and Private Key

เปิดไฟล์ `index.html` แล้วกำหนดค่าตัวแปรดังนี้:

```javascript
const INFURA_URL =
  "https://sepolia.infura.io/v3/YOUR_INFURA_API_KEY";

const PRIVATE_KEY = "YOUR_DEMO_PRIVATE_KEY";

const CONTRACT_ADDRESS =
  "0x0105D592faC474ddcBb5bBB07f201961392436a4";
```

เปลี่ยน `YOUR_INFURA_API_KEY` และ `YOUR_DEMO_PRIVATE_KEY` เป็นค่าของบัญชีทดสอบ

**ข้อควรระวัง:** เนื่องจาก Private Key ถูกกำหนดไว้ใน JavaScript ฝั่ง Client จึงสามารถมองเห็นได้จาก Source Code ต้องใช้เฉพาะบัญชี Demo ที่ไม่มีสินทรัพย์จริง และไม่ควรเผยแพร่ไฟล์ที่มี Private Key

### 3. Run Application

เปิดโปรเจกต์ผ่าน Local HTTP Server เช่น Python:

```bash
python -m http.server 8000
```

จากนั้นเปิด Browser:

```text
http://localhost:8000
```

สามารถใช้ VS Code Live Server แทนได้เช่นกัน

### 4. Using the dApp

1. เปิดหน้าเว็บไซต์ ระบบจะเชื่อมต่อ Infura RPC และสร้าง Wallet จาก Private Key ที่ตั้งค่าไว้
2. ตรวจสอบ Wallet Address และยอดเงินที่ฝากไว้ใน Smart Contract
3. กรอกจำนวน SepoliaETH ที่ต้องการฝากหรือถอน
4. กด **Deposit ETH** หรือ **Withdraw ETH**
5. ระบบจะเซ็นและส่ง Transaction ไปยัง Sepolia โดยตรง
6. เมื่อ Transaction สำเร็จ สามารถดูรายละเอียดและประวัติผ่าน Sepolia Etherscan

## Configuration

| Variable | Description |
|---|---|
| `INFURA_URL` | RPC Endpoint สำหรับเชื่อมต่อ Ethereum Sepolia ผ่าน Infura |
| `PRIVATE_KEY` | Private Key ของบัญชี Demo สำหรับเซ็นธุรกรรม |
| `CONTRACT_ADDRESS` | Address ของ Bank Smart Contract บน Sepolia |
| `CONTRACT_ABI` | ABI ของฟังก์ชันและ Events ที่ Frontend เรียกใช้งาน |
| `DEPLOY_BLOCK` | Block ที่ Deploy Contract เพื่อเริ่มค้นหาประวัติธุรกรรมย้อนหลัง |
| `MAX_FALLBACK_BLOCKS` | จำนวน Block สูงสุดที่ใช้ค้นหาประวัติย้อนหลังเมื่อ RPC จำกัดช่วง |

## Features

- **Direct Wallet Signing:** ใช้ Private Key ของบัญชี Demo โดยตรง ไม่ต้องเชื่อมต่อ MetaMask
- **Deposit ETH:** ฝาก SepoliaETH เข้า Bank Smart Contract
- **Withdraw ETH:** ถอน SepoliaETH ตามยอดคงเหลือของ Wallet ใน Contract
- **Check Balance:** ตรวจสอบยอดเงินที่ฝากไว้ใน Smart Contract
- **Latest Block:** แสดงหมายเลข Block ล่าสุดของ Sepolia
- **Transaction History:** แสดงประวัติการฝากและถอนผ่าน Smart Contract Events
- **History Filtering:** เลือกดูรายการล่าสุด ประวัติทั้งหมด หรือกรองเฉพาะฝาก/ถอน
- **Transaction Summary:** แสดงยอดฝากรวม ยอดถอนรวม และจำนวนธุรกรรม
- **Etherscan Integration:** เปิดรายละเอียด Transaction บน Sepolia Etherscan
- **RPC Retry:** รองรับการลองอ่านข้อมูลใหม่และแบ่งช่วง Block เมื่อ Infura จำกัดคำขอ

## How It Works

```text
HTML + JavaScript
       |
       v
ethers.js v6
       |
       v
Wallet (Demo Private Key)
       |
       v
Infura RPC Provider
       |
       v
Ethereum Sepolia Testnet
       |
       v
Bank Smart Contract
```

ระบบใช้ `ethers.Wallet` เพื่อเซ็นธุรกรรมด้วย Private Key และ `ethers.JsonRpcProvider` เพื่อสื่อสารกับ Ethereum Sepolia ผ่าน Infura

การอ่านข้อมูล เช่น ยอดเงินและประวัติธุรกรรม สามารถทำได้โดยไม่ต้องเซ็น Transaction ส่วนการฝากและถอนจะต้องเซ็นก่อนส่งไปยัง Blockchain

## Transaction History

ประวัติธุรกรรมอ่านจาก Events ของ Smart Contract ได้แก่:

- `Deposit(address indexed owner, uint256 amount)`
- `Withdraw(address indexed owner, uint256 amount)`

ระบบจะแสดงเฉพาะธุรกรรมของ Wallet Address ที่กำหนดไว้ผ่าน Private Key

หากต้องการดึงประวัติย้อนหลังครบตั้งแต่เริ่ม Deploy Contract ควรกำหนด `DEPLOY_BLOCK` เป็นหมายเลข Block ที่ Deploy จริง เพื่อลดจำนวนคำขอและหลีกเลี่ยงข้อจำกัดของ Infura RPC

## Limitations

- รองรับเฉพาะ Ethereum Sepolia Testnet
- ใช้บัญชี Demo ที่กำหนดไว้ใน Source Code
- ไม่เหมาะสำหรับ Production เนื่องจาก Private Key อยู่ฝั่ง Client
- การดึงประวัติย้อนหลังอาจถูกจำกัดตามข้อกำหนดของ Infura RPC
- ต้องมี SepoliaETH เพียงพอสำหรับ Transaction และ Gas Fee

## References

- [Infura](https://developer.metamask.io/)
- [ethers.js Documentation](https://docs.ethers.org/v6/)
- [Ethereum Sepolia Etherscan](https://sepolia.etherscan.io/)
- [Solidity Documentation](https://docs.soliditylang.org/)
# Bank dApp (Sepolia)

หน้าเว็บ frontend สำหรับฝาก/ถอน ETH และดูประวัติธุรกรรมของ Bank Smart Contract บน Sepolia testnet

## ไฟล์ในโปรเจกต์

```
index.html                  # หน้าเว็บทั้งหมด (HTML + JS)
LINESeedSansTH_W_Rg.woff2   # ฟอนต์ LINE Seed Sans TH
```

## วิธีใช้

1. ติดตั้ง [MetaMask](https://metamask.io/) และมี Sepolia test ETH
2. เปิดผ่าน [MetaMask] (แนะนำ เพราะ MetaMask ทำงานได้ไม่เสถียรกับ `file://`)
   ```bash
   python3 -m http.server 8000
   ```
   แล้วเปิด http://localhost:8000
3. กด **Connect Wallet** (ระบบจะสลับเป็น Sepolia ให้เอง)
4. ฝาก/ถอนได้ตามปกติ ประวัติจะอัปเดตหลัง transaction สำเร็จ

## ตั้งค่าใน `index.html`

| ตัวแปร | ความหมาย |
| --- | --- |
| `CONTRACT_ADDRESS` | Address ของ Bank Contract ที่ deploy บน Sepolia |
| `CONTRACT_ABI` | ต้องมี `deposit`, `withdraw`, `checkBalance` และ event `Deposit`/`Withdraw` (`owner` เป็น indexed) |
| `DEPLOY_BLOCK` | เลข block ที่ deploy contract ใส่แล้วดึงประวัติย้อนหลังได้ครบและเร็วขึ้น (ค่าเริ่มต้น `0`) |
| `MAX_FALLBACK_BLOCKS` | เพดานจำนวน block ที่สแกนย้อนหลัง กรณี RPC จำกัดช่วงการดึง log |

## ฟีเจอร์

- เชื่อมต่อ MetaMask ครั้งเดียว ไม่ reload หน้าเมื่อสลับ network หรือ account
- เชื่อมต่ออัตโนมัติถ้าเคยอนุญาตเว็บนี้แล้ว
- ดูยอดคงเหลือใน contract และ latest block
- ประวัติธุรกรรม: รายการล่าสุด / ทั้งหมด, กรองฝาก/ถอน, ยอดฝาก-ถอนรวม, ลิงก์ Etherscan
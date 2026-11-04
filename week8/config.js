// Deploy smart-contact/FreelanceEscrow.sol บน Ethereum Sepolia แล้วใส่ address ที่นี่
// ห้ามใส่ private key หรือ seed phrase ใน frontend
// เก็บ address เดิมไว้เป็นข้อมูลอ้างอิง: ต้อง deploy โค้ด CONTRACT_VERSION = 2 แล้วเปลี่ยน address
// หน้าเว็บจะปฏิเสธ contract เก่าที่ไม่มี version นี้ เพราะยังมีเส้นทางคืนเงินโดยตรง
window.APP_CONFIG = {
  CONTRACT_ADDRESS: '0xA8585d49caf27462976036da8d0DDd9173ef053F',
  CHAIN_ID: 11155111,
  RPC_URL: 'https://ethereum-sepolia-rpc.publicnode.com',
  EXPLORER_URL: 'https://sepolia.etherscan.io',
  DEPLOY_BLOCK: 0, // ใส่ block ที่ deploy เพื่อให้ค้นหา Events ได้ครบและเร็วขึ้น
  MAX_LOG_BLOCKS: 10000, // จำกัดช่วงค้นหาย้อนหลังต่อครั้ง ไม่ใช่ประวัติเงินทั้งหมด
  LOG_CHUNK_SIZE: 1000
};

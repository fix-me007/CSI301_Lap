// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * LAB 10 - โจทย์ที่ 3
 * ระบบออกและตรวจสอบใบรับรองดิจิทัล (Blockchain Digital Certificate Verification System)
 * SkillTrust Academy
 *
 * หลักการสำคัญ:
 *  - ไม่เก็บข้อมูลส่วนบุคคล (ชื่อ-นามสกุล ฯลฯ) บน Blockchain
 *    เก็บเฉพาะ "Hash" ของเอกสาร + wallet address ของผู้รับ
 *  - Hash คำนวณนอก Blockchain (off-chain) จากข้อมูลใบรับรอง/ไฟล์ PDF (ควรใส่ salt)
 *  - ใบรับรองทุกใบมีรหัส (certId) ไม่ซ้ำกัน
 *  - เฉพาะ Admin / Issuer ที่ได้รับสิทธิ์เท่านั้นที่ออกหรือเพิกถอนได้
 *  - การเพิกถอนไม่ลบข้อมูล แต่ตั้งสถานะ revoked เพื่อเก็บประวัติไว้
 */
contract DigitalCertificate {
    // ---------------------------------------------------------------
    // 1) Data Structures
    // ---------------------------------------------------------------
    struct Course {
        string courseId;      // รหัสหลักสูตร เช่น "AI-101"
        string name;          // ชื่อหลักสูตร
        string description;   // รายละเอียดการอบรม
        uint256 durationHours;// จำนวนชั่วโมงอบรม
        uint256 createdAt;
        bool active;          // เปิดให้ออกใบรับรองได้หรือไม่
        bool exists;
    }

    struct Certificate {
        string certId;        // รหัสอ้างอิงใบรับรอง (ใช้ใน QR Code)
        string courseId;      // หลักสูตรที่เกี่ยวข้อง
        address recipient;    // wallet ของผู้รับ (ไม่ใช่ข้อมูลระบุตัวตนโดยตรง)
        bytes32 certHash;     // Hash ของเอกสารใบรับรอง
        uint256 issuedAt;     // วันที่ออก (block timestamp)
        address issuer;       // ผู้ออกใบรับรอง
        bool revoked;         // ถูกเพิกถอนหรือไม่
        uint256 revokedAt;
        string revokeReason;
        bool exists;
    }

    // ---------------------------------------------------------------
    // 2) State
    // ---------------------------------------------------------------
    address public admin;

    mapping(address => bool) public isIssuer;

    mapping(string => Course) private courses;
    string[] private courseIds;

    mapping(string => Certificate) private certificates;
    mapping(bytes32 => bool) private hashUsed;                 // กัน hash ซ้ำ
    mapping(address => string[]) private holderCertIds;        // Dashboard ของผู้เข้าอบรม
    uint256 public totalCertificates;

    // ---------------------------------------------------------------
    // 3) Events
    // ---------------------------------------------------------------
    event AdminTransferred(address indexed oldAdmin, address indexed newAdmin);
    event IssuerAdded(address indexed issuer);
    event IssuerRemoved(address indexed issuer);
    event CourseCreated(string courseId, string name, uint256 durationHours);
    event CourseStatusChanged(string courseId, bool active);
    event CertificateIssued(
        string certId,
        string courseId,
        address indexed recipient,
        bytes32 certHash,
        address indexed issuer,
        uint256 issuedAt
    );
    event CertificateRevoked(string certId, address indexed revokedBy, string reason, uint256 revokedAt);

    // ---------------------------------------------------------------
    // 4) Modifiers (ควบคุมสิทธิ์)
    // ---------------------------------------------------------------
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }

    modifier onlyIssuer() {
        require(isIssuer[msg.sender], "Only authorized issuer");
        _;
    }

    constructor() {
        admin = msg.sender;
        isIssuer[msg.sender] = true; // admin เป็นผู้ออกใบรับรองได้ด้วย
        emit AdminTransferred(address(0), msg.sender);
        emit IssuerAdded(msg.sender);
    }

    // ---------------------------------------------------------------
    // 5) จัดการสิทธิ์
    // ---------------------------------------------------------------
    function addIssuer(address account) external onlyAdmin {
        require(account != address(0), "Zero address");
        require(!isIssuer[account], "Already issuer");
        isIssuer[account] = true;
        emit IssuerAdded(account);
    }

    function removeIssuer(address account) external onlyAdmin {
        require(isIssuer[account], "Not issuer");
        require(account != admin, "Cannot remove admin");
        isIssuer[account] = false;
        emit IssuerRemoved(account);
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "Zero address");
        emit AdminTransferred(admin, newAdmin);
        admin = newAdmin;
        isIssuer[newAdmin] = true;
    }

    // ---------------------------------------------------------------
    // 6) Requirement 1: ลงทะเบียนหลักสูตร (Create Training Course)
    // ---------------------------------------------------------------
    function createCourse(
        string calldata courseId,
        string calldata name,
        string calldata description,
        uint256 durationHours
    ) external onlyAdmin {
        require(bytes(courseId).length > 0, "Course id empty");
        require(bytes(name).length > 0, "Course name empty");
        require(!courses[courseId].exists, "Course already exists");

        courses[courseId] = Course({
            courseId: courseId,
            name: name,
            description: description,
            durationHours: durationHours,
            createdAt: block.timestamp,
            active: true,
            exists: true
        });
        courseIds.push(courseId);

        emit CourseCreated(courseId, name, durationHours);
    }

    function setCourseActive(string calldata courseId, bool active) external onlyAdmin {
        require(courses[courseId].exists, "Course not found");
        courses[courseId].active = active;
        emit CourseStatusChanged(courseId, active);
    }

    function getCourse(string calldata courseId) external view returns (Course memory) {
        require(courses[courseId].exists, "Course not found");
        return courses[courseId];
    }

    function getAllCourseIds() external view returns (string[] memory) {
        return courseIds;
    }

    // ---------------------------------------------------------------
    // 7) Requirement 2 + 3: ออกใบรับรอง และบันทึก Hash
    // ---------------------------------------------------------------
    function issueCertificate(
        string calldata certId,
        string calldata courseId,
        address recipient,
        bytes32 certHash
    ) external onlyIssuer {
        require(bytes(certId).length > 0, "Cert id empty");
        require(!certificates[certId].exists, "Cert id already used");   // รหัสห้ามซ้ำ
        require(courses[courseId].exists, "Course not found");
        require(courses[courseId].active, "Course not active");
        require(recipient != address(0), "Invalid recipient");
        require(certHash != bytes32(0), "Empty hash");
        require(!hashUsed[certHash], "Hash already registered");

        certificates[certId] = Certificate({
            certId: certId,
            courseId: courseId,
            recipient: recipient,
            certHash: certHash,
            issuedAt: block.timestamp,
            issuer: msg.sender,
            revoked: false,
            revokedAt: 0,
            revokeReason: "",
            exists: true
        });

        hashUsed[certHash] = true;
        holderCertIds[recipient].push(certId);
        totalCertificates++;

        emit CertificateIssued(certId, courseId, recipient, certHash, msg.sender, block.timestamp);
    }

    // ---------------------------------------------------------------
    // 8) Requirement 4: ตรวจสอบความถูกต้อง (Verify Certificate)
    //    ใครก็เรียกได้ (view = ไม่เสีย gas) - QR Code ให้เก็บ certId
    // ---------------------------------------------------------------

    /// ค้นหาด้วยรหัสใบรับรองอย่างเดียว (ดูสถานะ)
    function getCertificate(string calldata certId) external view returns (Certificate memory) {
        require(certificates[certId].exists, "Certificate not found");
        return certificates[certId];
    }

    /// ตรวจสอบว่าเอกสารที่ถือมา "ไม่ถูกแก้ไข" และ "ยังมีผล"
    /// @return found     มีรหัสนี้ในระบบหรือไม่
    /// @return hashMatch hash ของเอกสารตรงกับที่บันทึกไว้หรือไม่
    /// @return revoked   ถูกเพิกถอนหรือไม่
    /// @return valid     ใช้งานได้จริง (พบ + hash ตรง + ไม่ถูกเพิกถอน)
    function verifyCertificate(string calldata certId, bytes32 documentHash)
        external
        view
        returns (bool found, bool hashMatch, bool revoked, bool valid)
    {
        Certificate storage c = certificates[certId];
        if (!c.exists) {
            return (false, false, false, false);
        }
        found = true;
        hashMatch = (c.certHash == documentHash);
        revoked = c.revoked;
        valid = hashMatch && !c.revoked;
    }

    function getCertificateStatus(string calldata certId)
        external
        view
        returns (string memory status)
    {
        Certificate storage c = certificates[certId];
        if (!c.exists) return "NOT_FOUND";
        if (c.revoked) return "REVOKED";
        return "VALID";
    }

    // ---------------------------------------------------------------
    // 9) Requirement 5: เพิกถอนใบรับรอง (Revoke) - เก็บประวัติไว้
    // ---------------------------------------------------------------
    function revokeCertificate(string calldata certId, string calldata reason) external onlyIssuer {
        Certificate storage c = certificates[certId];
        require(c.exists, "Certificate not found");
        require(!c.revoked, "Already revoked");
        require(bytes(reason).length > 0, "Reason required");

        c.revoked = true;
        c.revokedAt = block.timestamp;
        c.revokeReason = reason;

        emit CertificateRevoked(certId, msg.sender, reason, block.timestamp);
    }

    // ---------------------------------------------------------------
    // 10) Requirement 6: Certificate Dashboard (ผู้เข้าอบรมดูของตัวเอง)
    // ---------------------------------------------------------------
    function getCertificateIdsByHolder(address holder) external view returns (string[] memory) {
        return holderCertIds[holder];
    }

    /// ใช้กับ Wallet ที่เชื่อมต่ออยู่ (msg.sender)
    function getMyCertificates() external view returns (Certificate[] memory) {
        string[] storage ids = holderCertIds[msg.sender];
        Certificate[] memory list = new Certificate[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            list[i] = certificates[ids[i]];
        }
        return list;
    }

    function getCertificatesByHolder(address holder) external view returns (Certificate[] memory) {
        string[] storage ids = holderCertIds[holder];
        Certificate[] memory list = new Certificate[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            list[i] = certificates[ids[i]];
        }
        return list;
    }

    // ---------------------------------------------------------------
    // 11) Helper: คำนวณ hash บน chain เพื่อสาธิตใน Remix
    //     (งานจริงควรคำนวณ off-chain พร้อม salt เพื่อไม่เปิดเผยข้อมูลส่วนบุคคล)
    // ---------------------------------------------------------------
    function computeHash(
        string calldata certId,
        string calldata courseId,
        string calldata holderName,
        string calldata salt
    ) external pure returns (bytes32) {
        return keccak256(abi.encode(certId, courseId, holderName, salt));
    }
}

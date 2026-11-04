// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title FreelanceEscrow
 * @notice LAB 8 - ข้อ 1: ระบบจ้างงานฟรีแลนซ์และชำระเงินตามผลงาน
 *         (Freelance Escrow & Smart Payment Platform) - DigitalWork Solutions
 *
 * Flow:
 *   Created -> Funded -> Submitted -> Approved (จ่ายเงินให้ฟรีแลนซ์)
 *                  \          \
 *                   \----------> Disputed -> Resolved / Refunded (admin ตัดสิน)
 *   เมื่อพ้นกำหนดแต่ยังไม่ส่งงาน ต้องเปิดข้อพิพาทและรอ admin ตัดสิน
 *   เงินออกจาก Escrow ได้เฉพาะ approveAndRelease หรือ resolveDispute เท่านั้น
 */
contract FreelanceEscrow {
    // ---------------------------------------------------------------
    // 1) ประเภทข้อมูล (Types)
    // ---------------------------------------------------------------
    enum Status {
        Created,    // 0 สร้างข้อตกลงแล้ว ยังไม่ฝากเงิน
        Funded,     // 1 ฝากเงินเข้า Escrow แล้ว
        Submitted,  // 2 ฟรีแลนซ์ส่งงานแล้ว รอตรวจรับ
        Approved,   // 3 อนุมัติและจ่ายเงินให้ฟรีแลนซ์แล้ว (จบ)
        Disputed,   // 4 มีข้อพิพาท รอผู้ดูแลตัดสิน
        Resolved,   // 5 ผู้ดูแลตัดสินให้จ่ายเงินแก่ฟรีแลนซ์ (จบ)
        Refunded,   // 6 ผู้ดูแลตัดสินคืนเงินให้ผู้ว่าจ้าง (จบ)
        Cancelled   // 7 ยกเลิกก่อนฝากเงิน (จบ)
    }

    struct Job {
        uint256 id;
        address client;        // ผู้ว่าจ้าง
        address freelancer;    // ฟรีแลนซ์
        string title;          // ชื่อโครงการ
        string description;    // รายละเอียดงาน
        uint256 amount;        // ค่าจ้าง (wei)
        uint256 deadline;      // กำหนดส่ง (unix timestamp)
        string workProof;      // URL หรือ Hash ของผลงาน
        Status status;
        uint256 createdAt;
    }

    // ประวัติการเคลื่อนไหวของเงิน (Payment history)
    struct PaymentRecord {
        uint256 jobId;
        address to;
        uint256 amount;
        string action;         // "DEPOSIT" / "RELEASE" / "REFUND" / "DISPUTE_PAYOUT"
        uint256 timestamp;
    }

    // ---------------------------------------------------------------
    // 2) ตัวแปรสถานะ (State)
    // ---------------------------------------------------------------
    uint256 public constant CONTRACT_VERSION = 2; // รุ่นที่คืนเงินผ่านการตัดสินข้อพิพาทเท่านั้น
    address public immutable admin;   // ผู้ดูแล/อนุญาโตตุลาการ
    uint256 public jobCount;

    mapping(uint256 => Job) private jobs;
    mapping(address => uint256[]) private clientJobs;
    mapping(address => uint256[]) private freelancerJobs;
    mapping(uint256 => PaymentRecord[]) private paymentHistory;

    // ป้องกัน Reentrancy
    bool private locked;

    // ---------------------------------------------------------------
    // 3) Events (ใช้ติดตามสถานะ + Transaction Hash ผ่านหน้าเว็บ)
    // ---------------------------------------------------------------
    event JobCreated(uint256 indexed jobId, address indexed client, address indexed freelancer, uint256 amount, uint256 deadline);
    event PaymentDeposited(uint256 indexed jobId, address indexed client, uint256 amount);
    event WorkSubmitted(uint256 indexed jobId, address indexed freelancer, string workProof);
    event PaymentReleased(uint256 indexed jobId, address indexed freelancer, uint256 amount);
    event DisputeRaised(uint256 indexed jobId, address indexed raisedBy, string reason);
    event DisputeResolved(uint256 indexed jobId, bool paidToFreelancer, uint256 amount);
    event JobCancelled(uint256 indexed jobId);

    // ---------------------------------------------------------------
    // 4) Modifiers
    // ---------------------------------------------------------------
    modifier jobExists(uint256 _jobId) {
        require(_jobId > 0 && _jobId <= jobCount, "Job not found");
        _;
    }

    modifier onlyClient(uint256 _jobId) {
        require(msg.sender == jobs[_jobId].client, "Only client");
        _;
    }

    modifier onlyFreelancer(uint256 _jobId) {
        require(msg.sender == jobs[_jobId].freelancer, "Only freelancer");
        _;
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }

    modifier inStatus(uint256 _jobId, Status _s) {
        require(jobs[_jobId].status == _s, "Invalid job status");
        _;
    }

    modifier nonReentrant() {
        require(!locked, "Reentrancy");
        locked = true;
        _;
        locked = false;
    }

    constructor() {
        admin = msg.sender; // ผู้ deploy คือผู้ดูแล
    }

    // ---------------------------------------------------------------
    // 5) ฟังก์ชันตามโจทย์
    // ---------------------------------------------------------------

    /// @notice (1) สร้างข้อตกลงการจ้างงาน โดยผู้ว่าจ้าง
    function createJob(
        string calldata _title,
        string calldata _description,
        address _freelancer,
        uint256 _amount,
        uint256 _deadline
    ) external returns (uint256 jobId) {
        require(bytes(_title).length > 0, "Title required");
        require(_freelancer != address(0), "Invalid freelancer");
        require(_freelancer != msg.sender, "Client cannot be freelancer");
        require(_amount > 0, "Amount must be > 0");
        require(_deadline > block.timestamp, "Deadline must be in future");

        jobCount++;
        jobId = jobCount;

        jobs[jobId] = Job({
            id: jobId,
            client: msg.sender,
            freelancer: _freelancer,
            title: _title,
            description: _description,
            amount: _amount,
            deadline: _deadline,
            workProof: "",
            status: Status.Created,
            createdAt: block.timestamp
        });

        clientJobs[msg.sender].push(jobId);
        freelancerJobs[_freelancer].push(jobId);

        emit JobCreated(jobId, msg.sender, _freelancer, _amount, _deadline);
    }

    /// @notice (2) ฝากเงินค่าจ้างเข้า Escrow (ต้องส่ง ETH เท่ากับค่าจ้างพอดี)
    function depositPayment(uint256 _jobId)
        external
        payable
        jobExists(_jobId)
        onlyClient(_jobId)
        inStatus(_jobId, Status.Created)
    {
        Job storage job = jobs[_jobId];
        require(msg.value == job.amount, "Must send exact amount");
        require(block.timestamp < job.deadline, "Deadline passed");

        job.status = Status.Funded;

        paymentHistory[_jobId].push(
            PaymentRecord(_jobId, address(this), msg.value, "DEPOSIT", block.timestamp)
        );

        emit PaymentDeposited(_jobId, msg.sender, msg.value);
    }

    /// @notice (3) ฟรีแลนซ์บันทึกหลักฐานการส่งมอบงาน (URL หรือ Hash)
    function submitWork(uint256 _jobId, string calldata _workProof)
        external
        jobExists(_jobId)
        onlyFreelancer(_jobId)
        inStatus(_jobId, Status.Funded)
    {
        require(bytes(_workProof).length > 0, "Work proof required");
        require(block.timestamp <= jobs[_jobId].deadline, "Deadline passed");

        jobs[_jobId].workProof = _workProof;
        jobs[_jobId].status = Status.Submitted;

        emit WorkSubmitted(_jobId, msg.sender, _workProof);
    }

    /// @notice (4) ผู้ว่าจ้างอนุมัติงาน -> โอน ETH ให้ฟรีแลนซ์อัตโนมัติ
    function approveAndRelease(uint256 _jobId)
        external
        jobExists(_jobId)
        onlyClient(_jobId)
        inStatus(_jobId, Status.Submitted)
        nonReentrant
    {
        Job storage job = jobs[_jobId];

        // Checks-Effects-Interactions: เปลี่ยนสถานะก่อนโอนเงิน (กันจ่ายซ้ำ)
        job.status = Status.Approved;
        uint256 payout = job.amount;

        paymentHistory[_jobId].push(
            PaymentRecord(_jobId, job.freelancer, payout, "RELEASE", block.timestamp)
        );

        (bool ok, ) = payable(job.freelancer).call{value: payout}("");
        require(ok, "Transfer failed");

        emit PaymentReleased(_jobId, job.freelancer, payout);
    }

    /// @notice (5.1) คู่สัญญาฝ่ายใดฝ่ายหนึ่งแจ้งข้อพิพาท (หลังฝากเงินแล้ว และยังไม่อนุมัติ)
    function raiseDispute(uint256 _jobId, string calldata _reason)
        external
        jobExists(_jobId)
    {
        Job storage job = jobs[_jobId];
        require(msg.sender == job.client || msg.sender == job.freelancer, "Not a party");
        require(
            job.status == Status.Funded || job.status == Status.Submitted,
            "Cannot dispute in this status"
        );

        job.status = Status.Disputed;
        emit DisputeRaised(_jobId, msg.sender, _reason);
    }

    /// @notice (5.2) ผู้ดูแลตัดสิน: true = จ่ายให้ฟรีแลนซ์, false = คืนเงินผู้ว่าจ้าง
    function resolveDispute(uint256 _jobId, bool _payFreelancer)
        external
        jobExists(_jobId)
        onlyAdmin
        inStatus(_jobId, Status.Disputed)
        nonReentrant
    {
        Job storage job = jobs[_jobId];
        uint256 payout = job.amount;
        address recipient;

        if (_payFreelancer) {
            job.status = Status.Resolved;
            recipient = job.freelancer;
            paymentHistory[_jobId].push(
                PaymentRecord(_jobId, recipient, payout, "DISPUTE_PAYOUT", block.timestamp)
            );
        } else {
            job.status = Status.Refunded;
            recipient = job.client;
            paymentHistory[_jobId].push(
                PaymentRecord(_jobId, recipient, payout, "REFUND", block.timestamp)
            );
        }

        (bool ok, ) = payable(recipient).call{value: payout}("");
        require(ok, "Transfer failed");

        emit DisputeResolved(_jobId, _payFreelancer, payout);
    }

    // ---------------------------------------------------------------
    // 6) ยกเลิกก่อนฝากเงิน (ไม่มีการโอนเงินออกจาก Escrow)
    // ---------------------------------------------------------------

    /// @notice ผู้ว่าจ้างยกเลิกข้อตกลงที่ยังไม่ได้ฝากเงิน
    function cancelJob(uint256 _jobId)
        external
        jobExists(_jobId)
        onlyClient(_jobId)
        inStatus(_jobId, Status.Created)
    {
        jobs[_jobId].status = Status.Cancelled;
        emit JobCancelled(_jobId);
    }

    // ---------------------------------------------------------------
    // 7) (6) ติดตามสถานะธุรกรรม - ฟังก์ชันอ่านข้อมูลสำหรับหน้าเว็บ
    // ---------------------------------------------------------------

    function getJob(uint256 _jobId)
        external
        view
        jobExists(_jobId)
        returns (Job memory)
    {
        return jobs[_jobId];
    }

    function getJobStatus(uint256 _jobId)
        external
        view
        jobExists(_jobId)
        returns (Status)
    {
        return jobs[_jobId].status;
    }

    function getPaymentHistory(uint256 _jobId)
        external
        view
        jobExists(_jobId)
        returns (PaymentRecord[] memory)
    {
        return paymentHistory[_jobId];
    }

    function getJobsByClient(address _client) external view returns (uint256[] memory) {
        return clientJobs[_client];
    }

    function getJobsByFreelancer(address _freelancer) external view returns (uint256[] memory) {
        return freelancerJobs[_freelancer];
    }

    /// @notice ยอด ETH ที่ถูกล็อกอยู่ใน Escrow ทั้งหมด
    function escrowBalance() external view returns (uint256) {
        return address(this).balance;
    }

    // ป้องกันการโอน ETH เข้า contract โดยตรง (ต้องฝากผ่าน depositPayment เท่านั้น)
    receive() external payable {
        revert("Use depositPayment()");
    }

    fallback() external payable {
        revert("Invalid call");
    }
}

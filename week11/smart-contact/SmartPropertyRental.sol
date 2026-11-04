// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * LAP 11 - โจทย์ที่ 4
 * Smart Property Rental & Deposit Management (SmartLiving Property)
 *
 * บทบาท (Roles)
 *  - arbitrator : ผู้มีอำนาจตัดสินข้อพิพาท (ผู้ deploy สัญญา)
 *  - landlord   : เจ้าของห้อง (ผู้ลงทะเบียนทรัพย์สิน)
 *  - tenant     : ผู้เช่า
 *
 * กฎธุรกิจสำคัญ
 *  1) การหักเงินประกันต้องมีเหตุผล (reason) และมีการอนุมัติ (ผู้เช่ายอมรับ หรือ arbitrator ตัดสิน)
 *  2) ห้ามคืน/หักเงินเกินยอดคงเหลือของเงินประกัน (depositBalance)
 */
contract SmartPropertyRental {
    // ===================== Data Structures =====================

    enum Status {
        Created,        // สร้างสัญญาแล้ว รอยืนยัน/ฝากเงินประกัน
        Active,         // ยืนยันครบทั้งสองฝ่าย + ฝากเงินประกันแล้ว (สัญญามีผล)
        DeductionProposed, // เจ้าของห้องเสนอยอดหักหลังตรวจสภาพห้อง รอผู้เช่าตอบ
        Disputed,       // มีข้อพิพาท รอ arbitrator
        Closed,         // ปิดสัญญา คืนเงินประกันเรียบร้อย
        Cancelled       // ยกเลิกก่อนเริ่มสัญญา
    }

    struct Property {
        uint256 id;
        address landlord;
        string name;
        uint256 monthlyRent;     // หน่วย wei
        uint256 depositAmount;   // หน่วย wei
        bool isActive;           // เปิดให้เช่าอยู่หรือไม่
        bool isRented;           // ตอนนี้มีสัญญาที่มีผลอยู่หรือไม่
    }

    struct Agreement {
        uint256 id;
        uint256 propertyId;
        address landlord;
        address tenant;
        uint256 startDate;
        uint256 endDate;
        uint256 monthlyRent;
        uint256 depositAmount;
        uint256 depositBalance;  // เงินประกันคงเหลือในสัญญา
        uint256 totalPeriods;    // จำนวนงวดค่าเช่าทั้งหมด (งวดละ 30 วัน)
        uint256 paidPeriods;     // จำนวนงวดที่จ่ายแล้ว
        string terms;            // เงื่อนไขสำคัญของสัญญา
        bool landlordConfirmed;
        bool tenantConfirmed;
        bool depositPaid;
        uint256 proposedDeduction; // ยอดหักที่เจ้าของห้องเสนอ
        string deductionReason;    // เหตุผลการหัก
        string disputeResolution;  // ผลการตัดสินข้อพิพาท
        Status status;
    }

    struct Payment {
        uint256 period;     // งวดที่
        uint256 amount;
        address payer;
        uint256 timestamp;
    }

    // ===================== State =====================

    address public immutable arbitrator;

    uint256 public propertyCount;
    uint256 public agreementCount;

    mapping(uint256 => Property) private properties;
    mapping(uint256 => Agreement) private agreements;
    mapping(uint256 => Payment[]) private paymentHistory;

    uint256 public constant PERIOD = 30 days;

    // ===================== Events =====================

    event PropertyRegistered(uint256 indexed propertyId, address indexed landlord, string name, uint256 monthlyRent, uint256 depositAmount);
    event AgreementCreated(uint256 indexed agreementId, uint256 indexed propertyId, address indexed tenant, uint256 startDate, uint256 endDate);
    event AgreementConfirmed(uint256 indexed agreementId, address indexed by);
    event AgreementCancelled(uint256 indexed agreementId, address indexed by);
    event DepositPaid(uint256 indexed agreementId, address indexed tenant, uint256 amount);
    event RentPaid(uint256 indexed agreementId, uint256 indexed period, address indexed tenant, uint256 amount);
    event DeductionProposed(uint256 indexed agreementId, uint256 amount, string reason);
    event DisputeRaised(uint256 indexed agreementId, address indexed by);
    event DisputeResolved(uint256 indexed agreementId, uint256 deduction, string resolution);
    event DepositRefunded(uint256 indexed agreementId, address indexed tenant, uint256 refundToTenant, uint256 deductionToLandlord);

    // ===================== Modifiers =====================

    modifier agreementExists(uint256 agreementId) {
        require(agreementId > 0 && agreementId <= agreementCount, "Agreement not found");
        _;
    }

    modifier onlyLandlord(uint256 agreementId) {
        require(msg.sender == agreements[agreementId].landlord, "Only landlord");
        _;
    }

    modifier onlyTenant(uint256 agreementId) {
        require(msg.sender == agreements[agreementId].tenant, "Only tenant");
        _;
    }

    modifier onlyArbitrator() {
        require(msg.sender == arbitrator, "Only arbitrator");
        _;
    }

    constructor() {
        arbitrator = msg.sender;
    }

    // ===================== 1) Register Property =====================

    function registerProperty(
        string calldata name,
        uint256 monthlyRent,
        uint256 depositAmount
    ) external returns (uint256) {
        require(bytes(name).length > 0, "Name required");
        require(monthlyRent > 0, "Rent must be > 0");
        require(depositAmount > 0, "Deposit must be > 0");

        propertyCount++;
        properties[propertyCount] = Property({
            id: propertyCount,
            landlord: msg.sender,
            name: name,
            monthlyRent: monthlyRent,
            depositAmount: depositAmount,
            isActive: true,
            isRented: false
        });

        emit PropertyRegistered(propertyCount, msg.sender, name, monthlyRent, depositAmount);
        return propertyCount;
    }

    // ===================== 2) Create Rental Agreement =====================

    function createAgreement(
        uint256 propertyId,
        address tenant,
        uint256 startDate,
        uint256 endDate,
        string calldata terms
    ) external returns (uint256) {
        Property storage p = properties[propertyId];
        require(propertyId > 0 && propertyId <= propertyCount, "Property not found");
        require(msg.sender == p.landlord, "Only property landlord");
        require(p.isActive, "Property inactive");
        require(!p.isRented, "Property already rented");
        require(tenant != address(0) && tenant != msg.sender, "Invalid tenant");
        require(startDate >= block.timestamp, "Start date in the past");
        require(endDate > startDate, "End must be after start");
        require(bytes(terms).length > 0, "Terms required");

        uint256 periods = (endDate - startDate + PERIOD - 1) / PERIOD; // ปัดขึ้น

        agreementCount++;
        Agreement storage a = agreements[agreementCount];
        a.id = agreementCount;
        a.propertyId = propertyId;
        a.landlord = msg.sender;
        a.tenant = tenant;
        a.startDate = startDate;
        a.endDate = endDate;
        a.monthlyRent = p.monthlyRent;
        a.depositAmount = p.depositAmount;
        a.totalPeriods = periods;
        a.terms = terms;
        a.status = Status.Created;

        emit AgreementCreated(agreementCount, propertyId, tenant, startDate, endDate);
        return agreementCount;
    }

    // ===================== 3) Confirm Agreement =====================

    function confirmAgreement(uint256 agreementId) external agreementExists(agreementId) {
        Agreement storage a = agreements[agreementId];
        require(a.status == Status.Created, "Not in Created state");
        require(msg.sender == a.landlord || msg.sender == a.tenant, "Not a party");

        if (msg.sender == a.landlord) {
            require(!a.landlordConfirmed, "Landlord already confirmed");
            a.landlordConfirmed = true;
        } else {
            require(!a.tenantConfirmed, "Tenant already confirmed");
            a.tenantConfirmed = true;
        }

        emit AgreementConfirmed(agreementId, msg.sender);
    }

    /// ยกเลิกสัญญาก่อนที่จะมีการฝากเงินประกัน (ทั้งสองฝ่ายยกเลิกได้)
    function cancelAgreement(uint256 agreementId) external agreementExists(agreementId) {
        Agreement storage a = agreements[agreementId];
        require(a.status == Status.Created, "Cannot cancel now");
        require(msg.sender == a.landlord || msg.sender == a.tenant, "Not a party");
        require(!a.depositPaid, "Deposit already paid");

        a.status = Status.Cancelled;
        emit AgreementCancelled(agreementId, msg.sender);
    }

    // ===================== 4) Deposit Security =====================

    function depositSecurity(uint256 agreementId)
        external
        payable
        agreementExists(agreementId)
        onlyTenant(agreementId)
    {
        Agreement storage a = agreements[agreementId];
        require(a.status == Status.Created, "Not in Created state");
        require(a.landlordConfirmed && a.tenantConfirmed, "Both parties must confirm first");
        require(!a.depositPaid, "Deposit already paid");
        require(msg.value == a.depositAmount, "Incorrect deposit amount");

        a.depositPaid = true;
        a.depositBalance = msg.value;
        a.status = Status.Active;
        properties[a.propertyId].isRented = true;

        emit DepositPaid(agreementId, msg.sender, msg.value);
    }

    // ===================== 5) Record Rental Payment =====================

    function payRent(uint256 agreementId)
        external
        payable
        agreementExists(agreementId)
        onlyTenant(agreementId)
    {
        Agreement storage a = agreements[agreementId];
        require(a.status == Status.Active, "Agreement not active");
        require(a.paidPeriods < a.totalPeriods, "All periods paid");
        require(msg.value == a.monthlyRent, "Incorrect rent amount");

        a.paidPeriods++;
        uint256 period = a.paidPeriods;

        paymentHistory[agreementId].push(
            Payment({period: period, amount: msg.value, payer: msg.sender, timestamp: block.timestamp})
        );

        emit RentPaid(agreementId, period, msg.sender, msg.value);

        // ส่งค่าเช่าให้เจ้าของห้องทันที (ไม่ใช่เงินประกัน)
        (bool ok, ) = payable(a.landlord).call{value: msg.value}("");
        require(ok, "Rent transfer failed");
    }

    // ===================== 6) Refund Deposit =====================

    /**
     * เจ้าของห้องตรวจสภาพห้องหลังสิ้นสุดสัญญา
     *  - deduction = 0  -> คืนเงินประกันเต็มจำนวนทันที
     *  - deduction > 0  -> ต้องระบุเหตุผล และรอผู้เช่าอนุมัติ (หรือยื่นข้อพิพาท)
     */
    function inspectAndPropose(
        uint256 agreementId,
        uint256 deduction,
        string calldata reason
    ) external agreementExists(agreementId) onlyLandlord(agreementId) {
        Agreement storage a = agreements[agreementId];
        require(a.status == Status.Active, "Agreement not active");
        require(block.timestamp >= a.endDate, "Agreement not ended yet");
        require(deduction <= a.depositBalance, "Deduction exceeds deposit balance");

        if (deduction == 0) {
            _settle(agreementId, 0);
            return;
        }

        require(bytes(reason).length > 0, "Reason required for deduction");
        a.proposedDeduction = deduction;
        a.deductionReason = reason;
        a.status = Status.DeductionProposed;

        emit DeductionProposed(agreementId, deduction, reason);
    }

    /// ผู้เช่ายอมรับยอดหัก -> ปล่อยเงินตามที่ตกลง
    function approveDeduction(uint256 agreementId)
        external
        agreementExists(agreementId)
        onlyTenant(agreementId)
    {
        Agreement storage a = agreements[agreementId];
        require(a.status == Status.DeductionProposed, "No deduction proposed");
        _settle(agreementId, a.proposedDeduction);
    }

    // ===================== 7) Rental Dispute =====================

    /// ผู้เช่าไม่เห็นด้วยกับยอดหัก -> ส่งให้ arbitrator พิจารณา
    function raiseDispute(uint256 agreementId)
        external
        agreementExists(agreementId)
        onlyTenant(agreementId)
    {
        Agreement storage a = agreements[agreementId];
        require(a.status == Status.DeductionProposed, "No deduction to dispute");
        a.status = Status.Disputed;
        emit DisputeRaised(agreementId, msg.sender);
    }

    /// arbitrator บันทึกผลตัดสิน แล้วปล่อยเงินตามยอดที่อนุมัติ
    function resolveDispute(
        uint256 agreementId,
        uint256 approvedDeduction,
        string calldata resolution
    ) external agreementExists(agreementId) onlyArbitrator {
        Agreement storage a = agreements[agreementId];
        require(a.status == Status.Disputed, "Not in dispute");
        require(approvedDeduction <= a.depositBalance, "Deduction exceeds deposit balance");
        require(bytes(resolution).length > 0, "Resolution required");

        a.disputeResolution = resolution;
        emit DisputeResolved(agreementId, approvedDeduction, resolution);

        _settle(agreementId, approvedDeduction);
    }

    // ===================== Internal =====================

    function _settle(uint256 agreementId, uint256 deduction) internal {
        Agreement storage a = agreements[agreementId];
        require(deduction <= a.depositBalance, "Deduction exceeds deposit balance");

        uint256 refund = a.depositBalance - deduction;

        // Effects ก่อน Interactions (กัน reentrancy)
        a.depositBalance = 0;
        a.proposedDeduction = 0;
        a.status = Status.Closed;
        properties[a.propertyId].isRented = false;

        emit DepositRefunded(agreementId, a.tenant, refund, deduction);

        if (deduction > 0) {
            (bool ok1, ) = payable(a.landlord).call{value: deduction}("");
            require(ok1, "Deduction transfer failed");
        }
        if (refund > 0) {
            (bool ok2, ) = payable(a.tenant).call{value: refund}("");
            require(ok2, "Refund transfer failed");
        }
    }

    // ===================== View Functions (ตรวจสอบย้อนหลัง) =====================

    function getProperty(uint256 propertyId) external view returns (Property memory) {
        require(propertyId > 0 && propertyId <= propertyCount, "Property not found");
        return properties[propertyId];
    }

    function getAgreement(uint256 agreementId)
        external
        view
        agreementExists(agreementId)
        returns (Agreement memory)
    {
        return agreements[agreementId];
    }

    function getPaymentCount(uint256 agreementId) external view agreementExists(agreementId) returns (uint256) {
        return paymentHistory[agreementId].length;
    }

    function getPayments(uint256 agreementId)
        external
        view
        agreementExists(agreementId)
        returns (Payment[] memory)
    {
        return paymentHistory[agreementId];
    }

    function contractBalance() external view returns (uint256) {
        return address(this).balance;
    }
}

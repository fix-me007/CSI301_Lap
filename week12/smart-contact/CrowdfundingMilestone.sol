// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * InnovateFund - Blockchain Crowdfunding & Milestone Fund Management
 * เก็บเงินไว้ใน Smart Contract และทยอยจ่ายตามความสำเร็จของแต่ละ Milestone
 */
contract CrowdfundingMilestone {
    // ---------------------------------------------------------------
    // 1) Data structures
    // ---------------------------------------------------------------
    enum MilestoneStatus { Pending, Requested, Approved, Rejected }
    enum TxType { Contribution, Refund, MilestonePayout }

    struct Milestone {
        string description;          // รายละเอียดระยะงาน
        uint256 percentage;          // % ของเงินที่ระดมได้ (ผลรวมทุก milestone = 100)
        MilestoneStatus status;
        string evidence;             // หลักฐาน (เช่น IPFS hash / URL)
        uint256 votingDeadline;      // เวลาสิ้นสุดการโหวต
        uint256 approveWeight;       // น้ำหนักโหวตเห็นด้วย (wei ที่ผู้โหวตสนับสนุน)
        uint256 rejectWeight;        // น้ำหนักโหวตไม่เห็นด้วย
        uint256 paidAmount;          // ยอดที่จ่ายจริง
    }

    struct TxRecord {
        TxType txType;
        address account;
        uint256 amount;
        uint256 timestamp;
        uint256 milestoneIndex;      // ใช้เฉพาะ MilestonePayout
    }

    struct Campaign {
        address owner;
        string title;
        uint256 goal;                // เป้าหมายเงินทุน (wei)
        uint256 deadline;            // เวลาสิ้นสุดการระดมทุน
        uint256 totalRaised;         // ยอดระดมสะสม
        uint256 totalPaid;           // ยอดที่จ่ายให้เจ้าของโครงการแล้ว
        uint256 nextMilestone;       // milestone ถัดไปที่ต้องทำ
        Milestone[] milestones;
        TxRecord[] history;
        mapping(address => uint256) contributions;
        mapping(address => bool) refunded;
    }

    uint256 public constant VOTING_PERIOD = 7 days;
    uint256 public constant MAX_MILESTONES = 10;

    uint256 public campaignCount;
    mapping(uint256 => Campaign) private campaigns;

    // reentrancy guard
    bool private _locked;
    modifier nonReentrant() {
        require(!_locked, "Reentrancy");
        _locked = true;
        _;
        _locked = false;
    }

    // ---------------------------------------------------------------
    // 2) Events (ใช้แสดงความโปร่งใส)
    // ---------------------------------------------------------------
    event CampaignCreated(uint256 indexed id, address indexed owner, string title, uint256 goal, uint256 deadline);
    event Contributed(uint256 indexed id, address indexed backer, uint256 amount);
    event MilestoneRequested(uint256 indexed id, uint256 indexed milestone, string evidence, uint256 votingDeadline);
    event Voted(uint256 indexed id, uint256 indexed milestone, address indexed voter, bool approve, uint256 weight);
    event MilestoneApproved(uint256 indexed id, uint256 indexed milestone, uint256 amount);
    event MilestoneRejected(uint256 indexed id, uint256 indexed milestone);
    event Refunded(uint256 indexed id, address indexed backer, uint256 amount);

    // ---------------------------------------------------------------
    // 3) Modifiers
    // ---------------------------------------------------------------
    modifier campaignExists(uint256 id) {
        require(id < campaignCount, "Campaign not found");
        _;
    }

    // ---------------------------------------------------------------
    // 4) Create Campaign
    // ---------------------------------------------------------------
    function createCampaign(
        string calldata title,
        uint256 goal,
        uint256 durationDays,
        string[] calldata descriptions,
        uint256[] calldata percentages
    ) external returns (uint256 id) {
        require(bytes(title).length > 0, "Title required");
        require(goal > 0, "Goal must be > 0");
        require(durationDays > 0, "Duration must be > 0");
        require(descriptions.length > 0 && descriptions.length <= MAX_MILESTONES, "Invalid milestone count");
        require(descriptions.length == percentages.length, "Length mismatch");

        uint256 sum;
        for (uint256 i = 0; i < percentages.length; i++) {
            require(percentages[i] > 0, "Percentage must be > 0");
            sum += percentages[i];
        }
        require(sum == 100, "Percentages must sum to 100");

        id = campaignCount++;
        Campaign storage c = campaigns[id];
        c.owner = msg.sender;
        c.title = title;
        c.goal = goal;
        c.deadline = block.timestamp + (durationDays * 1 days);

        for (uint256 i = 0; i < descriptions.length; i++) {
            Milestone storage m = c.milestones.push();
            m.description = descriptions[i];
            m.percentage = percentages[i];
        }

        emit CampaignCreated(id, msg.sender, title, goal, c.deadline);
    }

    // ---------------------------------------------------------------
    // 5) Contribute Funds
    // ---------------------------------------------------------------
    function contribute(uint256 id) external payable campaignExists(id) {
        Campaign storage c = campaigns[id];
        require(block.timestamp < c.deadline, "Funding period ended");
        require(msg.value > 0, "Send ETH");
        require(msg.sender != c.owner, "Owner cannot contribute");

        c.contributions[msg.sender] += msg.value;
        c.totalRaised += msg.value;
        c.history.push(TxRecord(TxType.Contribution, msg.sender, msg.value, block.timestamp, 0));

        emit Contributed(id, msg.sender, msg.value);
    }

    // ---------------------------------------------------------------
    // 6) Track Funding Progress
    // ---------------------------------------------------------------
    function getFundingProgress(uint256 id)
        external
        view
        campaignExists(id)
        returns (uint256 raised, uint256 goal, uint256 percentReached, uint256 timeLeft)
    {
        Campaign storage c = campaigns[id];
        raised = c.totalRaised;
        goal = c.goal;
        percentReached = (c.totalRaised * 100) / c.goal;
        timeLeft = block.timestamp >= c.deadline ? 0 : c.deadline - block.timestamp;
    }

    // ---------------------------------------------------------------
    // 7) Request Fund Release (เจ้าของโครงการส่งหลักฐาน)
    // ---------------------------------------------------------------
    function requestRelease(uint256 id, string calldata evidence) external campaignExists(id) {
        Campaign storage c = campaigns[id];
        require(msg.sender == c.owner, "Only owner");
        require(block.timestamp >= c.deadline, "Funding not ended");
        require(c.totalRaised >= c.goal, "Goal not reached");
        require(c.nextMilestone < c.milestones.length, "All milestones done");
        require(bytes(evidence).length > 0, "Evidence required");

        Milestone storage m = c.milestones[c.nextMilestone];
        require(
            m.status == MilestoneStatus.Pending || m.status == MilestoneStatus.Rejected,
            "Milestone already requested"
        );

        m.evidence = evidence;
        m.status = MilestoneStatus.Requested;
        m.votingDeadline = block.timestamp + VOTING_PERIOD;
        m.approveWeight = 0;
        m.rejectWeight = 0;
        // ยื่นใหม่หลังถูกปฏิเสธ -> เริ่มรอบโหวตใหม่ (ผู้สนับสนุนโหวตได้อีกครั้ง)
        round[id][c.nextMilestone] += 1;

        emit MilestoneRequested(id, c.nextMilestone, evidence, m.votingDeadline);
    }

    // รอบการโหวตของแต่ละ milestone (เพื่อให้โหวตใหม่ได้เมื่อยื่นซ้ำ)
    mapping(uint256 => mapping(uint256 => uint256)) private round;
    mapping(uint256 => mapping(uint256 => mapping(uint256 => mapping(address => bool)))) private votedInRound;

    // ---------------------------------------------------------------
    // 8) Approve Milestone (ผู้สนับสนุนโหวต + จ่ายเงินอัตโนมัติ)
    // ---------------------------------------------------------------
    function vote(uint256 id, bool approve) external campaignExists(id) nonReentrant {
        Campaign storage c = campaigns[id];
        uint256 idx = c.nextMilestone;
        require(idx < c.milestones.length, "No active milestone");

        Milestone storage m = c.milestones[idx];
        require(m.status == MilestoneStatus.Requested, "Not open for voting");
        require(block.timestamp <= m.votingDeadline, "Voting ended");

        uint256 weight = c.contributions[msg.sender];
        require(weight > 0, "Only backers can vote");

        uint256 r = round[id][idx];
        require(!votedInRound[id][idx][r][msg.sender], "Already voted");
        votedInRound[id][idx][r][msg.sender] = true;

        if (approve) {
            m.approveWeight += weight;
        } else {
            m.rejectWeight += weight;
        }
        emit Voted(id, idx, msg.sender, approve, weight);

        // เกณฑ์: เห็นด้วย > 50% ของเงินระดมทุนทั้งหมด -> อนุมัติและจ่ายทันที
        if (m.approveWeight * 2 > c.totalRaised) {
            _payout(id, c, idx, m);
        } else if (m.rejectWeight * 2 >= c.totalRaised) {
            // ไม่เห็นด้วยตั้งแต่ 50% ขึ้นไป -> ไม่มีทางผ่านแล้ว
            m.status = MilestoneStatus.Rejected;
            emit MilestoneRejected(id, idx);
        }
    }

    /// ปิดการโหวตเมื่อหมดเวลา (ใครก็เรียกได้) ถ้าเสียงไม่ถึงเกณฑ์ถือว่าไม่ผ่าน
    function finalizeVoting(uint256 id) external campaignExists(id) {
        Campaign storage c = campaigns[id];
        uint256 idx = c.nextMilestone;
        require(idx < c.milestones.length, "No active milestone");
        Milestone storage m = c.milestones[idx];
        require(m.status == MilestoneStatus.Requested, "Not open for voting");
        require(block.timestamp > m.votingDeadline, "Voting still open");

        m.status = MilestoneStatus.Rejected;
        emit MilestoneRejected(id, idx);
    }

    function _payout(uint256 id, Campaign storage c, uint256 idx, Milestone storage m) private {
        // ยอดจ่าย = % ของเงินที่ระดมได้ (ผลรวมทุก milestone = 100% จึงไม่เกินเงินที่จัดสรร)
        uint256 amount = (c.totalRaised * m.percentage) / 100;

        // ลำดับ: อัปเดตสถานะก่อนโอนเงิน (Checks-Effects-Interactions)
        m.status = MilestoneStatus.Approved;
        m.paidAmount = amount;
        c.totalPaid += amount;
        c.nextMilestone = idx + 1;
        c.history.push(TxRecord(TxType.MilestonePayout, c.owner, amount, block.timestamp, idx));

        // milestone สุดท้าย: จ่ายเศษที่เหลือจากการปัดเศษ
        if (c.nextMilestone == c.milestones.length && c.totalPaid < c.totalRaised) {
            uint256 dust = c.totalRaised - c.totalPaid;
            amount += dust;
            m.paidAmount = amount;
            c.totalPaid += dust;
        }

        require(c.totalPaid <= c.totalRaised, "Exceeds allocated funds");

        (bool ok, ) = payable(c.owner).call{value: amount}("");
        require(ok, "Transfer failed");

        emit MilestoneApproved(id, idx, amount);
    }

    // ---------------------------------------------------------------
    // 9) Refund (หมดเวลาแล้วไม่ถึงเป้า)
    // ---------------------------------------------------------------
    function refund(uint256 id) external campaignExists(id) nonReentrant {
        Campaign storage c = campaigns[id];
        require(block.timestamp >= c.deadline, "Funding still open");
        require(c.totalRaised < c.goal, "Goal reached, no refund");

        uint256 amount = c.contributions[msg.sender];
        require(amount > 0, "Nothing to refund");
        require(!c.refunded[msg.sender], "Already refunded");

        c.refunded[msg.sender] = true;
        c.contributions[msg.sender] = 0;
        c.history.push(TxRecord(TxType.Refund, msg.sender, amount, block.timestamp, 0));

        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "Refund failed");

        emit Refunded(id, msg.sender, amount);
    }

    // ---------------------------------------------------------------
    // 10) Funding Transparency Dashboard (view functions)
    // ---------------------------------------------------------------
    function getCampaign(uint256 id)
        external
        view
        campaignExists(id)
        returns (
            address owner,
            string memory title,
            uint256 goal,
            uint256 deadline,
            uint256 totalRaised,
            uint256 totalPaid,
            uint256 contractBalanceForCampaign,
            uint256 nextMilestone,
            uint256 milestoneCount
        )
    {
        Campaign storage c = campaigns[id];
        return (
            c.owner, c.title, c.goal, c.deadline, c.totalRaised, c.totalPaid,
            c.totalRaised - c.totalPaid, c.nextMilestone, c.milestones.length
        );
    }

    function getMilestone(uint256 id, uint256 index)
        external
        view
        campaignExists(id)
        returns (
            string memory description,
            uint256 percentage,
            MilestoneStatus status,
            string memory evidence,
            uint256 votingDeadline,
            uint256 approveWeight,
            uint256 rejectWeight,
            uint256 paidAmount
        )
    {
        Campaign storage c = campaigns[id];
        require(index < c.milestones.length, "Invalid milestone");
        Milestone storage m = c.milestones[index];
        return (m.description, m.percentage, m.status, m.evidence, m.votingDeadline,
                m.approveWeight, m.rejectWeight, m.paidAmount);
    }

    function getHistoryLength(uint256 id) external view campaignExists(id) returns (uint256) {
        return campaigns[id].history.length;
    }

    function getHistory(uint256 id, uint256 index)
        external
        view
        campaignExists(id)
        returns (TxType txType, address account, uint256 amount, uint256 timestamp, uint256 milestoneIndex)
    {
        require(index < campaigns[id].history.length, "Invalid index");
        TxRecord storage t = campaigns[id].history[index];
        return (t.txType, t.account, t.amount, t.timestamp, t.milestoneIndex);
    }

    function getContribution(uint256 id, address backer) external view campaignExists(id) returns (uint256) {
        return campaigns[id].contributions[backer];
    }
}

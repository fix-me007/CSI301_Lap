// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

contract Bank {
    mapping(address => uint256) private _balances;

    event Deposit(address indexed owner, uint256 amount);
    event Withdraw(address indexed owner, uint256 amount);

    function deposit() public payable {
        require(msg.value > 0, "Deposit amount must be greater than zero");

        _balances[msg.sender] += msg.value;

        emit Deposit(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) public {
        require(
            amount > 0 && amount <= _balances[msg.sender],
            "Insufficient balance"
        );

        // Update balance before transferring funds
        _balances[msg.sender] -= amount;

        payable(msg.sender).transfer(amount);

        emit Withdraw(msg.sender, amount);
    }

    function checkBalance() public view returns (uint256 balance) {
        return _balances[msg.sender];
    }
}



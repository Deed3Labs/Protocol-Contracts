// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

/// @notice Test-only Uniswap V3 pool with independently controllable spot and average prices.
/// @dev The split is the point: a flash loan moves spot within one transaction while the
/// observation buffer, which is written across blocks, does not follow. Setting the two
/// separately is how a test reproduces that without a real pool.
contract MockUniswapV3Pool {
    address public token0;
    address public token1;

    // Spot state, as slot0 reports it.
    uint160 public sqrtPriceX96;
    int24 public tick;

    // Observation state, as observe() reports it. `tickCumulativeAt[age]` is the cumulative tick
    // `age` seconds ago; the average over a window is the difference divided by the window.
    mapping(uint32 => int56) public tickCumulativeAt;
    bool public observationsAvailable;

    constructor(address _token0, address _token1) {
        token0 = _token0;
        token1 = _token1;
        observationsAvailable = true;
    }

    function setSpot(uint160 _sqrtPriceX96, int24 _tick) external {
        sqrtPriceX96 = _sqrtPriceX96;
        tick = _tick;
    }

    /// @notice Sets a constant average tick over any window.
    function setAverageTick(int24 averageTick, uint32 period) external {
        tickCumulativeAt[0] = 0;
        tickCumulativeAt[period] = -int56(averageTick) * int56(uint56(period));
    }

    /// @notice Mimics a pool whose observation cardinality was never increased.
    function setObservationsAvailable(bool available) external {
        observationsAvailable = available;
    }

    function slot0()
        external
        view
        returns (uint160, int24, uint16, uint16, uint16, uint8, bool)
    {
        return (sqrtPriceX96, tick, 0, 1, 1, 0, true);
    }

    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s)
    {
        require(observationsAvailable, "OLD");
        tickCumulatives = new int56[](secondsAgos.length);
        secondsPerLiquidityCumulativeX128s = new uint160[](secondsAgos.length);
        for (uint256 i = 0; i < secondsAgos.length; i++) {
            tickCumulatives[i] = tickCumulativeAt[secondsAgos[i]];
        }
    }
}

/// @notice Test-only Uniswap V3 factory backed by an explicit pool table.
contract MockUniswapV3Factory {
    mapping(bytes32 => address) private pools;

    function _key(address tokenA, address tokenB, uint24 fee) private pure returns (bytes32) {
        (address a, address b) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return keccak256(abi.encodePacked(a, b, fee));
    }

    function setPool(address tokenA, address tokenB, uint24 fee, address pool) external {
        pools[_key(tokenA, tokenB, fee)] = pool;
    }

    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address) {
        return pools[_key(tokenA, tokenB, fee)];
    }
}

const fs = require('fs');
const path = require('path');

function getContractSize(contractPath) {
    const artifact = require(contractPath);
    const bytecodeLength = (artifact.deployedBytecode.length - 2) / 2; // Remove '0x' and convert to bytes
    return bytecodeLength;
}

const artifactsDir = path.join(__dirname, '../artifacts/contracts');
const contracts = ['core/DeedNFT.sol/DeedNFT.json', 'core/MetadataRenderer.sol/MetadataRenderer.json'];

contracts.forEach(contract => {
    const contractPath = path.join(artifactsDir, contract);
    const size = getContractSize(contractPath);
    console.log(`${contract}: ${size} bytes${size > 24576 ? ' (EXCEEDS LIMIT)' : ''}`);
}); 
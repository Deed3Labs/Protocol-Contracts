// Form Handler for DeedNFT Minting
// This file handles form initialization and submission in Webflow

export function initializeForm() {
    const form = document.querySelector('[data-element="deed-mint-form"]');
    if (!form) {
        console.warn('DeedNFT mint form not found');
        return;
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const formData = new FormData(e.target);
        const data = {
            assetType: parseInt(formData.get('assetType')),
            definition: formData.get('definition'),
            ipfsDetailsHash: formData.get('ipfsDetailsHash'),
            token: formData.get('token'),
            configuration: formData.get('configuration'),
            validatorAddress: formData.get('validatorAddress'),
            salt: formData.get('salt') ? parseInt(formData.get('salt')) : 0
        };

        try {
            const hash = await window.DeedNFT.mintDeed(data);
            // You can customize this success message or use Webflow's native notifications
            alert(`DeedNFT minted successfully! Transaction hash: ${hash}`);
        } catch (error) {
            alert(`Failed to mint DeedNFT: ${error.message}`);
        }
    });
} 
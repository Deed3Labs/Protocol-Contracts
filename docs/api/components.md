# Frontend Components Documentation

This document provides comprehensive documentation for all React components in The Deed Protocol frontend application, including their functionality, props, and usage examples.

## 🎯 Component Overview

The frontend application consists of several key component categories:

### Core Components
- **Dashboard**: Main user interface and asset management
- **MintForm**: Asset minting interface
- **DeedNFTViewer**: Asset viewing and management
- **Validation**: Validation workflow interface
- **AdminPanel**: Administrative functions

### UI Components
- **Header**: Navigation and wallet connection
- **Footer**: Application footer and links
- **NetworkWarning**: Network validation warnings
- **ThemeToggle**: Dark/light mode toggle

### Modal Components
- **TransferModal**: Asset transfer interface
- **MessageOwnerModal**: Owner communication
- **InstallPrompt**: Wallet installation prompts

### Utility Components
- **Faucet**: Testnet token distribution
- **Explore**: Asset discovery interface
- **SmartWalletTest**: Smart wallet testing

## 📋 Component Details

### 1. Dashboard.tsx (349 lines)

The main dashboard component providing an overview of user assets and protocol status.

#### Key Features
- **Asset Overview**: Display user's DeedNFT tokens
- **Network Status**: Show current network and connection status
- **Quick Actions**: Provide quick access to common operations
- **Statistics**: Display protocol statistics and user metrics
- **Notifications**: Real-time notifications and alerts

#### Props
```typescript
interface DashboardProps {
  // Optional props for customization
  showStatistics?: boolean;
  showQuickActions?: boolean;
  maxAssetsToShow?: number;
}
```

#### Usage Example
```tsx
import { Dashboard } from '@/components/Dashboard';

function App() {
  return (
    <div>
      <Dashboard 
        showStatistics={true}
        showQuickActions={true}
        maxAssetsToShow={10}
      />
    </div>
  );
}
```

#### Key Functions
- `fetchUserAssets()`: Load user's DeedNFTs
- `handleAssetClick()`: Navigate to asset details
- `handleQuickAction()`: Execute quick actions
- `updateStatistics()`: Update dashboard statistics

### 2. MintForm.tsx (1,052 lines)

Comprehensive interface for minting new DeedNFT tokens.

#### Key Features
- **Asset Type Selection**: Choose between Land, Vehicle, Estate, or Equipment
- **Metadata Input**: Structured input forms for asset-specific metadata
- **Document Upload**: Support for uploading property documents and images
- **Validation Integration**: Integrated validation workflow during minting
- **Gas Estimation**: Real-time gas cost estimation and optimization

#### Props
```typescript
interface MintFormProps {
  onMintSuccess?: (tokenId: string) => void;
  onMintError?: (error: string) => void;
  defaultAssetType?: number;
  showAdvancedOptions?: boolean;
}
```

#### Asset Type Forms

**Land Assets**
```typescript
interface LandAssetForm {
  location: string;        // Geographic coordinates
  address: string;         // Physical address
  size: number;           // Land area
  sizeUnit: string;       // Unit of measurement
  zoning: string;         // Zoning classification
  landType: string;       // Type of land
  ownership: string;      // Current ownership
  titleNumber: string;    // Legal title number
}
```

**Vehicle Assets**
```typescript
interface VehicleAssetForm {
  make: string;           // Vehicle manufacturer
  model: string;          // Vehicle model
  year: number;          // Manufacturing year
  vin: string;           // Vehicle Identification Number
  condition: string;      // Current condition
  mileage: number;       // Current mileage
  registration: string;   // Registration number
}
```

**Estate Assets**
```typescript
interface EstateAssetForm {
  propertyType: string;   // Residential/Commercial
  squareFootage: number;  // Total square footage
  bedrooms: number;       // Number of bedrooms
  bathrooms: number;      // Number of bathrooms
  address: string;        // Property address
  buildingFeatures: string[]; // Building features
}
```

**Commercial Equipment**
```typescript
interface EquipmentAssetForm {
  equipmentType: string;  // Type of equipment
  manufacturer: string;   // Equipment manufacturer
  model: string;         // Equipment model
  serialNumber: string;  // Equipment serial number
  condition: string;     // Current condition
  usageHours: number;    // Usage hours
}
```

#### Usage Example
```tsx
import { MintForm } from '@/components/MintForm';

function MintPage() {
  const handleMintSuccess = (tokenId: string) => {
    console.log(`Successfully minted token ${tokenId}`);
  };

  const handleMintError = (error: string) => {
    console.error('Minting failed:', error);
  };

  return (
    <MintForm
      onMintSuccess={handleMintSuccess}
      onMintError={handleMintError}
      defaultAssetType={0} // Land
      showAdvancedOptions={true}
    />
  );
}
```

### 3. DeedNFTViewer.tsx (678 lines)

Advanced NFT viewing and management interface.

#### Key Features
- **Token Display**: Rich display of NFT metadata and properties
- **Gallery System**: Multiple image support with gallery navigation
- **Document Viewer**: Integrated document viewing for property documents
- **Transfer Interface**: Secure transfer functionality with validation
- **Metadata Editing**: Admin capabilities for metadata updates
- **Royalty Information**: Display of royalty and fee information

#### Props
```typescript
interface DeedNFTViewerProps {
  tokenId: string;
  showTransferButton?: boolean;
  showEditButton?: boolean;
  showDocuments?: boolean;
  onTransfer?: (recipient: string) => void;
  onEdit?: (metadata: any) => void;
}
```

#### Usage Example
```tsx
import { DeedNFTViewer } from '@/components/DeedNFTViewer';

function AssetViewPage({ tokenId }: { tokenId: string }) {
  const handleTransfer = (recipient: string) => {
    // Handle asset transfer
  };

  const handleEdit = (metadata: any) => {
    // Handle metadata editing
  };

  return (
    <DeedNFTViewer
      tokenId={tokenId}
      showTransferButton={true}
      showEditButton={true}
      showDocuments={true}
      onTransfer={handleTransfer}
      onEdit={handleEdit}
    />
  );
}
```

### 4. Validation.tsx (3,060 lines)

Integrated validation workflow for asset verification.

#### Key Features
- **Asset Management**: View and manage all assets
- **Validation Forms**: Structured forms for validation criteria
- **Document Management**: Upload and manage validation documents
- **Status Tracking**: Real-time validation status updates
- **Role Verification**: Check user permissions for validation

#### Validation Functions
```typescript
// Check validator permissions
const checkValidatorPermissions = async (validatorContract: ethers.Contract, tokenId: string)

// Update validation status
const handleUpdateValidation = async (tokenId: string)

// Validate deed using validator contract
const handleValidateDeed = async (tokenId: string)

// Manage validation documents
const handleManageDocument = async (tokenId: string, docType: string, documentURI: string)
```

#### Validation Forms
```typescript
interface ValidationFormData {
  tokenId: string;
  isValid: boolean;
  notes: string;
}

interface TraitFormData {
  tokenId: string;
  traitName: string;
  traitValue: string;
  valueType: "string" | "number" | "boolean";
}

interface DocumentFormData {
  tokenId: string;
  docType: string;
  documentURI: string;
  isRemove: boolean;
}
```

#### Usage Example
```tsx
import { Validation } from '@/components/Validation';

function ValidationPage() {
  return (
    <div>
      <h1>Asset Validation</h1>
      <Validation />
    </div>
  );
}
```

### 5. AdminPanel.tsx (1,513 lines)

Comprehensive administrative interface for protocol management.

#### Key Features
- **Validator Management**: Register and manage validator contracts
- **Fund Management**: Monitor and manage protocol funds
- **User Management**: Administer user accounts and permissions
- **Contract Configuration**: Update contract parameters and settings
- **Analytics Dashboard**: Protocol analytics and metrics
- **Emergency Controls**: Emergency pause and recovery functions

#### Admin Functions
```typescript
// Validator management
const registerValidator = async (address: string, name: string, description: string)
const deregisterValidator = async (address: string)

// Fund management
const withdrawFunds = async (token: string, amount: string, recipient: string)
const distributeFees = async (token: string, recipients: string[], amounts: string[])

// Contract configuration
const updateContractParameters = async (contract: string, parameters: any)
const pauseContract = async (contract: string)
const unpauseContract = async (contract: string)
```

#### Usage Example
```tsx
import { AdminPanel } from '@/components/AdminPanel';

function AdminPage() {
  return (
    <div>
      <h1>Administrative Panel</h1>
      <AdminPanel />
    </div>
  );
}
```

### 6. Header.tsx (397 lines)

Application header with navigation and wallet connection.

#### Key Features
- **Navigation**: Main navigation menu
- **Wallet Connection**: Wallet connection and management
- **Network Selection**: Network switching and validation
- **User Menu**: User account and settings
- **Theme Toggle**: Dark/light mode switching

#### Props
```typescript
interface HeaderProps {
  showNavigation?: boolean;
  showWalletConnection?: boolean;
  showNetworkSelector?: boolean;
  showUserMenu?: boolean;
}
```

#### Usage Example
```tsx
import { Header } from '@/components/Header';

function App() {
  return (
    <div>
      <Header 
        showNavigation={true}
        showWalletConnection={true}
        showNetworkSelector={true}
        showUserMenu={true}
      />
      {/* Main content */}
    </div>
  );
}
```

### 7. TransferModal.tsx (557 lines)

Secure asset transfer interface with validation.

#### Key Features
- **Recipient Validation**: Validate recipient address
- **Gas Estimation**: Real-time gas cost estimation
- **Transaction Status**: Live transaction status tracking
- **Confirmation Flow**: Multi-step confirmation process
- **Error Handling**: Comprehensive error handling

#### Props
```typescript
interface TransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  deedNFT: DeedNFT;
  getAssetTypeLabel: (assetType: number) => string;
  onTransferSuccess?: () => void;
}
```

#### Usage Example
```tsx
import { TransferModal } from '@/components/TransferModal';

function AssetPage({ deedNFT }: { deedNFT: DeedNFT }) {
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);

  const handleTransferSuccess = () => {
    console.log('Transfer completed successfully');
    setIsTransferModalOpen(false);
  };

  return (
    <div>
      <button onClick={() => setIsTransferModalOpen(true)}>
        Transfer Asset
      </button>
      
      <TransferModal
        isOpen={isTransferModalOpen}
        onClose={() => setIsTransferModalOpen(false)}
        deedNFT={deedNFT}
        getAssetTypeLabel={(type) => getAssetTypeName(type)}
        onTransferSuccess={handleTransferSuccess}
      />
    </div>
  );
}
```

### 8. NetworkWarning.tsx (100 lines)

Network validation warnings and network switching.

#### Key Features
- **Network Detection**: Automatic network detection
- **Network Switching**: Facilitate network switching
- **Warning Display**: Show appropriate warnings
- **User Guidance**: Provide clear user guidance

#### Usage Example
```tsx
import { NetworkWarning } from '@/components/NetworkWarning';

function App() {
  return (
    <div>
      <NetworkWarning />
      {/* Main content */}
    </div>
  );
}
```

### 9. Faucet.tsx (384 lines)

Testnet token distribution for development and testing.

#### Key Features
- **Token Distribution**: Distribute test tokens
- **Balance Display**: Show current token balances
- **Transaction History**: Track faucet transactions
- **Rate Limiting**: Prevent abuse with rate limiting

#### Usage Example
```tsx
import { Faucet } from '@/components/Faucet';

function TestnetPage() {
  return (
    <div>
      <h1>Testnet Faucet</h1>
      <Faucet />
    </div>
  );
}
```

### 10. Explore.tsx (264 lines)

Asset discovery and exploration interface.

#### Key Features
- **Asset Discovery**: Browse and search assets
- **Filtering**: Filter assets by type, status, etc.
- **Search**: Search assets by metadata
- **Pagination**: Handle large asset collections

#### Usage Example
```tsx
import { Explore } from '@/components/Explore';

function ExplorePage() {
  return (
    <div>
      <h1>Explore Assets</h1>
      <Explore />
    </div>
  );
}
```

## 🔧 Custom Hooks

### 1. useAppKitAuth.ts (261 lines)

Manages authentication state and wallet connections.

#### Key Features
- **Wallet Connection**: Handle wallet connection and disconnection
- **Account Management**: Manage user accounts and switching
- **Network Switching**: Handle network changes and validation
- **Session Persistence**: Maintain user sessions across page reloads

#### Usage Example
```tsx
import { useAppKitAuth } from '@/hooks/useAppKitAuth';

function MyComponent() {
  const { 
    isConnected, 
    address, 
    connect, 
    disconnect 
  } = useAppKitAuth();

  return (
    <div>
      {isConnected ? (
        <button onClick={disconnect}>Disconnect</button>
      ) : (
        <button onClick={connect}>Connect Wallet</button>
      )}
    </div>
  );
}
```

### 2. useDeedNFTData.ts (27 lines)

Manages DeedNFT data fetching and caching.

#### Key Features
- **Data Fetching**: Efficient data fetching from smart contracts
- **Caching Strategy**: Intelligent caching for performance
- **Real-time Updates**: Live updates when blockchain state changes
- **Error Recovery**: Robust error handling and recovery

#### Usage Example
```tsx
import { useDeedNFTData } from '@/hooks/useDeedNFTData';

function AssetList() {
  const { assets, loading, error, refetch } = useDeedNFTData();

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div>
      {assets.map(asset => (
        <AssetCard key={asset.tokenId} asset={asset} />
      ))}
    </div>
  );
}
```

### 3. useNetworkValidation.ts (103 lines)

Handles network validation and switching.

#### Key Features
- **Network Detection**: Automatic network detection and validation
- **Supported Networks**: Validate against supported network list
- **Network Switching**: Facilitate network switching with validation
- **User Feedback**: Provide clear feedback for network issues

#### Usage Example
```tsx
import { useNetworkValidation } from '@/hooks/useNetworkValidation';

function NetworkStatus() {
  const { 
    isCorrectNetwork, 
    currentNetwork, 
    switchToSupportedNetwork 
  } = useNetworkValidation();

  return (
    <div>
      {isCorrectNetwork ? (
        <div>Connected to {currentNetwork?.name}</div>
      ) : (
        <button onClick={switchToSupportedNetwork}>
          Switch Network
        </button>
      )}
    </div>
  );
}
```

### 4. useSmartAccountDeployment.ts (126 lines)

Manages smart account deployment and configuration.

#### Key Features
- **Account Deployment**: Handle smart account deployment
- **Configuration Management**: Manage account configuration
- **Gas Optimization**: Optimize deployment gas costs
- **Status Tracking**: Track deployment status and progress

#### Usage Example
```tsx
import { useSmartAccountDeployment } from '@/hooks/useSmartAccountDeployment';

function SmartAccountSetup() {
  const { 
    isSmartAccountDeployed, 
    deploySmartAccount, 
    isDeploying 
  } = useSmartAccountDeployment();

  return (
    <div>
      {!isSmartAccountDeployed && (
        <button 
          onClick={deploySmartAccount}
          disabled={isDeploying}
        >
          {isDeploying ? 'Deploying...' : 'Deploy Smart Account'}
        </button>
      )}
    </div>
  );
}
```

### 5. XMTP Messaging Hooks

#### useXMTP.ts (Context Hook)
Provides XMTP messaging functionality throughout the application.

#### Key Features
- **Client Management**: XMTP client connection and lifecycle
- **Conversation Management**: Create, load, and manage conversations
- **Message Handling**: Send, receive, and sync messages
- **Identity Management**: Check and create XMTP identities
- **Real-time Streaming**: Live message updates

#### Usage Example
```tsx
import { useXMTP } from '@/context/XMTPContext';

function MessagingComponent() {
  const { 
    isConnected, 
    conversations, 
    sendMessage, 
    createConversation,
    checkIdentityStatus 
  } = useXMTP();

  return (
    <div>
      {isConnected ? (
        <div>Connected to XMTP</div>
      ) : (
        <button>Connect XMTP</button>
      )}
    </div>
  );
}
```

#### useXMTPConnection.ts (Connection Hook)
Manages XMTP connection and wallet integration.

#### Key Features
- **Wallet Integration**: Connect XMTP with various wallet types
- **Smart Account Support**: Support for Reown AppKit smart accounts
- **Connection State**: Track connection status and loading states
- **Auto-reconnection**: Handle connection failures gracefully

#### Usage Example
```tsx
import { useXMTPConnection } from '@/hooks/useXMTPConnection';

function ConnectionManager() {
  const { 
    handleConnect, 
    isConnecting, 
    isConnected,
    address 
  } = useXMTPConnection();

  return (
    <div>
      {!isConnected && (
        <button onClick={handleConnect} disabled={isConnecting}>
          {isConnecting ? 'Connecting...' : 'Connect XMTP'}
        </button>
      )}
    </div>
  );
}
```

## 🎨 UI Components

### Shadcn/ui Integration

The application uses shadcn/ui components for consistent styling:

- **Button**: Variant-rich button components
- **Card**: Flexible card components
- **Dialog**: Modal dialogs for user interactions
- **Input**: Form input components with validation
- **Select**: Dropdown selection components
- **Tabs**: Tabbed interface components
- **Progress**: Progress indicators and loading states
- **Alert**: Notification and alert components
- **Badge**: Status and label components

### Custom UI Components

- **NetworkWarning**: Network validation warnings
- **InstallPrompt**: Wallet installation prompts
- **ThemeToggle**: Dark/light mode toggle
- **TransferModal**: Asset transfer interface
- **MessageOwnerModal**: Owner communication interface
- **XMTPMessaging**: End-to-end encrypted messaging interface
- **TDeedIdentityManager**: XMTP identity management for T-Deed owners
- **XMTPMessageButton**: Quick messaging button component

## 🔧 Component Development Guidelines

### Best Practices

1. **TypeScript**: Use TypeScript for all components
2. **Props Interface**: Define clear props interfaces
3. **Error Handling**: Implement proper error boundaries
4. **Loading States**: Show loading states for async operations
5. **Accessibility**: Ensure components are accessible

### Performance Optimization

1. **Memoization**: Use React.memo for expensive components
2. **Lazy Loading**: Implement lazy loading for large components
3. **Code Splitting**: Split components into smaller chunks
4. **Virtualization**: Use virtualization for large lists

### Testing

1. **Unit Tests**: Test individual components
2. **Integration Tests**: Test component interactions
3. **E2E Tests**: Test complete user workflows
4. **Visual Regression**: Test component appearance

---

*This documentation is part of The Deed Protocol v0.2.0-beta. For questions about frontend components, please contact the development team.* 
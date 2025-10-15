# The Deed Protocol Frontend

This repository contains the frontend application for **The Deed Protocol**, a modern React-based web interface for interacting with decentralized Real World Asset transactions via Smart Contracts. The frontend provides a comprehensive user experience for minting, viewing, and managing T-Deed tokens representing real-world assets.

> ⚠️ **BETA WARNING**: This frontend application is currently in beta. Use at your own risk. The application interfaces with smart contracts that have not been audited and may contain bugs or security vulnerabilities.

## Overview

The Deed Protocol Frontend is a modern, responsive web application built with React, TypeScript, and Vite. It provides a comprehensive interface for users to interact with the Deed Protocol smart contracts, enabling them to mint, view, transfer, and manage DeedNFTs representing real-world assets such as land, vehicles, estates, and commercial equipment.

Key features of the frontend include:
- **Wallet Integration**: Seamless integration with Reowns AppKit for secure wallet connections
- **Smart Contract Interaction**: Direct interaction with DeedNFT, Validator, FundManager, Subdivide, and Fractionalize contracts
- **Multi-Network Support**: Support for Ethereum Mainnet, Base, and their respective testnets
- **Modern UI/UX**: Beautiful, responsive interface with dark/light mode support
- **Real-time Updates**: Live data synchronization with blockchain state
- **Admin Panel**: Comprehensive administrative tools for protocol management
- **Validation System**: Integrated validation workflows for asset verification
- **Interactive Map**: Mapbox-powered map interface for visualizing DeedNFTs with location data
- **Asset Subdivision**: Interface for creating and managing subdivided asset units
- **Fractionalization**: Tools for creating and managing fractional ownership shares

## Project Structure

```
src/
├── components/          # React components
│   ├── ui/             # Reusable UI components (shadcn/ui)
│   ├── AdminPanel.tsx  # Administrative interface
│   ├── Dashboard.tsx   # Main dashboard component
│   ├── DeedNFTViewer.tsx # NFT viewing and management
│   ├── Explore.tsx     # Asset exploration interface
│   ├── Faucet.tsx      # Testnet faucet functionality
│   ├── Header.tsx      # Application header
│   ├── Home.tsx        # Landing page
│   ├── MintForm.tsx    # NFT minting interface
│   ├── Validation.tsx  # Asset validation workflow
│   ├── SubdivideModal.tsx # Asset subdivision interface
│   ├── FractionalizeModal.tsx # Asset fractionalization interface
│   └── ...            # Additional components
├── hooks/              # Custom React hooks
│   ├── useAppKitAuth.ts # AppKit authentication
│   ├── useCapabilities.ts # Wallet capability management
│   ├── useDeedNFTData.ts # DeedNFT data fetching
│   ├── useNetworkValidation.ts # Network validation
│   └── ...            # Additional hooks
├── config/             # Configuration files
│   └── networks.ts     # Network configurations
├── contracts/          # Contract ABIs and interfaces
│   ├── base/          # Base network contracts
│   ├── base-sepolia/  # Base Sepolia contracts
│   ├── ethereum/      # Ethereum contracts
│   └── sepolia/       # Sepolia testnet contracts
├── context/           # React context providers
│   ├── DeedNFTContext.tsx # Global state management
│   ├── NotificationContext.tsx # Notification management
│   └── ...           # Additional context providers
├── utils/             # Utility functions
│   ├── EIP5792Utils.ts # EIP-5792 implementation
│   └── ...           # Additional utilities
├── types/             # TypeScript type definitions
└── lib/               # Shared libraries and utilities
```

## Environment Setup

### Mapbox Integration

To enable the interactive map feature, you'll need to set up a Mapbox access token:

1. **Get a Mapbox Access Token**:
   - Visit [https://account.mapbox.com](https://account.mapbox.com)
   - Create a free account and get your access token

2. **Configure Environment Variables**:
   Create a `.env` file in the `app` directory with:
   ```
   # Development token (for localhost)
   VITE_MAPBOX_PUBLIC_TOKEN=your_mapbox_public_token_here
   
   # Production token (for deployed app)
   VITE_MAPBOX_PRIVATE_TOKEN=your_mapbox_private_token_here
   ```
   
   **Note**: Use different tokens for development and production environments. The public token is used for localhost development, while the private token is used for production deployments.

The map component will automatically detect T-Deeds with location data and display them as interactive markers on the map.

## Core Components

### 1. AppKitProvider

The main provider component that sets up the application's core infrastructure:

- **Wallet Integration**: Configures Reowns AppKit for secure wallet connections
- **Network Management**: Handles multi-network support and switching
- **State Management**: Provides global state for application data
- **Error Handling**: Comprehensive error handling and user feedback
- **Authentication**: Manages user authentication and session state

### 2. Dashboard

The central dashboard component providing an overview of user assets and protocol status:

- **Asset Overview**: Displays user's T-Deed tokens and their status
- **Network Status**: Shows current network and connection status
- **Quick Actions**: Provides quick access to common operations
- **Statistics**: Displays protocol statistics and user metrics
- **Notifications**: Real-time notifications and alerts

### 3. MintForm

A comprehensive interface for minting new T-Deed tokens:

- **Asset Type Selection**: Choose between Land, Vehicle, Estate, or Commercial Equipment
- **Metadata Input**: Structured input forms for asset-specific metadata
- **Validation Integration**: Integrated validation workflow during minting
- **Document Upload**: Support for uploading property documents and images
- **Gas Estimation**: Real-time gas cost estimation and optimization
- **Transaction Status**: Live transaction status tracking

### 4. DeedNFTViewer

Advanced NFT viewing and management interface:

- **Token Display**: Rich display of NFT metadata and properties
- **Gallery System**: Multiple image support with gallery navigation
- **Document Viewer**: Integrated document viewing for property documents
- **Transfer Interface**: Secure transfer functionality with validation
- **Metadata Editing**: Admin capabilities for metadata updates
- **Royalty Information**: Display of royalty and fee information
- **Subdivision Tools**: Interface for creating subdivided units
- **Fractionalization Tools**: Interface for creating fractional shares

### 5. DeedNFTMap

Interactive map interface for visualizing DeedNFTs with location data:

- **Mapbox GL JS v3**: Uses the latest Mapbox Standard style with 3D lighting
- **Interactive Markers**: Color-coded markers for different asset types
- **Location Data Support**: Extracts coordinates from DeedNFT traits and configuration
- **Navigation Controls**: Built-in zoom, pan, and geolocation controls
- **Popup Information**: Click markers to see DeedNFT details
- **Responsive Design**: Works seamlessly on desktop and mobile devices

### 5. AdminPanel

Comprehensive administrative interface for protocol management:

- **Validator Management**: Register and manage validator contracts
- **Fund Management**: Monitor and manage protocol funds
- **User Management**: Administer user accounts and permissions
- **Contract Configuration**: Update contract parameters and settings
- **Analytics Dashboard**: Protocol analytics and metrics
- **Emergency Controls**: Emergency pause and recovery functions

### 6. SubdivideModal

Asset subdivision interface for creating ERC1155 units:

- **Unit Creation**: Interface for creating subdivided asset units
- **Unit Management**: Manage individual units and their properties
- **Metadata Configuration**: Set up unit-specific metadata and traits
- **Validation Integration**: Unit validation through the Validator contract
- **Transfer Management**: Handle unit transfers and ownership changes
- **Royalty Configuration**: Set up unit-level royalty information

### 7. FractionalizeModal

Asset fractionalization interface for creating ERC20 shares:

- **Share Creation**: Interface for creating fractional ownership shares
- **Share Management**: Manage fractional shares and their distribution
- **Asset Locking**: Secure asset locking during fractionalization
- **Approval System**: Handle approval requirements for asset unlocking
- **Token Configuration**: Set up fraction token parameters and restrictions
- **Factory Integration**: Deploy fraction tokens through FractionTokenFactory

### 8. Validation

Integrated validation workflow for asset verification:

- **Validation Criteria**: Asset-specific validation rules and requirements
- **Document Verification**: Automated document verification processes
- **Confidence Scoring**: Confidence scoring for validation results
- **Multi-Validator Support**: Support for multiple validator contracts
- **Validation History**: Complete validation history and audit trail
- **Status Tracking**: Real-time validation status updates

## Custom Hooks

### 1. useAppKitAuth

Manages authentication state and wallet connections:

- **Wallet Connection**: Handles wallet connection and disconnection
- **Account Management**: Manages user accounts and switching
- **Network Switching**: Handles network changes and validation
- **Session Persistence**: Maintains user sessions across page reloads
- **Error Handling**: Comprehensive error handling for auth failures

### 2. useCapabilities

Manages wallet capabilities and feature detection:

- **Capability Detection**: Detects available wallet capabilities
- **Feature Support**: Checks for specific feature support
- **Fallback Handling**: Provides fallbacks for unsupported features
- **Performance Optimization**: Optimizes based on available capabilities

### 3. useDeedNFTData

Manages T-Deed data fetching and caching:

- **Data Fetching**: Efficient data fetching from smart contracts
- **Caching Strategy**: Intelligent caching for performance
- **Real-time Updates**: Live updates when blockchain state changes
- **Error Recovery**: Robust error handling and recovery

### 4. useNetworkValidation

Handles network validation and switching:

- **Network Detection**: Automatic network detection and validation
- **Supported Networks**: Validates against supported network list
- **Network Switching**: Facilitates network switching with validation
- **User Feedback**: Provides clear feedback for network issues

### 5. useSmartAccountDeployment

Manages smart account deployment and configuration:

- **Account Deployment**: Handles smart account deployment
- **Configuration Management**: Manages account configuration
- **Gas Optimization**: Optimizes deployment gas costs
- **Status Tracking**: Tracks deployment status and progress

## UI Components

The application uses a comprehensive set of reusable UI components built with shadcn/ui:

### Core UI Components
- **Button**: Variant-rich button components with loading states
- **Card**: Flexible card components for content organization
- **Dialog**: Modal dialogs for user interactions
- **Input**: Form input components with validation
- **Select**: Dropdown selection components
- **Tabs**: Tabbed interface components
- **Progress**: Progress indicators and loading states
- **Alert**: Notification and alert components
- **Badge**: Status and label components

### Specialized Components
- **NetworkWarning**: Network validation warnings
- **InstallPrompt**: Wallet installation prompts
- **ThemeToggle**: Dark/light mode toggle
- **TransferModal**: Asset transfer interface
- **MessageOwnerModal**: Owner communication interface

## Features

### Core Application Features
- **Multi-Network Support**: 
  - Ethereum Mainnet and Sepolia testnet
  - Base Mainnet and Base Sepolia testnet
  - Automatic network detection and switching
- **Wallet Integration**:
  - Reowns AppKit integration
  - Support for multiple wallet providers
  - Secure authentication and session management
- **Real-time Updates**:
  - Live blockchain state synchronization
  - Real-time transaction status updates
  - Live validation status tracking

### Asset Management Features
- **NFT Minting**:
  - Structured minting workflow
  - Asset type-specific forms
  - Document upload and management
  - Gas optimization
- **NFT Viewing**:
  - Rich metadata display
  - Image gallery support
  - Document viewing
  - Transfer functionality
- **Asset Subdivision**:
  - Create ERC1155 units from DeedNFTs
  - Unit-specific metadata management
  - Unit validation and transfer
  - Royalty configuration per unit
- **Asset Fractionalization**:
  - Create ERC20 shares from DeedNFTs or units
  - Fractional ownership management
  - Share distribution and trading
  - Asset locking and unlocking
- **Asset Validation**:
  - Integrated validation workflow
  - Multi-validator support
  - Confidence scoring
  - Validation history

### Administrative Features
- **Protocol Management**:
  - Validator registration and management
  - Fund monitoring and distribution
  - Contract configuration
  - Emergency controls
- **User Management**:
  - Role-based access control
  - User permissions management
  - Activity monitoring
- **Analytics**:
  - Protocol statistics
  - User analytics
  - Transaction metrics
  - Performance monitoring

### Security Features
- **Authentication**:
  - Secure wallet connections
  - Session management
  - Role-based access control
- **Transaction Security**:
  - Transaction validation
  - Gas estimation and optimization
  - Error handling and recovery
- **Data Protection**:
  - Secure data handling
  - Privacy protection
  - Audit trail maintenance

## Installation and Setup

### Prerequisites

- Node.js 18+ 
- npm or yarn package manager
- MetaMask or compatible Web3 wallet
- Git for version control

### Installation

1. **Clone the repository:**

   ```bash
   git clone https://github.com/Deed3Labs/Protocol-Contracts
   cd Protocol-Contracts/app
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Set up environment variables:**

   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` and add your API keys:
   ```env
   # Alchemy API Keys (optional - for production)
   VITE_ALCHEMY_ETH_MAINNET=https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY
   VITE_ALCHEMY_ETH_SEPOLIA=https://eth-sepolia.g.alchemy.com/v2/YOUR_API_KEY
   VITE_ALCHEMY_BASE_MAINNET=https://base-mainnet.g.alchemy.com/v2/YOUR_API_KEY
   VITE_ALCHEMY_BASE_SEPOLIA=https://base-sepolia.g.alchemy.com/v2/YOUR_API_KEY

   # Infura API Keys (optional - for production)
   VITE_INFURA_ETH_MAINNET=https://mainnet.infura.io/v3/YOUR_PROJECT_ID
   VITE_INFURA_ETH_SEPOLIA=https://sepolia.infura.io/v3/YOUR_PROJECT_ID
   ```

4. **Start the development server:**

   ```bash
   npm run dev
   ```

5. **Open [http://localhost:5173](http://localhost:5173) in your browser**

## Development

### Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production with TypeScript compilation
- `npm run preview` - Preview production build locally
- `npm run lint` - Run ESLint for code quality checks

### Development Workflow

1. **Code Organization**: Follow the established project structure
2. **Component Development**: Use the existing UI component library
3. **Type Safety**: Leverage TypeScript for type safety
4. **Testing**: Write tests for new components and functionality
5. **Documentation**: Update documentation for new features

### Code Quality

The project uses several tools to maintain code quality:

- **ESLint**: Code linting and style enforcement
- **TypeScript**: Static type checking
- **Prettier**: Code formatting (via ESLint)
- **React Hooks**: Custom hooks for reusable logic

## Environment Variables

### Required
None for development (uses public RPC endpoints)

### Optional (for production)
- `VITE_ALCHEMY_*` - Alchemy API endpoints for better performance
- `VITE_INFURA_*` - Infura API endpoints as fallback

## Networks

The application supports multiple networks:

### Mainnet Networks
- **Ethereum Mainnet**: Primary network for production deployments
- **Base**: Layer 2 network for cost-effective transactions

### Testnet Networks
- **Sepolia Testnet**: Ethereum testnet for development and testing
- **Base Sepolia Testnet**: Base testnet for development and testing

### Network Features
- **Automatic Detection**: Automatic network detection and validation
- **Network Switching**: Seamless network switching with validation
- **Fallback Support**: Fallback RPC endpoints for reliability
- **Gas Optimization**: Network-specific gas optimization

## Deployment

### Production Build

1. **Build the application:**

   ```bash
   npm run build
   ```

2. **Preview the build:**

   ```bash
   npm run preview
   ```

3. **Deploy to your preferred hosting service**

### Deployment Options

- **Vercel**: Optimized for Vite applications
- **Netlify**: Static site hosting with CI/CD
- **GitHub Pages**: Free hosting for open source projects
- **AWS S3 + CloudFront**: Scalable static hosting

## Contributing

### Development Guidelines

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/your-feature`
3. **Make your changes**: Follow the established code patterns
4. **Test your changes**: Ensure all tests pass
5. **Submit a pull request**: Include detailed description of changes

### Code Standards

- **TypeScript**: Use TypeScript for all new code
- **Component Structure**: Follow the established component patterns
- **Hooks**: Use custom hooks for reusable logic
- **Styling**: Use Tailwind CSS for styling
- **Testing**: Write tests for new functionality

### Pull Request Process

1. **Description**: Provide clear description of changes
2. **Testing**: Include tests for new functionality
3. **Documentation**: Update documentation as needed
4. **Review**: Address review comments promptly

## Security Considerations

The frontend application implements several security measures:

- **Wallet Security**: Secure wallet connection and session management
- **Transaction Security**: Transaction validation and gas optimization
- **Data Protection**: Secure handling of user data and metadata
- **Network Security**: Network validation and fallback mechanisms
- **Error Handling**: Comprehensive error handling and user feedback
- **Access Control**: Role-based access control for administrative functions

## Performance Optimization

The application includes several performance optimizations:

- **Code Splitting**: Automatic code splitting for faster loading
- **Lazy Loading**: Lazy loading of components and routes
- **Caching**: Intelligent caching of blockchain data
- **Bundle Optimization**: Optimized bundle size and loading
- **Image Optimization**: Optimized image loading and display
- **Network Optimization**: Efficient network requests and fallbacks

## Browser Support

The application supports modern browsers:

- **Chrome**: 90+
- **Firefox**: 88+
- **Safari**: 14+
- **Edge**: 90+

## License

The frontend application is licensed under the **MIT License**. For more details, please refer to the [LICENSE](../LICENSE) file.

## Support

For support and questions:

- **Documentation**: Check the main [README](../README.md) for protocol documentation
- **Issues**: Report bugs and feature requests via GitHub issues
- **Discussions**: Join community discussions on GitHub
- **Security**: Report security vulnerabilities privately

## Acknowledgments

- **Reowns AppKit**: For wallet integration and authentication
- **shadcn/ui**: For the comprehensive UI component library
- **Tailwind CSS**: For the utility-first CSS framework
- **Vite**: For the fast build tool and development server
- **React**: For the component-based UI library
- **TypeScript**: For static type checking and developer experience

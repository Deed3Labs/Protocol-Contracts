# DeedNFT Protocol Frontend

A modern React application for the DeedNFT Protocol, built with Vite, TypeScript, and Tailwind CSS.

## Features

- 🎨 Modern UI with dark/light mode support
- 🔗 Wallet integration with Reowns AppKit
- 📱 Responsive design
- ⚡ Fast development with Vite
- 🎯 TypeScript for type safety

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn
- MetaMask or compatible wallet

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   cd app
   npm install
   ```

3. Set up environment variables:
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

4. Start the development server:
   ```bash
   npm run dev
   ```

5. Open [http://localhost:5173](http://localhost:5173) in your browser

## Development

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint

### Project Structure

```
src/
├── components/     # React components
├── hooks/         # Custom React hooks
├── config/        # Configuration files
├── contracts/     # Contract ABIs
└── types/         # TypeScript type definitions
```

## Environment Variables

The application supports the following environment variables:

### Required
None for development (uses public RPC endpoints)

### Optional (for production)
- `VITE_ALCHEMY_*` - Alchemy API endpoints for better performance
- `VITE_INFURA_*` - Infura API endpoints as fallback

## Networks

The application supports:
- Ethereum Mainnet
- Base
- Sepolia Testnet
- Base Sepolia Testnet

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License

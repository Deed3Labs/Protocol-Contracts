# BurnerBond UI Components

This directory contains the UI components for the BurnerBond protocol, which allows users to create, manage, and trade discount bonds backed by real assets.

## Components Overview

### 1. BurnerBondPage.tsx
The main page component that serves as the entry point for the BurnerBond system. It includes:
- **Statistics Dashboard**: Shows total bonds, value, active bonds, and matured bonds
- **Tabbed Navigation**: Three main sections - Create Bond, Explore Bonds, and My Bonds
- **Info Cards**: Educational content explaining how the system works

### 2. BondDepositForm.tsx
Handles the creation of new bonds through token deposits. Features:
- **Token Selection**: Choose from whitelisted tokens (USDC, USDT, DAI)
- **Bond Parameters**: Set face value, maturity period, and discount percentage
- **Real-time Calculation**: Automatically calculates required deposit and discount
- **Validation**: Ensures parameters are within allowed ranges
- **Auto-processing**: Bonds are created immediately upon deposit

### 3. BondExplorer.tsx
Allows users to browse and filter all available bonds in the protocol. Includes:
- **Search Functionality**: Search by token, creator, or bond ID
- **Advanced Filtering**: Filter by bond type, status, and maturity
- **Sorting Options**: Sort by maturity date, discount, face value, or creation date
- **Bond Cards**: Display key information for each bond
- **Bulk Actions**: Select and redeem multiple matured bonds

### 4. BondManagement.tsx
Personal portfolio management for users' bonds. Provides:
- **Portfolio Statistics**: Total value, discounts, potential gains
- **Bond Management**: View, filter, and manage personal bonds
- **Redemption Interface**: Redeem matured bonds for face value
- **Batch Operations**: Select and redeem multiple bonds at once
- **Status Tracking**: Track active, matured, and redeemed bonds

## Key Features

### Bond Creation Process
1. **Token Selection**: Choose from supported tokens
2. **Parameter Setting**: Define face value and maturity period
3. **Discount Calculation**: System calculates maximum discount based on maturity
4. **Deposit**: User deposits required amount (face value - discount)
5. **Bond Minting**: NFT bond is minted and backed by deposited tokens

### Bond Types
- **Short-term**: 1-30 days maturity
- **Mid-term**: 1-6 months maturity  
- **Long-term**: 6+ months maturity

### Discount System
- Discounts are calculated using a curve system based on maturity
- Longer maturities offer higher discounts (up to 30%)
- Discounts are automatically calculated and validated

### Redemption Process
1. **Maturity Check**: Bonds can only be redeemed after maturity date
2. **Face Value Payment**: Users receive the full face value
3. **Token Transfer**: Underlying tokens are transferred from AssurancePool
4. **Bond Burning**: Bond NFT is burned after successful redemption

## Integration with Smart Contracts

The UI components are designed to work with the following contracts:

### BurnerBondDeposit.sol
- `makeDeposit()`: Creates new bonds with auto-processing
- `calculateRequiredDeposit()`: Calculates deposit amount based on parameters
- `getDepositInfo()`: Retrieves deposit information

### IBurnerBond.sol
- `mintBond()`: Mints new bond NFTs
- `redeemBond()`: Redeems mature bonds
- `getBondInfo()`: Gets bond details
- `isBondMature()`: Checks if bond is ready for redemption

### IBurnerBondFactory.sol
- `createCollection()`: Creates new token-specific collections
- `getCollectionInfo()`: Gets collection details
- `getAllParameters()`: Gets global parameters

## State Management

The components use React state management with:
- **Local State**: Component-specific state for forms and UI
- **Props Drilling**: Passing data between parent and child components
- **Mock Data**: Currently uses mock data for development
- **Future Integration**: Ready for Redux/Zustand integration

## Styling

Components use the existing design system:
- **Tailwind CSS**: For styling and responsive design
- **shadcn/ui**: For consistent UI components
- **Lucide Icons**: For icons throughout the interface
- **Dark Mode**: Full support for light/dark themes

## Future Enhancements

### Planned Features
1. **Real Contract Integration**: Replace mock data with actual contract calls
2. **Advanced Analytics**: Portfolio performance tracking and charts
3. **Trading Interface**: Secondary market for bond trading
4. **Notifications**: Real-time updates for bond maturity and redemption
5. **Mobile Optimization**: Enhanced mobile experience
6. **Multi-wallet Support**: Integration with various wallet providers

### Technical Improvements
1. **Error Handling**: Comprehensive error handling and user feedback
2. **Loading States**: Better loading indicators and skeleton screens
3. **Caching**: Implement caching for better performance
4. **Testing**: Unit and integration tests
5. **Accessibility**: WCAG compliance and keyboard navigation

## Usage

To use the BurnerBond components:

1. **Import the main component**:
   ```tsx
   import BurnerBondPage from '@/components/BurnerBondPage';
   ```

2. **Add to routing**:
   ```tsx
   <Route path="/bonds" element={<BurnerBondPage />} />
   ```

3. **Add navigation link**:
   ```tsx
   <Link to="/bonds">Bonds</Link>
   ```

## Dependencies

- React 18+
- TypeScript
- Tailwind CSS
- shadcn/ui components
- Lucide React icons
- React Router DOM

## Development Notes

- All components are fully typed with TypeScript
- Mock data is used for development and testing
- Components are designed to be easily testable
- Responsive design works on all screen sizes
- Components follow the existing app's design patterns

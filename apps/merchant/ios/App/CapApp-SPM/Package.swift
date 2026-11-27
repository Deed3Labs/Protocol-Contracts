// swift-tools-version: 5.9
import PackageDescription

// DO NOT MODIFY THIS FILE - managed by Capacitor CLI commands
let package = Package(
    name: "CapApp-SPM",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapApp-SPM",
            targets: ["CapApp-SPM"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.5.2"),
        .package(name: "AparajitaCapacitorSecureStorage", path: "../../../../../node_modules/@aparajita/capacitor-secure-storage"),
        .package(name: "CapacitorCommunityBluetoothLe", path: "../../../../../node_modules/@capacitor-community/bluetooth-le"),
        .package(name: "CapacitorCommunityStripeTerminal", path: "../../../../../node_modules/@capacitor-community/stripe-terminal"),
        .package(name: "ClearCapacitorSocket", path: "../../../native/socket")
    ],
    targets: [
        .target(
            name: "CapApp-SPM",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "AparajitaCapacitorSecureStorage", package: "AparajitaCapacitorSecureStorage"),
                .product(name: "CapacitorCommunityBluetoothLe", package: "CapacitorCommunityBluetoothLe"),
                .product(name: "CapacitorCommunityStripeTerminal", package: "CapacitorCommunityStripeTerminal"),
                .product(name: "ClearCapacitorSocket", package: "ClearCapacitorSocket")
            ]
        )
    ]
)

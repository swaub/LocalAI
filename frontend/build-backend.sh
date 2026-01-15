#!/bin/bash

# Build Go backend for all platforms
# Run this script from the frontend directory

set -e

BACKEND_DIR="../backend"
OUTPUT_DIR="src-tauri/binaries"

echo "Building LocalAI backend for all platforms..."

cd "$BACKEND_DIR"

# macOS ARM (Apple Silicon)
echo "Building for macOS ARM64..."
GOOS=darwin GOARCH=arm64 go build -o "../frontend/$OUTPUT_DIR/localai-backend-aarch64-apple-darwin" .

# macOS Intel
echo "Building for macOS x86_64..."
GOOS=darwin GOARCH=amd64 go build -o "../frontend/$OUTPUT_DIR/localai-backend-x86_64-apple-darwin" .

# Windows
echo "Building for Windows x86_64..."
GOOS=windows GOARCH=amd64 go build -o "../frontend/$OUTPUT_DIR/localai-backend-x86_64-pc-windows-msvc.exe" .

# Linux
echo "Building for Linux x86_64..."
GOOS=linux GOARCH=amd64 go build -o "../frontend/$OUTPUT_DIR/localai-backend-x86_64-unknown-linux-gnu" .

echo ""
echo "Build complete! Binaries:"
ls -la "../frontend/$OUTPUT_DIR/"

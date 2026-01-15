#!/bin/bash

echo "Starting LocalAI..."

# Check if Ollama is running
if ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo "Warning: Ollama is not running. Please start Ollama first."
    echo "Run: ollama serve"
fi

# Build and start backend
echo "Building backend..."
cd backend
go mod tidy
go build -o localai . || { echo "Build failed"; exit 1; }
echo "Starting backend..."
./localai &
BACKEND_PID=$!
cd ..

# Wait for backend to start
sleep 2

# Check if backend is running
if ! curl -s http://localhost:8000/api/health > /dev/null 2>&1; then
    echo "Error: Backend failed to start"
    kill $BACKEND_PID 2>/dev/null
    exit 1
fi

echo "Backend running on http://localhost:8000"

# Start frontend
echo "Starting frontend..."
cd frontend
[ ! -d "node_modules" ] && npm install
node ./node_modules/vite/bin/vite.js &
FRONTEND_PID=$!
cd ..

echo ""
echo "LocalAI is starting..."
echo "Frontend: http://localhost:5173"
echo "Backend:  http://localhost:8000"
echo ""
echo "Press Ctrl+C to stop"

# Wait for interrupt
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" SIGINT SIGTERM
wait

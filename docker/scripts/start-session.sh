#!/bin/bash

# Mock Agent Startup Script
echo "Starting Mock Agent with MCP Server..."

# Set up display
export DISPLAY=:1

# Get ports from environment variables
VNC_PORT=${VNC_PORT:-5901}
NOVNC_PORT=${NOVNC_PORT:-6080}
MCP_PORT=${MCP_PORT:-8080}

echo "VNC Port: $VNC_PORT"
echo "noVNC Port: $NOVNC_PORT"
echo "MCP Port: $MCP_PORT"

# Function to cleanup on exit
cleanup() {
    echo "Shutting down services..."
    pkill -f Xvfb
    pkill -f x11vnc
    pkill -f websockify
    pkill -f "bun.*mcp"
    exit 0
}

# Set up signal handling
trap cleanup SIGTERM SIGINT

# Start Xvfb (virtual framebuffer)
echo "Starting Xvfb..."
Xvfb :1 -screen 0 1920x1080x24 -ac &
XVFB_PID=$!

# Wait for X server to start
sleep 2

# Start window manager
echo "Starting Fluxbox window manager..."
fluxbox --display=:1 &
FLUXBOX_PID=$!

# Wait for window manager to initialize
sleep 2

# Start VNC server
echo "Starting VNC server on port $VNC_PORT..."
x11vnc -display :1 -nopw -listen localhost -rfbport $VNC_PORT -forever -shared &
VNC_PID=$!

# Wait for VNC to start
sleep 2

# Start websockify (noVNC web proxy)
echo "Starting websockify on port $NOVNC_PORT..."
websockify --web /usr/share/novnc $NOVNC_PORT localhost:$VNC_PORT &
WEBSOCKIFY_PID=$!

# Wait for websockify to start
sleep 2

# Start MCP server
echo "Starting MCP server on port $MCP_PORT..."
cd /home/developer
export NODE_ENV=production
export MCP_PORT=$MCP_PORT
bun run mcp/server.ts &
MCP_PID=$!

# Wait for MCP server to start
sleep 3

# Create a welcome file if workspace is empty
if [ ! "$(ls -A /home/developer/workspace)" ]; then
    cat > /home/developer/workspace/README.md << 'EOF'
# Welcome to Mock Agent Environment

This is a mock development environment with MCP server for testing.

## Available Services
- VNC: Virtual desktop access
- MCP Server: Development tools API

## Getting Started
1. Connect via Claude Code using the MCP configuration
2. The agent can create files, run commands, and help you code
3. All actions are visible in this VNC environment

Happy coding! 🚀
EOF
fi

echo "Mock agent is ready!"
echo "- VNC: vnc://localhost:$VNC_PORT"
echo "- Web VNC: http://localhost:$NOVNC_PORT/vnc.html"
echo "- MCP Server: http://localhost:$MCP_PORT/mcp"

# Health check function
health_check() {
    while true; do
        # Check if critical processes are running
        if ! pgrep -f "Xvfb" > /dev/null; then
            echo "ERROR: Xvfb died, restarting..."
            Xvfb :1 -screen 0 1920x1080x24 -ac &
        fi
        
        if ! pgrep -f "x11vnc" > /dev/null; then
            echo "ERROR: VNC server died, restarting..."
            x11vnc -display :1 -nopw -listen localhost -rfbport $VNC_PORT -forever -shared &
        fi
        
        if ! pgrep -f "websockify" > /dev/null; then
            echo "ERROR: websockify died, restarting..."
            websockify --web /usr/share/novnc $NOVNC_PORT localhost:$VNC_PORT &
        fi
        
        if ! pgrep -f "bun.*mcp" > /dev/null; then
            echo "ERROR: MCP server died, restarting..."
            cd /home/developer && export MCP_PORT=$MCP_PORT && bun run mcp/server.ts &
        fi
        
        sleep 10
    done
}

# Start health monitoring in background
health_check &
HEALTH_PID=$!

# Keep the script running and wait for signals
wait
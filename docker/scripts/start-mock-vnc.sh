#!/bin/bash
export DISPLAY=:1

# Start virtual display
Xvfb :1 -screen 0 1920x1080x24 &
sleep 2

# Start window manager  
fluxbox --display=:1 &
sleep 2

# Start VNC server
x11vnc -display :1 -rfbport 5901 -nopw -shared -forever &
sleep 2

# Start websockify for web access
websockify 6080 localhost:5901 &

# Keep container running
echo "Mock agent started - VNC available on port 6080"
while true; do
  echo "Mock agent running at $(date)"
  sleep 30
done
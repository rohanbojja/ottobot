#!/bin/bash

# Start VNC server
echo "Starting VNC server on display :1..."
vncserver :1 -geometry ${VNC_RESOLUTION} -depth ${VNC_COL_DEPTH} -SecurityTypes None

# Start noVNC
echo "Starting noVNC on port ${NOVNC_PORT}..."
websockify --web /usr/share/novnc ${NOVNC_PORT} localhost:${VNC_PORT} &

# Start the coding agent
echo "Starting coding agent..."
cd /home/developer/agent
python3 -m coding_agent &

# Keep the container running
echo "VNC server started. Access noVNC at http://localhost:${NOVNC_PORT}/vnc.html"
tail -f /home/developer/.vnc/*:1.log
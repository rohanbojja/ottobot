#!/bin/bash

# Test health endpoint
echo "Testing health endpoint..."
curl -s http://localhost:3000/health | jq .

echo -e "\n\nTesting session creation..."
# Create a test session
SESSION_RESPONSE=$(curl -s -X POST http://localhost:3000/session \
  -H "Content-Type: application/json" \
  -d '{
    "initial_prompt": "Build a simple Hello World Node.js application",
    "environment": "node"
  }')

echo "$SESSION_RESPONSE" | jq .

# Extract session ID
SESSION_ID=$(echo "$SESSION_RESPONSE" | jq -r '.session_id')

if [ "$SESSION_ID" != "null" ] && [ -n "$SESSION_ID" ]; then
  echo -e "\n\nSession created with ID: $SESSION_ID"
  
  echo -e "\nGetting session status..."
  curl -s http://localhost:3000/session/$SESSION_ID | jq .
else
  echo "Failed to create session"
fi